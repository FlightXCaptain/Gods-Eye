/* global fetch */
// Natural-gas processing plants — client fetcher.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchGasProcessing() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/gas-processing');
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

  window.fetchGasProcessing = fetchGasProcessing;
})();
