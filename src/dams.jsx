/* global fetch */
// Major dams — client fetcher. Pulls /api/dams once on demand when the
// `dams` sub-layer is enabled. The route runs an Overpass query so the
// first call after a cold boot can take ~15s; subsequent calls hit the
// 7-day module cache and return instantly.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchDams() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/dams');
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const j = await r.json();
        cached = Array.isArray(j.features) ? j.features : [];
        return cached;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  window.fetchDams = fetchDams;
})();
