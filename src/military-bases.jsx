/* global fetch */
// Military bases — client fetcher. Two-tier caching so even the first
// toggle feels instant for returning users:
//
//   1. localStorage cache (7-day TTL, keyed ge-military-bases-v1).
//      Instant hit on return visits; no network at all. Ignored if
//      the entry is older than the TTL.
//
//   2. In-memory module cache, plus inflight dedup for concurrent
//      callers on the same page load.
//
// The server-side route now serves a pre-built snapshot (see
// scripts/build-military-bases.mjs), so even a cache-miss fetch is
// fast — no more Overpass cold-start waits.

(function () {
  const STORAGE_KEY = 'ge-military-bases-v1';
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;

  let cached = null;
  let inflight = null;

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.features)) return null;
      if (typeof parsed.at !== 'number') return null;
      if (Date.now() - parsed.at > TTL_MS) return null;
      return parsed.features;
    } catch { return null; }
  }

  function writeLocal(features) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), features }));
    } catch {
      // Quota exceeded / private mode — silently skip; next load will
      // hit the network but the server is now fast anyway.
    }
  }

  async function fetchMilitaryBases() {
    if (cached) return cached;
    const local = readLocal();
    if (local) {
      cached = local;
      return cached;
    }
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/military-bases');
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const j = await r.json();
        const features = Array.isArray(j.features) ? j.features : [];
        cached = features;
        if (features.length > 0) writeLocal(features);
        return features;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  window.fetchMilitaryBases = fetchMilitaryBases;
})();
