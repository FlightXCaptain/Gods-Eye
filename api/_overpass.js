// Shared Overpass API fetch + cache helper for OSM-sourced
// infrastructure layers. 7-day module cache. Tries multiple mirror
// endpoints on failure because the primary overpass-api.de instance
// occasionally rate-limits or times out.

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const cache = new Map(); // id -> { data, at }

/**
 * Run an Overpass QL query, project each returned element to a trimmed
 * shape, cache the result.
 *
 * @param {Object} ds
 * @param {string} ds.id     Cache key.
 * @param {string} ds.query  Overpass QL query string.
 * @param {(el: Object) => Object | null} ds.project
 *   Called per element (with normalized { lat, lon, tags, type, id }).
 *   Return the trimmed shape or null to skip.
 * @returns {Promise<Array>}
 */
export async function loadOverpassDataset(ds) {
  const hit = cache.get(ds.id);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.data;

  let lastErr;
  for (const endpoint of ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(ds.query),
      });
      if (!r.ok) { lastErr = new Error(`overpass ${endpoint} ${r.status}`); continue; }
      const j = await r.json();
      const elements = j.elements || [];
      const out = [];
      for (const el of elements) {
        // Nodes have lat/lon directly; ways/relations with `out center` have
        // a `center` object. Normalize.
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const proj = ds.project({ type: el.type, id: el.id, tags: el.tags || {}, lat, lon });
        if (proj != null) out.push(proj);
      }
      cache.set(ds.id, { data: out, at: now });
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all overpass endpoints failed');
}
