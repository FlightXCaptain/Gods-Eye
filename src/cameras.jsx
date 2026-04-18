/* Cameras client — pulls /api/cameras on boot and every 15 min, exposes the
   list via window.subscribeCameras(cb). The list is small (tens to hundreds
   of entries) and essentially static, so we don't bother with SSE or diffing
   — the whole array just gets replaced on each refresh. */

(function () {
  let CAMS = [];
  const SUBS = new Set();
  const REFRESH_MS = 15 * 60 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/cameras', { cache: 'no-store' });
      if (!r.ok) { console.warn('[cameras] HTTP', r.status); return; }
      const j = await r.json();
      if (!Array.isArray(j?.cameras)) return;
      CAMS = j.cameras;
      console.log(`[cameras] ${CAMS.length} loaded`);
      for (const fn of SUBS) { try { fn(CAMS); } catch {} }
    } catch (e) {
      console.warn('[cameras] pull failed', e);
    }
  }

  pull();
  setInterval(pull, REFRESH_MS);

  window.subscribeCameras = (cb) => {
    SUBS.add(cb);
    if (CAMS.length) { try { cb(CAMS); } catch {} }
    return () => SUBS.delete(cb);
  };
  window.__cameras = () => CAMS;
})();
