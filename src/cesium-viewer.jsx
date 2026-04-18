/* MapLibre-based photoreal-ish dive-in view.
   Despite the filename, this module no longer uses Cesium — MapLibre GL is
   lighter, theme-able to match the app's dark aesthetic, and supports 3D
   terrain without an API key.

   Exposes the same global entry point as before so the Dossier button keeps
   working unchanged:

     window.openCesiumDiveIn({ lon, lat, label?, altMeters? })

   On first call, lazy-loads MapLibre 4.x from unpkg, mounts a modal with a
   dark-themed raster basemap (Carto Dark Matter), wires AWS Terrarium DEM as
   the 3D terrain source, and flies the camera to the target with a pitched,
   oblique view. ESC / backdrop / X all clean up (removing the map, style
   sheet is intentionally left in place — subsequent opens reuse it). */

(function () {
  if (typeof window === 'undefined') return;

  // ------- Config -------------------------------------------------------
  const MAPLIBRE_VERSION = '4.7.0';
  const MAPLIBRE_JS  = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
  const MAPLIBRE_CSS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

  // Dark raster basemap — Carto Dark Matter. Free public CDN with CORS.
  // Attribution required (© OpenStreetMap contributors © CARTO).
  const BASEMAP_TILES = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';
  const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors, © CARTO';

  // AWS Terrarium DEM — free, no key, global. MapLibre parses the encoding.
  const TERRAIN_DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  const DEFAULT_ZOOM = 14;       // building-scale on big cities
  const DEFAULT_PITCH = 65;      // strongly oblique — reads as 3D without going top-down
  const DEFAULT_BEARING = 25;    // slight tilt so the view isn't strictly north-up
  const FLY_DURATION_MS = 2400;
  const TERRAIN_EXAGG = 1.6;     // lift mountains a bit for emphasis

  // ------- Lazy loader --------------------------------------------------
  let libLoadPromise = null;
  function loadMapLibre() {
    if (libLoadPromise) return libLoadPromise;
    libLoadPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = MAPLIBRE_CSS;
        document.head.appendChild(link);
      }
      if (window.maplibregl) { resolve(window.maplibregl); return; }
      if (document.querySelector(`script[src="${MAPLIBRE_JS}"]`)) {
        // Already loading from a prior call — wait for it.
        const t = setInterval(() => {
          if (window.maplibregl) { clearInterval(t); resolve(window.maplibregl); }
        }, 80);
        setTimeout(() => { clearInterval(t); reject(new Error('maplibre load timeout')); }, 15000);
        return;
      }
      const s = document.createElement('script');
      s.src = MAPLIBRE_JS;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.maplibregl);
      s.onerror = () => reject(new Error('maplibre script failed'));
      document.head.appendChild(s);
    });
    return libLoadPromise;
  }

  // ------- Modal DOM ----------------------------------------------------
  function buildModal({ lon, lat, label }) {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[70] flex items-center justify-center pointer-events-auto';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/80 backdrop-blur-sm';

    const card = document.createElement('div');
    card.className = 'relative glass-strong rounded-2xl overflow-hidden shadow-2xl flex flex-col';
    card.style.width = 'min(960px, 96vw)';
    card.style.height = 'min(720px, 90vh)';

    const header = document.createElement('div');
    header.className = 'flex items-start justify-between gap-3 px-4 py-3 border-b border-white/10';
    const titles = document.createElement('div');
    titles.className = 'min-w-0';
    const title = document.createElement('div');
    title.className = 'text-sm font-semibold truncate';
    title.textContent = label || 'Dive-in view';
    const coords = document.createElement('div');
    coords.className = 'text-[11px] font-mono opacity-60 tabular-nums';
    coords.textContent = `coords · ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    titles.appendChild(title);
    titles.appendChild(coords);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 opacity-80 hover:opacity-100 transition';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M6 18L18 6"/></svg>';

    header.appendChild(titles);
    header.appendChild(closeBtn);

    const mapContainer = document.createElement('div');
    mapContainer.className = 'flex-1 min-h-0 relative';
    // Loading shim replaced by map tiles once the library mounts.
    const loading = document.createElement('div');
    loading.className = 'absolute inset-0 flex items-center justify-center text-[11px] font-mono opacity-70';
    loading.textContent = 'Loading 3D view…';
    mapContainer.appendChild(loading);

    card.appendChild(header);
    card.appendChild(mapContainer);
    root.appendChild(backdrop);
    root.appendChild(card);
    document.body.appendChild(root);

    return { root, backdrop, closeBtn, mapContainer, loading, map: null, onKey: null };
  }

  // ------- Map construction --------------------------------------------
  function mountMap(modal, maplibregl, { lon, lat }) {
    const style = {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: [BASEMAP_TILES],
          tileSize: 256,
          maxzoom: 20,
          attribution: BASEMAP_ATTRIBUTION,
        },
        'terrain-dem': {
          type: 'raster-dem',
          tiles: [TERRAIN_DEM],
          tileSize: 256,
          encoding: 'terrarium',
          maxzoom: 15,
        },
      },
      layers: [
        { id: 'basemap', type: 'raster', source: 'basemap' },
      ],
      terrain: { source: 'terrain-dem', exaggeration: TERRAIN_EXAGG },
      sky: {
        'sky-color': '#0a0a0f',
        'horizon-color': '#1a1a2a',
        'fog-color': '#0a0a0f',
        'fog-ground-blend': 0.5,
        'horizon-fog-blend': 0.5,
      },
      light: { anchor: 'viewport', intensity: 0.4 },
    };

    const map = new maplibregl.Map({
      container: modal.mapContainer,
      style,
      center: [lon, lat],
      zoom: Math.max(DEFAULT_ZOOM - 2, 10),   // start slightly zoomed out so fly-in feels like a descent
      pitch: 0,
      bearing: 0,
      maxPitch: 80,
      attributionControl: { compact: true },
      // Dark mode colours
      fadeDuration: 300,
    });

    map.on('load', () => {
      // Swap out the loading shim once the map paints.
      if (modal.loading && modal.loading.parentNode) {
        modal.loading.parentNode.removeChild(modal.loading);
        modal.loading = null;
      }
      map.flyTo({
        center: [lon, lat],
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: FLY_DURATION_MS,
        essential: true,
      });
    });

    return map;
  }

  // ------- Cleanup ------------------------------------------------------
  let activeModal = null;
  function destroyModal(modal) {
    if (!modal) return;
    if (modal.onKey) document.removeEventListener('keydown', modal.onKey);
    try { modal.map && modal.map.remove(); } catch (e) { console.warn('[mapbox] remove failed', e); }
    try { modal.root.parentNode && modal.root.parentNode.removeChild(modal.root); } catch {}
    if (activeModal === modal) activeModal = null;
  }

  // ------- Public entry -------------------------------------------------
  function openDiveIn({ lon, lat, label, altMeters }) {
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      console.warn('[dive-in] invalid coords', { lon, lat });
      return;
    }
    // Close any existing modal first.
    if (activeModal) destroyModal(activeModal);
    const modal = buildModal({ lon, lat, label });
    activeModal = modal;
    const close = () => destroyModal(modal);
    modal.closeBtn.addEventListener('click', close);
    modal.backdrop.addEventListener('click', close);
    modal.onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', modal.onKey);

    loadMapLibre().then((maplibregl) => {
      if (activeModal !== modal) return;   // user closed during load
      try {
        modal.map = mountMap(modal, maplibregl, { lon, lat, altMeters });
      } catch (e) {
        console.error('[dive-in] map init failed', e);
        if (modal.loading) modal.loading.textContent = 'Failed to load 3D view.';
      }
    }).catch((e) => {
      if (activeModal !== modal) return;
      console.error('[dive-in] maplibre load failed', e);
      if (modal.loading) modal.loading.textContent = 'Failed to load 3D library.';
    });
  }

  window.openCesiumDiveIn = openDiveIn;
  window.openDiveIn = openDiveIn;
})();
