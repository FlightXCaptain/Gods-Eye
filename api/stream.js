// Unified SSE fanout for ships + flights. Replaces the former
// /api/ships-stream and /api/flights-stream endpoints: the browser opens a
// single EventSource here and demuxes events by a `source:kind` prefix on
// the SSE `event:` line.
//
// Why merge:
// - Each long-lived SSE connection on Vercel Fluid Compute pins a warm
//   function instance. Two endpoints meant two instances per visitor, so
//   a page open cost ~2× the provisioned-memory billing of one. One
//   endpoint = one instance. Bandwidth and CPU are unchanged.
// - Both pipelines already needed the same SSE scaffolding (heartbeat,
//   reconnect, subscriber set). The shared shell here is a few dozen
//   lines, and each pipeline remains self-contained in its own section
//   below so they can be extracted again if we ever need to.
//
// Event names on the wire:
//   ship:s    → initial snapshot (full list)
//   ship:u    → single-vessel update
//   ship:d    → vessel delete (prune)
//   flight:s  → periodic snapshot of all flights
//
// Lightning is NOT in this stream — it runs browser-direct to Blitzortung
// because Blitzortung silently drops cloud IPs. See src/lightning.jsx.
//
// Tunables and comments inside each section mirror the originals so
// history-blame continues to make sense.

import WebSocket from 'ws';
import { shipDb, shipDbReady, ensureShipSchema, SHIP_RETENTION_DAYS } from './_ship-db.js';
import { makeSources, fetchHotspot } from './_flight-sources.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

// ─────────────────────────────────────────────────────────────────────────
// Shared subscriber plumbing — one Set powers both pipelines. Each stored
// function accepts (eventName, payload) and writes an SSE frame.
// ─────────────────────────────────────────────────────────────────────────
const SUBSCRIBERS = new Set();

function broadcast(eventName, payload) {
  for (const fn of SUBSCRIBERS) {
    try { fn(eventName, payload); } catch {}
  }
}

// =========================================================================
// SHIPS — upstream AISStream WebSocket → per-vessel updates
// =========================================================================
// Holds ONE upstream WebSocket to AISStream per warm Fluid Compute instance
// (module-scoped state survives between invocations). Rebroadcasts to
// browsers over SSE.
//
// AISStream's free tier rate-limits handshakes aggressively, and browser-
// side WS from every visitor was burning the quota. This shape keeps at
// most N upstream connections = N warm instances — typically 1.

const SHIPS = new Map();         // mmsi -> ship record
const SHIP_STALE_MS = 15 * 60 * 1000;
// Per-vessel position history for client trail rendering. 10 points = a
// tidy tail that reads as motion without dominating dense shipping lanes.
const SHIP_TRACK_MAX = 10;
const SHIP_TRACK_MIN_DLL = 0.005;

let shipWs = null;
let shipReconnectTimer = null;
let shipReconnectDelay = 15000;
const SHIP_RECONNECT_CAP = 5 * 60 * 1000;
let shipPruneTimer = null;
let shipDbFlushTimer = null;
// Per-MMSI throttle for DB writes: epoch-ms of last recorded sample.
// Independent of the in-memory SHIPS.track buffer (which keeps 10 points
// for UI trails) so the DB gets a steady sampled history rather than
// every AIS tick.
const shipLastDbSample = new Map();
// Sample rate: one position per MMSI per 30 min. With ~50k active MMSIs
// per day this is ~100k writes/day — well under Neon free tier limits.
const SHIP_DB_SAMPLE_INTERVAL_MS = 30 * 60 * 1000;
const SHIP_DB_FLUSH_INTERVAL_MS  = 5 * 60 * 1000;
const SHIP_DB_PRUNE_INTERVAL_MS  = 6 * 60 * 60 * 1000;

function shipCategory(code) {
  const c = Number(code) || 0;
  if (c >= 60 && c <= 69) return 'passenger';
  if (c >= 70 && c <= 79) return 'cargo';
  if (c >= 80 && c <= 89) return 'tanker';
  if (c >= 30 && c <= 39) return 'fishing';
  if (c >= 50 && c <= 59) return 'service';
  if (c >= 40 && c <= 49) return 'highspeed';
  return 'other';
}

