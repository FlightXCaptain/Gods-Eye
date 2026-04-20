/* global fetch */
// Smelters & mills — client fetcher. Pulls /api/smelters once on
// demand when the `smelters` sub-layer is enabled.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchSmelters() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/smelters');
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

  window.fetchSmelters = fetchSmelters;
})();
