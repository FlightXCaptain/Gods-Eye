/* Ocean-currents grid client — fetches /api/ocean-currents every 60 minutes
   (upstream updates daily, but we keep a modest refresh cadence so the
   client resync'es after a long-open tab wakes up). Exposes the grid via
   window.subscribeOceanCurrents(cb). Same shape as the wind grid: flat u/v
   arrays (m/s, eastward + northward) sampled every 5° between ±80° lat. */

(function () {
  let GRID = null;
  const SUBS = new Set();
  const REFRESH_MS = 60 * 60 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/ocean-currents', { cache: 'no-store' });
      if (!r.ok) { console.warn('[ocean] HTTP', r.status); return; }
      const g = await r.json();
      if (!g?.u || !g?.v || !g.nLat || !g.nLon) return;
      GRID = g;
      console.log(`[ocean] grid loaded — ${g.nLat} × ${g.nLon} points, generatedAt ${new Date(g.generatedAt).toISOString()}`);
      for (const fn of SUBS) { try { fn(GRID); } catch {} }
    } catch (e) {
      console.warn('[ocean] pull failed', e);
    }
  }

  pull();
  setInterval(pull, REFRESH_MS);

  window.subscribeOceanCurrents = (cb) => {
    SUBS.add(cb);
    if (GRID) { try { cb(GRID); } catch {} }
    return () => SUBS.delete(cb);
  };
  window.__ocean = () => GRID;
})();
