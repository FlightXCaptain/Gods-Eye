/* global fetch */
// Oil & gas pipelines — client fetcher. Curated multi-waypoint
// linestrings from /api/pipelines, cached once per session.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchPipelines() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/pipelines');
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

  window.fetchPipelines = fetchPipelines;
})();