function startShipPruner() {
  if (shipPruneTimer) return;
  shipPruneTimer = setInterval(() => {
    const cutoff = Date.now() - SHIP_STALE_MS;
    for (const [k, v] of SHIPS) {
      if (v.time < cutoff) {
        SHIPS.delete(k);
        broadcast('ship:d', { mmsi: k });
      }
    }
  }, 60 * 1000);
  shipPruneTimer.unref?.();
}

// Batch-flush the current SHIPS snapshot into Neon Postgres. Runs every
// 5 min when Neon is configured (DATABASE_URL env var set). Sampling is
// per-MMSI: one DB row per vessel per 30 min so the table grows at a
// manageable rate (~100k rows/day globally, well within Neon free tier).
async function shipFlushToDb() {
  if (!shipDbReady) return;
  const now = Date.now();
  const rows = [];
  for (const [mmsi, s] of SHIPS) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    const prev = shipLastDbSample.get(mmsi) || 0;
    if (now - prev < SHIP_DB_SAMPLE_INTERVAL_MS) continue;
    shipLastDbSample.set(mmsi, now);
    rows.push({
      mmsi, t: Math.floor(now / 1000),
      lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4),
      sog: typeof s.sog === 'number' ? Math.round(s.sog * 10) : null,
      cog: typeof s.cog === 'number' ? Math.round(s.cog)      : null,
    });
  }
  if (!rows.length) return;
  try {
    await ensureShipSchema();
    // UNNEST arrays is the Postgres idiom for many rows in a single round-
    // trip. @neondatabase/serverless tagged templates parametrise safely.
    const mmsis = rows.map(r => r.mmsi);
    const ts    = rows.map(r => r.t);
    const lats  = rows.map(r => r.lat);
    const lons  = rows.map(r => r.lon);
    const sogs  = rows.map(r => r.sog);
    const cogs  = rows.map(r => r.cog);
    await shipDb`
      INSERT INTO ship_positions (mmsi, t, lat, lon, sog, cog)
      SELECT * FROM UNNEST(
        ${mmsis}::int[], ${ts}::int[], ${lats}::real[], ${lons}::real[],
        ${sogs}::smallint[], ${cogs}::smallint[]
      )
      ON CONFLICT (mmsi, t) DO NOTHING
    `;
    console.log(`[stream/ships] flushed ${rows.length} positions to Neon`);
  } catch (e) {
    console.warn('[stream/ships] db flush failed:', e.message);
  }
}

async function shipPruneDb() {
  if (!shipDbReady) return;
  const cutoffSec = Math.floor((Date.now() - SHIP_RETENTION_DAYS * 24 * 3600 * 1000) / 1000);
  try {
    await ensureShipSchema();
    const res = await shipDb`DELETE FROM ship_positions WHERE t < ${cutoffSec}`;
    const n = res?.rowCount ?? 0;
    if (n > 0) console.log(`[stream/ships] pruned ${n} old DB rows`);
  } catch (e) {
    console.warn('[stream/ships] db prune failed:', e.message);
  }
}

function startShipDbFlush() {
  if (!shipDbReady || shipDbFlushTimer) return;
  // Initial flush 30 s after instance warm — give AISStream a moment to
  // populate SHIPS before the first DB write. unref'd so it doesn't keep
  // an idle instance alive.
  const initialFlush = setTimeout(() => { shipFlushToDb().catch(() => {}); }, 30 * 1000);
  initialFlush.unref?.();
  shipDbFlushTimer = setInterval(() => { shipFlushToDb().catch(() => {}); }, SHIP_DB_FLUSH_INTERVAL_MS);
  shipDbFlushTimer.unref?.();
  const pruneT = setInterval(() => { shipPruneDb().catch(() => {}); }, SHIP_DB_PRUNE_INTERVAL_MS);
  pruneT.unref?.();
}

