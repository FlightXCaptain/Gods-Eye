/* global fetch */
// Major ports — client fetcher. Curated static list from
// /api/ports-major, cached once per session.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchPortsMajor() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/ports-major');
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

  window.fetchPortsMajor = fetchPortsMajor;
})();
