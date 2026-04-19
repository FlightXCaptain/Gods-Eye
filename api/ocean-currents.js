// Global ocean-surface-currents grid. Originally scoped as a raw OSCAR v2.0
// proxy (NASA PO.DAAC) — that source ships NetCDF only, and the public
// ERDDAP mirror has been stuck at 2018 for years, so a live layer needs a
// different upstream.
//
// Open-Meteo's Marine API exposes daily ocean current velocity + direction
// at point queries, with the same multi-location batching used by the wind
// layer. Under the hood it composites ECMWF ORAS + Copernicus near-real-
// time currents, so it's "OSCAR-equivalent" for a live surface flow
// visualisation without the NetCDF handling work.
//
// This module is a near-copy of api/wind.js — same 5° global grid, same
// batched approach, same u/v output shape — so the client's existing
// particle-advection engine can consume it unchanged.

export const config = { runtime: 'nodejs', maxDuration: 60 };

const LAT_STEP = 5;
const LON_STEP = 5;
const LAT_MIN = -80; // currents are meaningless poleward of this
const LAT_MAX = 80;
const LON_MIN = -180;
const LON_MAX = 175;
const BATCH_SIZE = 900;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h — ocean currents update daily
const BACKOFF_MS = 15 * 60 * 1000;

let cache = null;
let nextRefreshAfter = 0;

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
  const url = 'https://marine-api.open-meteo.com/v1/marine'
    + `?latitude=${lats}&longitude=${lons}`
    + '&current=ocean_current_velocity,ocean_current_direction'
    + '&timezone=UTC';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('marine HTTP ' + res.status);
    const data = await res.json();
    if (data && !Array.isArray(data) && data.error) {
      throw new Error('open-meteo: ' + (data.reason || 'error'));
    }
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    console.warn('[ocean] batch failed:', e.message);
    return null;
  }
}

async function buildGrid() {
  const points = buildGridPoints();
  const nLat = Math.round((LAT_MAX - LAT_MIN) / LAT_STEP) + 1;
  const nLon = Math.round((LON_MAX - LON_MIN) / LON_STEP) + 1;

  const batches = [];
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    batches.push(points.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(batches.map(fetchBatch));
  if (results.every(r => r === null)) {
    throw new Error('all ocean batches failed — probably rate-limited');
  }
  const flat = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i]) flat.push(...results[i]);
    else flat.push(...new Array(batches[i].length).fill(null));
  }

  // ocean_current_velocity is reported in km/h; convert to m/s so the
  // grid has the same units as the wind grid and the client can share
  // sampling code trivially. Direction is degrees, meteorological-style
  // (where the flow is going TO, not FROM — confirmed by Open-Meteo
  // docs, which use the oceanographic convention for currents).
  const KMH_TO_MS = 1000 / 3600;
  const u = new Float32Array(nLat * nLon);
  const v = new Float32Array(nLat * nLon);
  for (let i = 0; i < points.length; i++) {
    const rec = flat[i];
    const cur = rec?.current;
    if (!cur) continue;
    const speedKmh = Number(cur.ocean_current_velocity);
    const dirDeg = Number(cur.ocean_current_direction);
    if (!isFinite(speedKmh) || !isFinite(dirDeg)) continue;
    const speed = speedKmh * KMH_TO_MS;
    const dirRad = dirDeg * Math.PI / 180;
    // Oceanographic "direction TO" — keep the sign as-is (u,v point where
    // the current is going, same convention as the wind grid after its
    // sign flip).
    u[i] = speed * Math.sin(dirRad);
    v[i] = speed * Math.cos(dirRad);
  }

  return {
    generatedAt: Date.now(),
    latMin: LAT_MIN, lonMin: LON_MIN,
    latStep: LAT_STEP, lonStep: LON_STEP,
    nLat, nLon,
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
      console.warn('[ocean] refresh failed:', e.message);
      nextRefreshAfter = now + BACKOFF_MS;
      if (!cache) {
        res.status(503).json({ error: 'ocean grid unavailable', detail: e.message });
        return;
      }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  res.status(200).json(cache);
}
