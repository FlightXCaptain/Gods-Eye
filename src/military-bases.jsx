/* global fetch */
// Military bases — client fetcher. /api/military-bases runs an Overpass
// query (can take ~20s cold) so we cache in-memory for the session.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchMilitaryBases() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/military-bases');
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

  window.fetchMilitaryBases = fetchMilitaryBases;
})();
