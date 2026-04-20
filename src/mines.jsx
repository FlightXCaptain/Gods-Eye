/* global fetch */
// Mines — client fetcher. Overpass-backed, ~3,000 named mines
// globally. Cold boot of /api/mines can take ~15-20s.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchMines() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/mines');
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

  window.fetchMines = fetchMines;
})();