function connectShipUpstream() {
  if (shipWs && shipWs.readyState <= 1) return; // CONNECTING or OPEN
  const key = process.env.AISSTREAM_KEY;
  if (!key) { console.warn('[stream/ships] AISSTREAM_KEY missing'); return; }

  console.log('[stream/ships] opening upstream AISStream WS');
  shipWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

  shipWs.on('open', () => {
    shipReconnectDelay = 15000;
    console.log('[stream/ships] upstream open — subscribing globally');
    shipWs.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  });

  shipWs.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.error || m.Error) {
      console.warn('[stream/ships] upstream error:', m.error || m.Error);
      return;
    }
    const mmsi = m.MetaData?.MMSI;
    if (!mmsi) return;
    const prev = SHIPS.get(mmsi) || { mmsi };
    const now = Date.now();

    if (m.MessageType === 'PositionReport') {
      const pr = m.Message?.PositionReport || {};
      const lat = pr.Latitude, lon = pr.Longitude;
      if (!isFinite(lat) || !isFinite(lon)) return;
      if (!prev.track) prev.track = [];
      const last = prev.track[prev.track.length - 1];
      if (!last || Math.abs(last[0] - lon) > SHIP_TRACK_MIN_DLL || Math.abs(last[1] - lat) > SHIP_TRACK_MIN_DLL) {
        prev.track.push([lon, lat]);
        while (prev.track.length > SHIP_TRACK_MAX) prev.track.shift();
      }
      prev.lat = lat;
      prev.lon = lon;
      prev.cog = pr.Cog;
      prev.sog = pr.Sog;
      prev.heading = pr.TrueHeading;
      prev.nav = pr.NavigationalStatus;
      prev.time = now;
      prev.name = prev.name || m.MetaData?.ShipName?.trim();
      SHIPS.set(mmsi, prev);
      broadcast('ship:u', prev);
    } else if (m.MessageType === 'ShipStaticData') {
      const sd = m.Message?.ShipStaticData || {};
      prev.name = sd.Name?.trim() || prev.name;
      prev.callsign = sd.CallSign?.trim() || prev.callsign;
      prev.type = sd.Type ?? prev.type;
      prev.category = shipCategory(sd.Type);
      prev.dest = sd.Destination?.trim() || prev.dest;
      prev.time = prev.time || now;
      SHIPS.set(mmsi, prev);
      if (prev.lat != null) broadcast('ship:u', prev);
    }
  });

  shipWs.on('close', (code) => {
    console.warn(`[stream/ships] upstream closed code=${code}`);
    shipWs = null;
    clearTimeout(shipReconnectTimer);
    shipReconnectTimer = setTimeout(connectShipUpstream, shipReconnectDelay);
    shipReconnectTimer.unref?.();
    shipReconnectDelay = Math.min(SHIP_RECONNECT_CAP, shipReconnectDelay * 2);
  });

  shipWs.on('error', (e) => {
    console.warn('[stream/ships] upstream error', e?.message || e);
    try { shipWs.close(); } catch {}
  });
}

// =========================================================================
// FLIGHTS — ADS-B aggregator hotspot polling
// =========================================================================
// Module-scoped FLIGHTS map lives for the life of the Fluid Compute
// instance. Persistent state means browsers see flights that are real
// right now, not a jittery diff against the previous snapshot. A refresh
// loop polls an ADS-B aggregator's per-point endpoint across a global
// hotspot grid, merges results into the map by aircraft hex, and stamps
// each record with a last-seen timestamp.

const FLIGHTS = new Map();            // hex -> flight record
const FLIGHT_STALE_MS = 5 * 60 * 1000;
const FLIGHT_REFRESH_COOLDOWN_MS = 2_000;
const FLIGHT_SNAPSHOT_MS = 5_000;
const FLIGHT_REQUEST_STAGGER_MS = 110;
const FLIGHT_TRACK_MAX = 10;
const FLIGHT_TRACK_MIN_DLL = 0.02;

// Per-source stale tolerance. Public aggregators update every few seconds,
// so 5 min is ample. ADSBx polls are spaced minutes apart, so records need
// longer grace before we drop them — otherwise they flicker between polls.
const FLIGHT_STALE_BY_SOURCE = {
  'public':      5 * 60 * 1000,
  'adsbx-mil':   15 * 60 * 1000,
  'adsbx-ocean': 50 * 60 * 1000,
};

