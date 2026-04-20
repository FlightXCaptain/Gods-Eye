/* global fetch */
// Oil refineries — client fetcher. Pulls /api/refineries once on demand
// when the `refineries` sub-layer is enabled, caches in memory for the
// session. The list changes slowly (quarterly at most).

(function () {
  let cached = null;
  let inflight = null;

  async function fetchRefineries() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/refineries');
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

  window.fetchRefineries = fetchRefineries;
})();
