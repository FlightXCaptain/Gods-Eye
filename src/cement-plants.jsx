/* global fetch */
// Cement plants — client fetcher.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchCementPlants() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/cement-plants');
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

  window.fetchCementPlants = fetchCementPlants;
})();