// Covers every continent + polar + major oceanic corridors. Each anchor
// pulls aircraft within 250 nm; 250 nm ≈ 463 km, so dense anchors with
// overlap give effectively global coverage including mid-ocean routes.
const FLIGHT_HOTSPOTS = [
  // Europe
  [51.5,-0.12],[50.1,8.68],[41.9,12.5],[37.98,23.7],[55.75,37.6],
  [64.13,-21.94],[52.23,21.01],[60.17,24.94],[48.21,16.37],[40.42,-3.7],
  // North America
  [40.7,-74],[41.88,-87.63],[34.05,-118.2],[29.76,-95.37],[49.28,-123.12],
  [61.22,-149.9],[43.65,-79.38],[25.76,-80.19],[39.74,-104.99],[45.5,-73.57],
  // Central / South America
  [19.43,-99.13],[-23.55,-46.63],[4.71,-74.07],[-12.05,-77.04],
  [-34.6,-58.38],[-33.45,-70.67],[-0.18,-78.47],[-15.78,-47.93],
  // Africa
  [30.04,31.24],[6.52,3.38],[-26.2,28.04],[-1.29,36.82],[33.57,-7.59],
  [14.72,-17.47],[-4.44,15.27],[-8.78,34.5],
  // Middle East / Central Asia
  [25.2,55.27],[35.7,51.42],[41.01,28.98],[24.71,46.68],[43.24,76.89],[33.3,44.4],
  // South Asia
  [28.6,77.2],[24.86,67.0],[19.07,72.87],[23.73,90.4],[6.93,79.86],
  // East / Southeast Asia
  [31.2,121.5],[35.68,139.7],[37.57,126.98],[22.28,114.16],[25.03,121.56],
  [13.75,100.49],[14.6,120.98],[-6.2,106.85],[1.35,103.8],[10.82,106.63],
  // Oceania / Pacific
  [-33.86,151.2],[-37.81,144.96],[-36.85,174.76],[21.31,-157.86],

  // ── Ocean corridors — fill the mid-ocean gaps where long-haul flights
  //    otherwise vanished between coastal hotspots. Each ~500-900 nm from
  //    the nearest land anchor. ───────────────────────────────────────
  // North Atlantic (NYC ↔ Europe routes)
  [50,-30],[45,-45],[40,-55],[55,-40],
  // Mid / South Atlantic
  [20,-40],[0,-25],[-20,-15],[-35,-25],
  // North Pacific (Asia ↔ NA great-circle + mid-lat)
  [45,-160],[40,-175],[50,-180],[35,-170],[30,-150],
  // Central / South Pacific
  [10,-150],[0,-170],[-20,-150],[-10,170],[-25,-130],
  // Indian Ocean
  [0,75],[-15,75],[-25,90],[10,65],[-35,80],
  // Southern Ocean / Antarctic approaches
  [-55,140],[-55,-100],[-60,60],
  // Arctic polar routes
  [80,-100],[85,0],[75,100],

  // Polar / remote
  [-54.8,-68.3],[78.22,15.65],
];

// Per-source URL shape, pacing and back-off live in _flight-sources.js.
const FLIGHT_SOURCES = makeSources();

let flightRefreshRunning = false;
let flightSnapshotTimer = null;
let flightAdsbxMilTimer = null;
let flightAdsbxOceanTimer = null;

// ADSBx via RapidAPI — the user's plan allows 10 000 queries/month; we
// target 8 000 with margin for per-instance duplication on Vercel Fluid
// Compute (a warm second instance doubles the rate briefly during scale-out).
//
//   Single-instance math:
//     poll every 8 min × 60 min/hr × 24 hr × 30 day / 8 min = 5 400 /mo
//     ≈ 0.65 × 8 000 budget → room for 2 concurrent instances and the
//     occasional on-demand hex lookup without tripping the quota.
const FLIGHT_ADSBX_MIL_INTERVAL_MS = 8 * 60 * 1000;

// ADSBx ocean augmentation. Public aggregators rely on crowd-sourced
// receivers which cluster around population centres; huge tracts of ocean
// have no receivers and public feeds go dark there. ADSBx has satellite-
// ADS-B coverage for those gaps.
//
//   4 × (30d × 24h × 60m/45m) = 3 840 queries/month
//   Combined with mil (5 400/mo): 9 240/mo, under the 10 k cap
const FLIGHT_ADSBX_OCEAN_INTERVAL_MS = 45 * 60 * 1000;
const FLIGHT_ADSBX_OCEAN_POINTS = [
  [40, -40],     // North Atlantic (NYC ↔ Europe corridor)
  [35, -170],    // North Pacific (NA ↔ East Asia corridor)
  [-10, 75],     // Indian Ocean (Europe ↔ Australia corridor)
  [-20, -140],   // South Pacific (Australia ↔ South America)
];

