// Server-side AIS fanout. Holds ONE upstream WebSocket to AISStream per
// Fluid Compute instance (module-scoped state survives between invocations
// when the instance is warm), rebroadcasts to browsers over SSE.
//
// Why this shape:
// - AISStream free tier rate-limits handshakes aggressively. Browser-side WS
//   from every visitor was burning the quota. Here we have at most N upstream
//   connections = N warm instances — typically 1.
// - EventSource is strictly one-way (server → browser), which is all we need.
//   It auto-reconnects, works through HTTP proxies, and never exposes the key.

import WebSocket from 'ws';
import { shipDb, shipDbReady, ensureShipSchema, SHIP_RETENTION_DAYS } from './_ship-db.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

// ── Module-scoped, shared across SSE subscribers on the same instance ────
const SHIPS = new Map();         // mmsi -> ship record
const SUBSCRIBERS = new Set();   // Set<(type, payload) => void>
const STALE_MS = 15 * 60 * 1000;
// Per-vessel position history for client trail rendering. 10 points = a
// tidy tail that reads as motion without dominating dense shipping lanes.
const TRACK_MAX = 10;
const TRACK_MIN_DLL = 0.005;

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 15000;
const RECONNECT_CAP = 5 * 60 * 1000;
let pruneTimer = null;
let dbFlushTimer = null;
// Per-MMSI throttle for DB writes: epoch-ms of last recorded sample.
// Independent of the in-memory SHIPS.track buffer (which keeps 10 points
// for UI trails) so the DB gets a steady sampled history rather than
// every AIS tick.
const lastDbSample = new Map();
// Sample rate: one position per MMSI per 30 min. With ~50k active MMSIs
// per day this is ~100k writes/day = well under Neon free tier limits.
const DB_SAMPLE_INTERVAL_MS = 30 * 60 * 1000;
const DB_FLUSH_INTERVAL_MS  = 5 * 60 * 1000;
const DB_PRUNE_INTERVAL_MS  = 6 * 60 * 60 * 1000;

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

function broadcast(type, payload) {
  for (const fn of SUBSCRIBERS) { try { fn(type, payload); } catch {} }
}

function startPruner() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [k, v] of SHIPS) {
      if (v.time < cutoff) { SHIPS.delete(k); broadcast('d', { mmsi: k }); }
    }
  }, 60 * 1000);
  pruneTimer.unref?.();
}

// Batch-flush the current SHIPS snapshot into Neon Postgres. Runs every
// 5 min when Neon is configured (DATABASE_URL env var set). Sampling is
// per-MMSI: one DB row per vessel per 30 min so the table grows at a
// manageable rate (~100k rows/day globally, well within Neon free tier).
//
// Silently no-ops when no DB is configured — client's IndexedDB
// accumulator continues to work locally either way.
async function flushToDb() {
  if (!shipDbReady) return;
  const now = Date.now();
  // Collect rows to insert in one batch. Each row is a sparse snapshot
  // that lets us rebuild a per-MMSI trail 30 days back.
  const rows = [];
  for (const [mmsi, s] of SHIPS) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
    const prev = lastDbSample.get(mmsi) || 0;
    if (now - prev < DB_SAMPLE_INTERVAL_MS) continue;
    lastDbSample.set(mmsi, now);
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
    // @neondatabase/serverless supports tagged-template parametrisation
    // but batching inserts is cleanest via a single multi-row VALUES
    // statement. UNNEST arrays is the Postgres idiom for many rows at
    // once — one round-trip regardless of row count.
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
    console.log(`[ships-proxy] flushed ${rows.length} positions to Neon`);
  } catch (e) {
    console.warn('[ships-proxy] db flush failed:', e.message);
  }
}

async function pruneDb() {
  if (!shipDbReady) return;
  const cutoffSec = Math.floor((Date.now() - SHIP_RETENTION_DAYS * 24 * 3600 * 1000) / 1000);
  try {
    await ensureShipSchema();
    const res = await shipDb`DELETE FROM ship_positions WHERE t < ${cutoffSec}`;
    const n = res?.rowCount ?? 0;
    if (n > 0) console.log(`[ships-proxy] pruned ${n} old DB rows`);
  } catch (e) {
    console.warn('[ships-proxy] db prune failed:', e.message);
  }
}

function startDbFlush() {
  if (!shipDbReady || dbFlushTimer) return;
  // Kick one flush shortly after startup so fresh instances don't wait a
  // full cycle to populate the first batch.
  setTimeout(() => { flushToDb().catch(() => {}); }, 30 * 1000);
  dbFlushTimer = setInterval(() => { flushToDb().catch(() => {}); }, DB_FLUSH_INTERVAL_MS);
  dbFlushTimer.unref?.();
  // Pruning is cheap but doesn't need to run often.
  const pruneT = setInterval(() => { pruneDb().catch(() => {}); }, DB_PRUNE_INTERVAL_MS);
  pruneT.unref?.();
}

function connectUpstream() {
  if (ws && ws.readyState <= 1) return; // CONNECTING or OPEN
  const key = process.env.AISSTREAM_KEY;
  if (!key) { console.warn('[ships-proxy] AISSTREAM_KEY missing'); return; }

  console.log('[ships-proxy] opening upstream AISStream WS');
  ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    reconnectDelay = 15000;
    console.log('[ships-proxy] upstream open — subscribing globally');
    ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.error || m.Error) {
      console.warn('[ships-proxy] upstream error:', m.error || m.Error);
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
      // Append to track if the vessel has actually moved.
      if (!prev.track) prev.track = [];
      const last = prev.track[prev.track.length - 1];
      if (!last || Math.abs(last[0] - lon) > TRACK_MIN_DLL || Math.abs(last[1] - lat) > TRACK_MIN_DLL) {
        prev.track.push([lon, lat]);
        while (prev.track.length > TRACK_MAX) prev.track.shift();
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
      broadcast('u', prev);
    } else if (m.MessageType === 'ShipStaticData') {
      const sd = m.Message?.ShipStaticData || {};
      prev.name = sd.Name?.trim() || prev.name;
      prev.callsign = sd.CallSign?.trim() || prev.callsign;
      prev.type = sd.Type ?? prev.type;
      prev.category = shipCategory(sd.Type);
      prev.dest = sd.Destination?.trim() || prev.dest;
      prev.time = prev.time || now;
      SHIPS.set(mmsi, prev);
      if (prev.lat != null) broadcast('u', prev);
    }
  });

  ws.on('close', (code) => {
    console.warn(`[ships-proxy] upstream closed code=${code}`);
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectUpstream, reconnectDelay);
    reconnectTimer.unref?.();
    reconnectDelay = Math.min(RECONNECT_CAP, reconnectDelay * 2);
  });

  ws.on('error', (e) => {
    console.warn('[ships-proxy] upstream error', e?.message || e);
    try { ws.close(); } catch {}
  });
}

export default function handler(req, res) {
  connectUpstream();
  startPruner();
  startDbFlush();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  // Tell Vercel / any intermediate proxies not to buffer chunks.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Initial snapshot of everyone we currently know about.
  const snapshot = [];
  for (const s of SHIPS.values()) if (s.lat != null) snapshot.push(s);
  res.write(`event: s\ndata: ${JSON.stringify(snapshot)}\n\n`);

  const send = (type, data) => {
    try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
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
