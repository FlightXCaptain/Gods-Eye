/* Cesium photoreal dive-in viewer.

   Lazy-loads CesiumJS from the official CDN on first use, then opens a
   modal overlay that flies the camera into a given lon/lat. The rest of
   the globe UI is built on D3 and is completely separate — this module
   only spins up Cesium when the user actually asks to dive in, so the
   cold-load cost (~3 MB of JS) isn't paid by every page view.

   Public API:
       window.openCesiumDiveIn({ lon, lat, label?, altMeters? })

   Everything else (DOM modal, keydown listener, Cesium.Viewer instance)
   is torn down on close so re-opening the viewer is always a clean slate. */

(function () {
  // --- Config ------------------------------------------------------------
  // Pin Cesium to a known version so the viewer can't drift if the CDN
  // rolls forward and breaks an API we depend on.
  const CESIUM_VERSION = '1.124';
  const CESIUM_BASE = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
  const CESIUM_JS_URL = `${CESIUM_BASE}Cesium.js`;
  const CESIUM_CSS_URL = `${CESIUM_BASE}Widgets/widgets.css`;

  // Camera defaults.
  const DEFAULT_ALT_METERS = 2000;    // how high above target when we arrive
  const FLY_PITCH_DEGREES = -35;      // slight oblique — readable but not top-down
  const FLY_DURATION_SECONDS = 2;     // smooth zoom-in

  // Modal sizing (passed through Tailwind arbitrary values).
  const MODAL_WIDTH_CLASS = 'w-[min(960px,96vw)]';
  const MODAL_HEIGHT_CLASS = 'h-[min(720px,90vh)]';
  const MODAL_Z_INDEX_CLASS = 'z-[70]';   // above everything including search (z-50)

  // --- Module state ------------------------------------------------------
  // Resolves once Cesium is on `window.Cesium`. Shared across calls so the
  // second and subsequent openDiveIn calls don't re-download the library.
  let cesiumLoadPromise = null;

  // Whatever modal is currently mounted, if any. Only one at a time.
  let activeModal = null;

  // --- Cesium loader -----------------------------------------------------
  function loadCesium() {
    if (window.Cesium) return Promise.resolve(window.Cesium);
    if (cesiumLoadPromise) return cesiumLoadPromise;

    cesiumLoadPromise = new Promise((resolve, reject) => {
      // Cesium reads CESIUM_BASE_URL during its init to locate Workers,
      // Assets, and Widgets. It must be set BEFORE the script tag runs,
      // otherwise Cesium falls back to relative paths that don't exist
      // on our origin.
      window.CESIUM_BASE_URL = CESIUM_BASE;

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CESIUM_CSS_URL;
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = CESIUM_JS_URL;
      script.async = true;
      script.onload = () => {
        if (window.Cesium) resolve(window.Cesium);
        else reject(new Error('Cesium script loaded but window.Cesium is undefined'));
      };
      script.onerror = () => reject(new Error(`Failed to load Cesium from ${CESIUM_JS_URL}`));
      document.head.appendChild(script);
    });

    return cesiumLoadPromise;
  }

  // --- Modal DOM ---------------------------------------------------------
  function buildModal({ label, lon, lat }) {
    // Root overlay: full-viewport, dark scrim, centers the card.
    const root = document.createElement('div');
    root.className = `fixed inset-0 ${MODAL_Z_INDEX_CLASS} flex items-center justify-center`;

    const backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/70';
    root.appendChild(backdrop);

    // Card — the thing that holds the header + Cesium canvas.
    const card = document.createElement('div');
    card.className = [
      'relative',
      MODAL_WIDTH_CLASS,
      MODAL_HEIGHT_CLASS,
      'glass-strong',
      'rounded-2xl',
      'overflow-hidden',
      'shadow-2xl',
      'flex',
      'flex-col',
    ].join(' ');
    root.appendChild(card);

    // Header strip — label + coords + close button.
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3 px-4 py-2 border-b border-white/10 shrink-0';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0';
    const titleEl = document.createElement('div');
    titleEl.className = 'text-sm font-medium truncate';
    titleEl.textContent = label || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    const subEl = document.createElement('div');
    subEl.className = 'text-xs opacity-60 font-mono';
    subEl.textContent = `coords · ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(subEl);
    header.appendChild(titleWrap);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition';
    closeBtn.setAttribute('aria-label', 'Close');
    // Inline SVG X — no dependency on the Lucide icons used in the React UI.
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    header.appendChild(closeBtn);

    card.appendChild(header);

    // The Cesium container — Cesium will hang its canvas here. flex-1 so
    // it fills whatever space the header leaves.
    const cesiumContainer = document.createElement('div');
    cesiumContainer.className = 'flex-1 relative bg-black';
    card.appendChild(cesiumContainer);

    // Loading shim shown until Cesium.Viewer has constructed.
    const loading = document.createElement('div');
    loading.className = 'absolute inset-0 flex items-center justify-center text-white/70 text-sm pointer-events-none';
    loading.textContent = 'Loading photoreal view…';
    cesiumContainer.appendChild(loading);

    return { root, card, cesiumContainer, loading, backdrop, closeBtn };
  }

  // --- Cleanup -----------------------------------------------------------
  function destroyModal(modal) {
    if (!modal) return;
    // Order matters: destroy the Cesium viewer first so it gets a chance
    // to release its WebGL context before its DOM parent vanishes.
    if (modal.viewer) {
      try { modal.viewer.destroy(); } catch (e) { console.warn('[cesium] viewer destroy', e); }
      modal.viewer = null;
    }
    if (modal.onKeyDown) {
      document.removeEventListener('keydown', modal.onKeyDown);
      modal.onKeyDown = null;
    }
    if (modal.root && modal.root.parentNode) {
      modal.root.parentNode.removeChild(modal.root);
    }
    if (activeModal === modal) activeModal = null;
  }

  // --- Viewer construction ----------------------------------------------
  function mountViewer(modal, Cesium, { lon, lat, altMeters }) {
    // In Cesium 1.100+ the Viewer auto-creates a default base layer pointing
    // at Cesium Ion's Bing imagery — which requires a token we don't have.
    // Without `baseLayer: false` it silently fails, leaving the scene blue
    // (just the globe's default ocean colour with no imagery painted). Pass
    // `false` to suppress the default, then add OSM ourselves.
    const viewer = new Cesium.Viewer(modal.cesiumContainer, {
      baseLayer: false,
      baseLayerPicker: false,
      homeButton: false,
      sceneModePicker: false,
      animation: false,
      timeline: false,
      geocoder: false,
      navigationHelpButton: false,
      // Keep: zoom, rotate, fullscreen, and the credit container (legally
      // required by OpenStreetMap).
      fullscreenButton: true,
      infoBox: false,
      selectionIndicator: false,
    });

    // OSM needs no API key and gives perfectly usable global imagery.
    // UrlTemplateImageryProvider is the stable path in modern Cesium; the
    // old `OpenStreetMapImageryProvider` factory was deprecated in 1.104+.
    viewer.imageryLayers.add(
      new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: '© OpenStreetMap contributors',
          maximumLevel: 19,
        })
      )
    );

    // Hide the loading shim once Cesium has taken over.
    if (modal.loading && modal.loading.parentNode) {
      modal.loading.parentNode.removeChild(modal.loading);
      modal.loading = null;
    }

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altMeters),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(FLY_PITCH_DEGREES),
        roll: 0,
      },
      duration: FLY_DURATION_SECONDS,
    });

    return viewer;
  }

  // --- Public entry point ------------------------------------------------
  function openDiveIn({ lon, lat, label, altMeters } = {}) {
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      console.warn('[cesium] openCesiumDiveIn needs numeric lon/lat', { lon, lat });
      return;
    }
    const alt = typeof altMeters === 'number' && altMeters > 0 ? altMeters : DEFAULT_ALT_METERS;

    // Only one modal at a time — if a user double-clicks a target, replace.
    if (activeModal) destroyModal(activeModal);

    const parts = buildModal({ label, lon, lat });
    const modal = { ...parts, viewer: null, onKeyDown: null };
    activeModal = modal;

    // Close hooks: X button, backdrop click, Escape key.
    const close = () => destroyModal(modal);
    parts.closeBtn.addEventListener('click', close);
    parts.backdrop.addEventListener('click', close);
    modal.onKeyDown = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', modal.onKeyDown);

    document.body.appendChild(parts.root);

    loadCesium()
      .then((Cesium) => {
        // Guard against the modal being closed while Cesium was loading —
        // mounting into a detached container would throw on destroy.
        if (activeModal !== modal) return;
        modal.viewer = mountViewer(modal, Cesium, { lon, lat, altMeters: alt });
      })
      .catch((err) => {
        // Same guard as the .then branch — if the user closed this modal
        // (or opened a new one) while Cesium was still loading, don't
        // touch the dead modal's DOM.
        if (activeModal !== modal) return;
        console.error('[cesium] failed to load', err);
        if (modal.loading) modal.loading.textContent = 'Failed to load photoreal view.';
      });
  }

  window.openCesiumDiveIn = openDiveIn;
})();
