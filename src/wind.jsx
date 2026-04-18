/* Wind grid client — fetches /api/wind every 10 minutes, exposes the grid
   via window.subscribeWind(cb). The grid arrives as flat Float32-ish arrays
   of u and v (m/s, eastward + northward) sampled every 5° globally. */

(function () {
  let GRID = null;
  const SUBS = new Set();
  const REFRESH_MS = 10 * 60 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/wind', { cache: 'no-store' });
      if (!r.ok) { console.warn('[wind] HTTP', r.status); return; }
      const g = await r.json();
      if (!g?.u || !g?.v || !g.nLat || !g.nLon) return;
      GRID = g;
      console.log(`[wind] grid loaded — ${g.nLat} × ${g.nLon} points, generatedAt ${new Date(g.generatedAt).toISOString()}`);
      for (const fn of SUBS) { try { fn(GRID); } catch {} }
    } catch (e) {
      console.warn('[wind] pull failed', e);
    }
  }

  // Initial pull + 10-min refresh.
  pull();
  setInterval(pull, REFRESH_MS);

  window.subscribeWind = (cb) => {
    SUBS.add(cb);
    if (GRID) { try { cb(GRID); } catch {} }
    return () => SUBS.delete(cb);
  };
  window.__wind = () => GRID;
})();
