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

export const config = { runtime: 'nodejs', maxDuration: 300 };

// ── Module-scoped, shared across SSE subscribers on the same instance ────
const SHIPS = new Map();         // mmsi -> ship record
const SUBSCRIBERS = new Set();   // Set<(type, payload) => void>
const STALE_MS = 15 * 60 * 1000;

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 15000;
const RECONNECT_CAP = 5 * 60 * 1000;
let pruneTimer = null;

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
