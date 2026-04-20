// NHC tropical-cyclone proxy.
//
// Why a proxy: nhc.noaa.gov and mapservices.weather.noaa.gov do not emit
// CORS headers, so a browser fetch is blocked outright. Moving the fetch
// server-side sidesteps that and, as a bonus, lets us cache across
// visitors (NHC only reissues advisories ~6-hourly, and the MapServer
// cone/track queries are slow enough that shared caching is worth it).
//
// Upstream:
//   1. https://www.nhc.noaa.gov/CurrentStorms.json
//        → compact list of currently-active storms (Atlantic + E-Pacific
//          + C-Pacific basins). Each has an id, name, intensity, position,
//          and a `binNumber` like "AT1".."CP5" (the storm's active slot
//          this season).
//   2. NOAA tropical MapServer
//        https://mapservices.weather.noaa.gov/tropical/rest/services/
//          tropical/NHC_tropical_weather/MapServer/<layerId>/query
//        → per-slot Forecast Cone (polygon) + Forecast Track (polyline).
//        Slots are laid out contiguously: slot N uses layer ids
//        {points: 6+26N, track: 7+26N, cone: 8+26N}. AT1..AT5 → slots
//        0..4, EP1..EP5 → 5..9, CP1..CP5 → 10..14.
//
// Fast path: no active storms → one upstream GET, returns [].

export const config = { runtime: 'nodejs', maxDuration: 30 };

const TTL_MS = 5 * 60 * 1000;            // NHC advisories are 6-hourly; 5 min cache is safe
const NEG_TTL_MS = 60 * 1000;            // on upstream failure, cache the error briefly
let cache = { ts: 0, data: null, err: null };

const MAPSERVER = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';

function parseCoord(str) {
  if (typeof str !== 'string') return NaN;
  const m = str.match(/^\s*([\d.]+)\s*([NnSsEeWw])?\s*$/);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const hem = (m[2] || '').toUpperCase();
  return hem === 'S' || hem === 'W' ? -v : v;
}

function slotIndex(binNumber) {
  if (typeof binNumber !== 'string' || binNumber.length < 3) return -1;
  const basin = binNumber.slice(0, 2).toUpperCase();
  const n = parseInt(binNumber.slice(2), 10);
  if (!isFinite(n) || n < 1 || n > 5) return -1;
  const basinOffset = basin === 'AT' ? 0 : basin === 'EP' ? 5 : basin === 'CP' ? 10 : -1;
  if (basinOffset < 0) return -1;
  return basinOffset + (n - 1);
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'gods-eye/1.0 (+https://github.com/FlightXCaptain/gods-eye)' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function queryLayerGeo(layerId) {
  const url = `${MAPSERVER}/${layerId}/query?where=1%3D1&outFields=*&f=geojson&outSR=4326`;
  try {
    const j = await fetchJson(url);
    return Array.isArray(j?.features) ? j.features : [];
  } catch {
    // MapServer is flaky under load; treat as "no geometry available for
    // this slot" rather than failing the whole request.
    return [];
  }
}

async function buildCyclones() {
  const c = await fetchJson('https://www.nhc.noaa.gov/CurrentStorms.json');
  const active = Array.isArray(c?.activeStorms) ? c.activeStorms : [];
  if (!active.length) return [];

  const out = [];
  // Build cone/track lookups once per request, querying only the slots
  // we actually need. Parallel-fan-out keeps the serverless walltime low
  // even when several basins have active storms.
  const slotJobs = active.map(async (s) => {
    const slot = slotIndex(s.binNumber);
    if (slot < 0) return { s, cone: null, track: null };
    const base = 6 + 26 * slot;
    const [coneFeats, trackFeats] = await Promise.all([
      queryLayerGeo(base + 2),
      queryLayerGeo(base + 1),
    ]);
    return {
      s,
      cone:  coneFeats[0]?.geometry  || null,
      track: trackFeats[0]?.geometry || null,
    };
  });
  const resolved = await Promise.all(slotJobs);

  for (const { s, cone, track } of resolved) {
    const lonRaw = s.longitudeNumeric ?? s.longitude;
    const latRaw = s.latitudeNumeric  ?? s.latitude;
    const lon = typeof lonRaw === 'number' ? lonRaw : parseCoord(lonRaw);
    const lat = typeof latRaw === 'number' ? latRaw : parseCoord(latRaw);
    if (!isFinite(lon) || !isFinite(lat)) continue;

    out.push({
      id: s.id || `${s.binNumber}-${s.name}`,
      name: s.name || 'Unnamed',
      binNumber: s.binNumber || null,
      classification: s.classification || '',
      intensityKt: parseFloat(s.intensity) || 0,
      pressureMb: parseFloat(s.pressure) || null,
      movementDir: s.movementDir || null,
      movementSpeedKt: parseFloat(s.movementSpeed) || null,
      lon, lat,
      time: s.lastUpdate ? new Date(s.lastUpdate).getTime() : Date.now(),
      cone, track,
      advisoryUrl: s.publicAdvisory?.url || s.forecastDiscussion?.url || null,
      kind: 'cyclone',
    });
  }
  return out;
}

export default async function handler(req, res) {
  const now = Date.now();
  const fresh = cache.data && now - cache.ts < TTL_MS;
  if (fresh) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json(cache.data);
  }
  // On recent failure, don't hammer upstream — serve the error briefly
  // so one bad fetch doesn't trigger a flood of retries across visitors.
  if (cache.err && now - cache.ts < NEG_TTL_MS && !cache.data) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(502).json({ error: 'upstream-failed', detail: cache.err });
  }
  try {
    const data = await buildCyclones();
    cache = { ts: now, data, err: null };
    console.log(`[cyclones] loaded ${data.length} active storms`);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn('[cyclones] fetch failed:', msg);
    // Keep serving the last good payload if we have one.
    if (cache.data) {
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.status(200).json(cache.data);
    }
    cache = { ts: now, data: null, err: msg };
    return res.status(502).json({ error: 'upstream-failed', detail: msg });
  }
}