async function flightSafeFetch(url, opts = {}, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function flightFetchHotspot(la, lo) {
  return fetchHotspot(FLIGHT_SOURCES, la, lo);
}

// Global military aircraft feed. Merges into the same FLIGHTS map so they
// render alongside civilian traffic, tagged so dossier can surface the
// source. Runs on its own interval (8 min) to conserve RapidAPI quota.
async function flightRefreshAdsbxMil() {
  const key = process.env.ADSBX_RAPIDAPI_KEY;
  if (!key) return;
  const j = await flightSafeFetch('https://adsbexchange-com1.p.rapidapi.com/v2/mil/', {
    headers: {
      'x-rapidapi-host': 'adsbexchange-com1.p.rapidapi.com',
      'x-rapidapi-key': key,
    },
  });
  if (!j?.ac?.length) return;
  const now = Date.now();
  for (const a of j.ac) {
    if (a.lat == null || a.lon == null) continue;
    const hex = a.hex;
    if (!hex) continue;
    const prev = FLIGHTS.get(hex);
    const track = prev?.track ? prev.track.slice() : [];
    const last = track[track.length - 1];
    if (!last || Math.abs(last[0] - a.lon) > FLIGHT_TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > FLIGHT_TRACK_MIN_DLL) {
      track.push([a.lon, a.lat]);
      while (track.length > FLIGHT_TRACK_MAX) track.shift();
    }
    FLIGHTS.set(hex, {
      id: hex,
      callsign: (a.flight || '').trim() || a.r || hex,
      reg: a.r, type: a.t, desc: a.desc,
      lon: a.lon, lat: a.lat,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : prev?.alt,
      vel: a.gs, hdg: a.track,
      track,
      kind: 'flight',
      source: 'adsbx-mil',
      mil: true,
      _ts: now,
    });
  }
}

// ADSBx ocean augmentation. Iterates a small set of mid-ocean anchor
// points and pulls aircraft within 250 nm via RapidAPI.
async function flightRefreshAdsbxOcean() {
  const key = process.env.ADSBX_RAPIDAPI_KEY;
  if (!key) return;
  const headers = {
    'x-rapidapi-host': 'adsbexchange-com1.p.rapidapi.com',
    'x-rapidapi-key': key,
  };
  for (const [la, lo] of FLIGHT_ADSBX_OCEAN_POINTS) {
    const j = await flightSafeFetch(
      `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${la}/lon/${lo}/dist/250/`,
      { headers }
    );
    if (!j?.ac?.length) { await new Promise(r => setTimeout(r, 250)); continue; }
    const now = Date.now();
    for (const a of j.ac) {
      if (a.lat == null || a.lon == null) continue;
      const hex = a.hex;
      if (!hex) continue;
      const prev = FLIGHTS.get(hex);
      const track = prev?.track ? prev.track.slice() : [];
      const last = track[track.length - 1];
      if (!last || Math.abs(last[0] - a.lon) > FLIGHT_TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > FLIGHT_TRACK_MIN_DLL) {
        track.push([a.lon, a.lat]);
        while (track.length > FLIGHT_TRACK_MAX) track.shift();
      }
      FLIGHTS.set(hex, {
        id: hex,
        callsign: (a.flight || '').trim() || a.r || hex,
        reg: a.r, type: a.t, desc: a.desc,
        lon: a.lon, lat: a.lat,
        alt: typeof a.alt_baro === 'number' ? a.alt_baro : prev?.alt,
        vel: a.gs, hdg: a.track,
        track,
        // Preserve mil tag if we already have it via the mil poller.
        kind: 'flight',
        source: prev?.mil ? 'adsbx-mil' : 'adsbx-ocean',
        mil: prev?.mil || false,
        _ts: now,
      });
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function flightRefresh() {
  const now = Date.now();
  for (const [la, lo] of FLIGHT_HOTSPOTS) {
    const ac = await flightFetchHotspot(la, lo);
    for (const a of ac) {
      if (a.lat == null || a.lon == null) continue;
      const hex = a.hex;
      if (!hex) continue;
      const prev = FLIGHTS.get(hex);
      const track = prev?.track ? prev.track.slice() : [];
      const last = track[track.length - 1];
      if (!last || Math.abs(last[0] - a.lon) > FLIGHT_TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > FLIGHT_TRACK_MIN_DLL) {
        track.push([a.lon, a.lat]);
        while (track.length > FLIGHT_TRACK_MAX) track.shift();
      }
      FLIGHTS.set(hex, {
        id: hex,
        callsign: (a.flight || '').trim() || a.r || hex,
        reg: a.r, type: a.t, desc: a.desc,
        lon: a.lon, lat: a.lat,
        alt: a.alt_baro, vel: a.gs, hdg: a.track,
        track,
        kind: 'flight',
        // Preserve mil tag if this aircraft was also seen via ADSBx mil —
        // losing it on every public update would cause the MIL badge to
        // flicker as civilian polls overwrite it.
        source: prev?.mil ? 'adsbx-mil' : 'public',
        mil: prev?.mil || false,
        _ts: now,
      });
    }
    await new Promise(r => setTimeout(r, FLIGHT_REQUEST_STAGGER_MS));
  }
  // Prune stale — per-source TTL from FLIGHT_STALE_BY_SOURCE.
  const nowPrune = Date.now();
  for (const [hex, f] of FLIGHTS) {
    const staleMs = FLIGHT_STALE_BY_SOURCE[f.source] || FLIGHT_STALE_MS;
    if (f._ts < nowPrune - staleMs) FLIGHTS.delete(hex);
  }
}

async function flightRefreshLoop() {
  if (flightRefreshRunning) return;
  flightRefreshRunning = true;
  while (true) {
    try { await flightRefresh(); } catch {}
    await new Promise(r => setTimeout(r, FLIGHT_REFRESH_COOLDOWN_MS));
  }
}

function startFlightJobs() {
  if (!flightRefreshRunning) flightRefreshLoop();
  if (!flightSnapshotTimer) {
    flightSnapshotTimer = setInterval(() => {
      if (!SUBSCRIBERS.size) return;
      const list = Array.from(FLIGHTS.values());
      broadcast('flight:s', list);
    }, FLIGHT_SNAPSHOT_MS);
    flightSnapshotTimer.unref?.();
  }
  if (process.env.ADSBX_RAPIDAPI_KEY) {
    if (!flightAdsbxMilTimer) {
      flightRefreshAdsbxMil().catch(() => {});
      flightAdsbxMilTimer = setInterval(() => { flightRefreshAdsbxMil().catch(() => {}); }, FLIGHT_ADSBX_MIL_INTERVAL_MS);
      flightAdsbxMilTimer.unref?.();
    }
    if (!flightAdsbxOceanTimer) {
      flightRefreshAdsbxOcean().catch(() => {});
      flightAdsbxOceanTimer = setInterval(() => { flightRefreshAdsbxOcean().catch(() => {}); }, FLIGHT_ADSBX_OCEAN_INTERVAL_MS);
      flightAdsbxOceanTimer.unref?.();
    }
  }
}

// =========================================================================
// SSE handler — connects subscribers to both pipelines
// =========================================================================
export default function handler(req, res) {
  // Spin up background work once per warm instance. Each helper is
  // idempotent — the guards inside prevent double-start.
  connectShipUpstream();
  startShipPruner();
  startShipDbFlush();
  startFlightJobs();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  // Tell Vercel / any intermediate proxies not to buffer chunks.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Initial snapshots for both sources — browser demuxer expects these
  // with the namespaced event names.
  const shipSnap = [];
  for (const s of SHIPS.values()) if (s.lat != null) shipSnap.push(s);
  res.write(`event: ship:s\ndata: ${JSON.stringify(shipSnap)}\n\n`);

  const flightSnap = Array.from(FLIGHTS.values());
  res.write(`event: flight:s\ndata: ${JSON.stringify(flightSnap)}\n\n`);

  const send = (eventName, data) => {
    try { res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { /* client disconnected */ }
  };
  SUBSCRIBERS.add(send);

  // Heartbeat comment every 20s — some proxies kill idle SSE at 30-60s.
  const hb = setInterval(() => {
    try { res.write(':hb\n\n'); } catch {}
  }, 20000);
  hb.unref?.();

  const cleanup = () => {
    clearInterval(hb);
    SUBSCRIBERS.delete(send);
    try { res.end(); } catch {}
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}
