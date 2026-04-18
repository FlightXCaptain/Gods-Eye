// Global wind grid. Fetches surface (10m) wind from Open-Meteo — which runs
// GFS + ECMWF + others under the hood, so we get weather-model-quality data
// without touching GRIB. Cached per warm instance with a 10-minute TTL;
// clients pull the same cached response from the Vercel edge so all
// browsers share the data.

export const config = { runtime: 'nodejs', maxDuration: 60 };

// 5° global grid. 36 lat rows × 72 lon cols = 2 592 points. Chunked into
// batches of ~900 for the multi-location API (URL length + response size).
const LAT_STEP = 5;
const LON_STEP = 5;
const LAT_MIN = -85;
const LAT_MAX = 85;
const LON_MIN = -180;
const LON_MAX = 175;  // exclusive of 180 (wrapped = -180)
const BATCH_SIZE = 900;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = null;
// Back-off state — if Open-Meteo rate-limits us, don't retry for this long
// regardless of cache TTL. Otherwise we'd burn through the hourly limit
// faster with each retry.
let nextRefreshAfter = 0;
const BACKOFF_MS = 15 * 60 * 1000;

function buildGridPoints() {
  const pts = [];
  for (let lat = LAT_MIN; lat <= LAT_MAX; lat += LAT_STEP) {
    for (let lon = LON_MIN; lon <= LON_MAX; lon += LON_STEP) {
      pts.push([lat, lon]);
    }
  }
  return pts;
}

async function fetchBatch(batch) {
  const lats = batch.map(p => p[0]).join(',');
  const lons = batch.map(p => p[1]).join(',');
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lats}&longitude=${lons}`
    + '&current=wind_speed_10m,wind_direction_10m'
    + '&wind_speed_unit=ms'
    + '&timezone=UTC';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('wind HTTP ' + res.status);
    const data = await res.json();
    // Open-Meteo returns 200 with {error: true, reason: ...} on rate-limit
    // and certain client errors. A single-point request returns an object;
    // a multi-point returns an array. Neither shape should be an error.
    if (data && !Array.isArray(data) && data.error) {
      throw new Error('open-meteo: ' + (data.reason || 'error'));
    }
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    console.warn('[wind] batch failed:', e.message);
    return null;   // signal total failure for this batch
  }
}

async function buildGrid() {
  const points = buildGridPoints();
  const nLat = Math.round((LAT_MAX - LAT_MIN) / LAT_STEP) + 1;
  const nLon = Math.round((LON_MAX - LON_MIN) / LON_STEP) + 1;

  // Split into batches and fetch in parallel.
  const batches = [];
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    batches.push(points.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(batches.map(fetchBatch));
  // Reject the whole refresh if every batch failed — otherwise we'd cache a
  // grid of zeros and the particle animation would stop visibly.
  if (results.every(r => r === null)) {
    throw new Error('all wind batches failed — probably rate-limited');
  }
  const flat = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i]) flat.push(...results[i]);
    else flat.push(...new Array(batches[i].length).fill(null));
  }

  // Open-Meteo returns {current: {wind_speed_10m, wind_direction_10m}} per
  // location. Convert "from" direction → (u, v) velocity components so the
  // client can translate a particle's lon/lat each frame without redoing
  // trig per particle per frame.
  const u = new Float32Array(nLat * nLon);
  const v = new Float32Array(nLat * nLon);
  for (let i = 0; i < points.length; i++) {
    const rec = flat[i];
    if (!rec?.current) continue;
    const speed = Number(rec.current.wind_speed_10m);
    const dirDeg = Number(rec.current.wind_direction_10m);
    if (!isFinite(speed) || !isFinite(dirDeg)) continue;
    const dirRad = dirDeg * Math.PI / 180;
    // Meteorological convention: direction is where wind comes FROM. Flip
    // the sign so (u, v) point where it's GOING.
    u[i] = -speed * Math.sin(dirRad);
    v[i] = -speed * Math.cos(dirRad);
  }

  return {
    generatedAt: Date.now(),
    latMin: LAT_MIN, lonMin: LON_MIN,
    latStep: LAT_STEP, lonStep: LON_STEP,
    nLat, nLon,
    // Transport as plain arrays for JSON serialisation.
    u: Array.from(u),
    v: Array.from(v),
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  const shouldRefresh = (!cache || now - cache.generatedAt > CACHE_TTL_MS)
                       && now >= nextRefreshAfter;
  if (shouldRefresh) {
    try {
      cache = await buildGrid();
      nextRefreshAfter = 0;
    } catch (e) {
      console.warn('[wind] refresh failed:', e.message);
      nextRefreshAfter = now + BACKOFF_MS;
      if (!cache) {
        res.status(503).json({ error: 'wind grid unavailable', detail: e.message });
        return;
      }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  // Let browsers + Vercel edge share the cached snapshot across clients.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(cache);
}
