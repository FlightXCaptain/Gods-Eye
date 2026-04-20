/* global fetch */
// LNG terminals — client fetcher. Pulls /api/lng-terminals once on
// demand when the `lng` sub-layer is enabled, caches in memory.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchLngTerminals() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/lng-terminals');
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

  window.fetchLngTerminals = fetchLngTerminals;
})();
