// Lightning strikes — server-side proxy to Blitzortung's public WebSocket.
//
// Holds ONE upstream WS per Fluid Compute warm instance; fans strikes out
// to browsers via SSE. Same architectural pattern as /api/ships-stream.
//
// Blitzortung's protocol:
//   1. Open wss://ws{1..8}.blitzortung.org/  (rotate across servers)
//   2. Send {"a": 111} to subscribe to the global strike feed
//   3. Receive TEXT frames encoded with an LZW-like compressor. Decode
//      to JSON {time, lat, lon, alt, pol, sig, mds, mcg, sta}.
//
// Attribution: strikes come from the Blitzortung.org community detector
// network. No API key required, but be respectful — we pool every user's
// browser behind one upstream connection.

import WebSocket from 'ws';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const SUBSCRIBERS = new Set();     // Set<(strike) => void>
const RECENT = [];                  // last N strikes for on-connect catchup
const RECENT_MAX = 500;
const STRIKE_TTL_MS = 3 * 1000;     // clients fade strikes over 3 s

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 5000;
const RECONNECT_CAP = 5 * 60 * 1000;
// Diagnostic counters — logged periodically so we can see in runtime logs
// whether the Blitzortung WS is actually producing strikes.
let msgsSinceLog = 0;
let strikesSinceLog = 0;
let lastLogTs = 0;
let statsTimer = null;

// ─── Blitzortung LZW-style decoder ─────────────────────────────────────
//
// The server sends text where bytes ≥ 256 reference phrases built up
// during decoding (standard LZW). Running this produces the JSON string.
// Canonical implementation; most Blitzortung clients use this verbatim.
function decode(msg) {
  const e = {};
  const chars = msg.split('');
  let prev = chars[0];
  let curr = prev;
  const out = [curr];
  let code = 256;
  for (let i = 1; i < chars.length; i++) {
    const cc = chars[i].charCodeAt(0);
    let phrase;
    if (cc < 256) phrase = chars[i];
    else          phrase = e[cc] || (prev + curr);
    out.push(phrase);
    curr = phrase[0];
    e[code] = prev + curr;
    code++;
    prev = phrase;
  }
  return out.join('');
}

function broadcast(strike) {
  RECENT.push(strike);
  while (RECENT.length > RECENT_MAX) RECENT.shift();
  for (const fn of SUBSCRIBERS) { try { fn(strike); } catch {} }
}

function connectUpstream() {
  if (ws && ws.readyState <= 1) return;
  // Spread load across ws1..ws8 servers. Blitzortung recommends this for
  // public clients aggregating many users behind one connection.
  const server = 1 + Math.floor(Math.random() * 8);
  const url = `wss://ws${server}.blitzortung.org/`;
  console.log('[lightning] opening', url);
  ws = new WebSocket(url, {
    headers: {
      'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)',
      'Origin':     'https://map.blitzortung.org',  // Blitzortung's own client origin; some servers require it
    },
  });

  ws.on('open', () => {
    reconnectDelay = 5000;
    ws.send(JSON.stringify({ a: 111 }));
    console.log('[lightning] upstream OPEN, subscribed {a:111}');
    // Periodic stats so we can see in runtime logs whether strikes are
    // flowing through. Low-overhead — one log line per minute at most.
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(() => {
      if (msgsSinceLog || strikesSinceLog) {
        console.log(`[lightning] 60s: ${msgsSinceLog} msgs, ${strikesSinceLog} strikes, ${SUBSCRIBERS.size} subs`);
      } else {
        console.warn('[lightning] 60s: NO messages from upstream');
      }
      msgsSinceLog = 0;
      strikesSinceLog = 0;
    }, 60 * 1000);
    statsTimer.unref?.();
  });

  ws.on('message', (raw) => {
    msgsSinceLog++;
    const text = raw.toString();
    if (!text) return;
    let json;
    try {
      // Some deployments send plain JSON; others send the LZW-encoded form.
      // Detect by checking the first character.
      if (text[0] === '{' || text[0] === '[') {
        json = JSON.parse(text);
      } else {
        const decoded = decode(text);
        json = JSON.parse(decoded);
      }
    } catch (e) {
      if (msgsSinceLog <= 3) console.warn('[lightning] parse failed, first bytes:', text.slice(0, 60));
      return;
    }
    const lat = typeof json.lat === 'number' ? json.lat : null;
    const lon = typeof json.lon === 'number' ? json.lon : null;
    if (lat == null || lon == null) {
      if (msgsSinceLog <= 3) console.warn('[lightning] message without lat/lon, keys:', Object.keys(json).slice(0, 8).join(','));
      return;
    }
    strikesSinceLog++;
    const strike = {
      t:    Date.now(),
      lat:  +lat.toFixed(3),
      lon:  +lon.toFixed(3),
      pol:  json.pol || 0,
    };
    broadcast(strike);
  });

  ws.on('close', (code) => {
    console.warn(`[lightning] upstream closed code=${code}`);
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectUpstream, reconnectDelay);
    reconnectTimer.unref?.();
    reconnectDelay = Math.min(RECONNECT_CAP, reconnectDelay * 2);
  });

  ws.on('error', (e) => {
    console.warn('[lightning] upstream error', e?.message || e);
    try { ws.close(); } catch {}
  });
}

export default function handler(req, res) {
  connectUpstream();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // On connect: hand over recent strikes from the ring buffer so a freshly
  // loaded client sees SOMETHING immediately rather than waiting for the
  // next lightning. Only strikes within the fade window are useful.
  const cutoff = Date.now() - STRIKE_TTL_MS;
  const seed = RECENT.filter(s => s.t >= cutoff);
  res.write(`event: b\ndata: ${JSON.stringify(seed)}\n\n`);

  const send = (strike) => {
    try { res.write(`event: s\ndata: ${JSON.stringify(strike)}\n\n`); }
    catch { /* client gone */ }
  };
  SUBSCRIBERS.add(send);

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
