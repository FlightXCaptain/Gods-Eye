/* global fetch */
// Semiconductor fabs — client fetcher. Pulls /api/fabs once on demand
// when the `fabs` sub-layer is enabled, caches in memory for the
// session. The list rarely changes, so no polling.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchFabs() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/fabs');
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

  window.fetchFabs = fetchFabs;
})();
