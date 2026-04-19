/* Camera player modal — opens an embed for a camera. Handles three embed
   types coming off /api/cameras:

     { type: 'iframe',         url }                 — Windy public player
     { type: 'image-refresh',  url, refreshSec }     — USGS / NOAA stills
     { type: 'hls',            url, posterUrl? }     — NPS HLS streams

   Exposes two global entry points:

     window.openCameraPlayer(camera)
     window.closeCameraPlayer()

   Modal is 960×540 (16:9), centred, glass-strong card matching the dive-in
   modal styling. ESC / backdrop / X close it.

   HLS is lazy-loaded from unpkg on first use so we don't pay the ~100 kB
   cost on globe load — only when someone clicks an HLS cam. */

(function () {
  if (typeof window === 'undefined') return;

  const HLS_JS_URL = 'https://unpkg.com/hls.js@1.5.16/dist/hls.min.js';

  // ---- hls.js lazy loader ---------------------------------------------
  let hlsLoadPromise = null;
  function loadHlsJs() {
    if (hlsLoadPromise) return hlsLoadPromise;
    hlsLoadPromise = new Promise((resolve, reject) => {
      if (window.Hls) { resolve(window.Hls); return; }
      const s = document.createElement('script');
      s.src = HLS_JS_URL;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.Hls);
      s.onerror = () => reject(new Error('hls.js failed to load'));
      document.head.appendChild(s);
    });
    return hlsLoadPromise;
  }

  // ---- Modal shell ----------------------------------------------------
  let activeModal = null;

  function buildModal(camera) {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[75] flex items-center justify-center pointer-events-auto';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    const backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/80 backdrop-blur-sm';

    const card = document.createElement('div');
    card.className = 'relative glass-strong rounded-2xl overflow-hidden shadow-2xl flex flex-col';
    card.style.width = 'min(960px, 96vw)';
    // 16:9 body + header. Cap vertical to 90vh on short screens.
    card.style.maxHeight = '90vh';

    // Header — title, coords, external-link chip, close
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10';

    const titles = document.createElement('div');
    titles.className = 'min-w-0 flex-1';
    const title = document.createElement('div');
    title.className = 'text-sm font-semibold truncate';
    title.textContent = camera.title || 'Live camera';
    const sub = document.createElement('div');
    sub.className = 'text-[11px] font-mono opacity-60 tabular-nums';
    const coordStr = (typeof camera.lat === 'number' && typeof camera.lon === 'number')
      ? `${camera.lat.toFixed(4)}, ${camera.lon.toFixed(4)}` : '';
    sub.textContent = [camera.source, camera.category, coordStr].filter(Boolean).join(' · ');
    titles.appendChild(title);
    titles.appendChild(sub);

    const linkBtn = document.createElement('a');
    linkBtn.className = 'shrink-0 text-[10px] uppercase font-mono tracking-wider rounded-full px-2.5 py-1 bg-white/5 hover:bg-white/10 opacity-70 hover:opacity-100 transition';
    linkBtn.textContent = 'Source ↗';
    linkBtn.target = '_blank';
    linkBtn.rel = 'noopener';
    linkBtn.href = camera.pageUrl || '#';
    if (!camera.pageUrl) linkBtn.style.display = 'none';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 opacity-80 hover:opacity-100 transition';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M6 18L18 6"/></svg>';

    header.appendChild(titles);
    header.appendChild(linkBtn);
    header.appendChild(closeBtn);

    // Body — 16:9 container that the embed renderer fills.
    const body = document.createElement('div');
    body.className = 'relative bg-black flex items-center justify-center';
    body.style.aspectRatio = '16 / 9';
    body.style.width = '100%';
    // Loading / fallback shim
    const shim = document.createElement('div');
    shim.className = 'absolute inset-0 flex items-center justify-center text-[11px] font-mono opacity-70';
    shim.textContent = 'Loading…';
    body.appendChild(shim);

    card.appendChild(header);
    card.appendChild(body);
    root.appendChild(backdrop);
    root.appendChild(card);
    document.body.appendChild(root);

    return { root, backdrop, closeBtn, body, shim, onKey: null, cleanupEmbed: null };
  }

  // ---- Embed renderers -----------------------------------------------

  function mountIframe(body, shim, embed) {
    // Windy's public player iframe. `allowfullscreen` for their fullscreen
    // toggle; `allow="autoplay"` lets their player start video without a
    // click (many browsers gate autoplay so the player politely falls back
    // to a still if it can't autoplay — that's fine).
    const iframe = document.createElement('iframe');
    iframe.src = embed.url;
    iframe.className = 'absolute inset-0 w-full h-full border-0';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.addEventListener('load', () => { if (shim?.parentNode) shim.parentNode.removeChild(shim); });
    body.appendChild(iframe);
    // Cleanup just removes the iframe — no listeners we own.
    return () => { try { iframe.remove(); } catch {} };
  }

  function mountImageRefresh(body, shim, embed) {
    // Auto-refreshing <img>. Cache-bust the URL so browsers actually hit
    // the network each tick. Hide the shim once the first frame lands.
    const img = document.createElement('img');
    img.className = 'absolute inset-0 w-full h-full object-contain bg-black';
    img.alt = 'Live camera';
    img.referrerPolicy = 'no-referrer';
    const period = Math.max(15, Math.min(300, embed.refreshSec || 60)) * 1000;
    const setSrc = () => { img.src = embed.url + (embed.url.includes('?') ? '&' : '?') + '_t=' + Date.now(); };
    setSrc();
    img.addEventListener('load', () => { if (shim?.parentNode) shim.parentNode.removeChild(shim); }, { once: true });
    img.addEventListener('error', () => {
      if (shim) shim.textContent = 'Camera image unavailable.';
    });
    body.appendChild(img);
    const tick = setInterval(setSrc, period);
    return () => {
      clearInterval(tick);
      try { img.remove(); } catch {}
    };
  }

  function mountHls(body, shim, embed) {
    const video = document.createElement('video');
    video.className = 'absolute inset-0 w-full h-full bg-black';
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    if (embed.posterUrl) video.poster = embed.posterUrl;

    let hls = null;
    let disposed = false;

    const cleanup = () => {
      disposed = true;
      try { if (hls) hls.destroy(); } catch {}
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
      try { video.remove(); } catch {}
    };

    const onReady = () => { if (shim?.parentNode) shim.parentNode.removeChild(shim); };

    // Safari has native HLS — skip hls.js entirely there.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = embed.url;
      video.addEventListener('loadedmetadata', onReady, { once: true });
      video.addEventListener('error', () => { if (shim) shim.textContent = 'Stream failed to load.'; }, { once: true });
      body.appendChild(video);
    } else {
      body.appendChild(video);
      loadHlsJs().then((Hls) => {
        if (disposed) return;
        if (!Hls?.isSupported()) {
          if (shim) shim.textContent = 'HLS not supported in this browser.';
          return;
        }
        hls = new Hls({ enableWorker: true });
        hls.loadSource(embed.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal) { if (shim) shim.textContent = 'Stream error — try "Source ↗".'; }
        });
      }).catch(() => {
        if (shim) shim.textContent = 'Could not load the HLS player.';
      });
    }
    return cleanup;
  }

  function mountLinkOnly(body, shim, camera) {
    if (!shim) return () => {};
    shim.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'text-center px-6 space-y-3';
    const line1 = document.createElement('div');
    line1.className = 'text-xs opacity-70 font-mono';
    line1.textContent = 'This camera doesn\'t support embedded playback.';
    const line2 = document.createElement('a');
    line2.className = 'inline-block rounded-full px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition';
    line2.textContent = 'Open source ↗';
    line2.target = '_blank';
    line2.rel = 'noopener';
    line2.href = camera.pageUrl || '#';
    msg.appendChild(line1);
    msg.appendChild(line2);
    shim.appendChild(msg);
    return () => {};
  }

  // ---- Public entry point ---------------------------------------------

  function open(camera) {
    if (!camera || !camera.embed) {
      console.warn('[camera-player] invalid camera', camera);
      return;
    }
    if (activeModal) close();

    const modal = buildModal(camera);
    activeModal = modal;

    const doClose = () => close();
    modal.closeBtn.addEventListener('click', doClose);
    modal.backdrop.addEventListener('click', doClose);
    modal.onKey = (e) => { if (e.key === 'Escape') doClose(); };
    document.addEventListener('keydown', modal.onKey);

    // Mount the right renderer based on embed.type.
    const type = camera.embed.type;
    try {
      if (type === 'iframe')              modal.cleanupEmbed = mountIframe(modal.body, modal.shim, camera.embed);
      else if (type === 'image-refresh')  modal.cleanupEmbed = mountImageRefresh(modal.body, modal.shim, camera.embed);
      else if (type === 'hls')            modal.cleanupEmbed = mountHls(modal.body, modal.shim, camera.embed);
      else                                modal.cleanupEmbed = mountLinkOnly(modal.body, modal.shim, camera);
    } catch (e) {
      console.error('[camera-player] mount failed', e);
      if (modal.shim) modal.shim.textContent = 'Camera player failed to load.';
    }
  }

  function close() {
    const modal = activeModal;
    if (!modal) return;
    activeModal = null;
    if (modal.onKey) document.removeEventListener('keydown', modal.onKey);
    try { modal.cleanupEmbed && modal.cleanupEmbed(); } catch {}
    try { modal.root.parentNode && modal.root.parentNode.removeChild(modal.root); } catch {}
  }

  window.openCameraPlayer  = open;
  window.closeCameraPlayer = close;
})();
