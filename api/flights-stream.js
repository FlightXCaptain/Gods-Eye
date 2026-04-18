// Server-side flight aggregator + SSE fanout. Replaces the old per-browser
// fetch-54-hotspots-every-25s approach that caused planes to pop in/out.
//
// Design:
// - Module-scoped FLIGHTS map lives for the life of the Fluid Compute
//   instance. Persistent state means browsers see flights that are real
//   right now, not a jittery diff against the previous snapshot.
// - A refresh loop polls an ADS-B aggregator's per-point endpoint across a
//   global hotspot grid, merges results into the map by aircraft hex, and
//   stamps each record with a last-seen timestamp.
// - Stale records (no update for 5 minutes) are pruned. Anything fresher
//   stays visible between polls, so slow-moving bush planes and redeye
//   flights don't flicker.
// - Clients subscribe via SSE. We push a snapshot on connect and a new
//   snapshot every REFRESH_MS so the UI stays close to live even when
//   browsers miss individual events.

export const config = { runtime: 'nodejs', maxDuration: 300 };

const FLIGHTS = new Map();            // hex -> flight record
const SUBSCRIBERS = new Set();        // Set<(event, data) => void>
const STALE_MS = 5 * 60 * 1000;
const REFRESH_MS = 12_000;            // server upstream poll cadence
const SNAPSHOT_MS = 6_000;            // snapshot push cadence to browsers
const REQUEST_STAGGER_MS = 150;        // delay between per-hotspot fetches

// Covers every continent + polar + major oceanic corridors. Each anchor
// pulls aircraft within 250 nm; 250 nm ≈ 463 km, so 56 anchors with some
// overlap give effectively global coverage.
const HOTSPOTS = [
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
  // Polar / remote
  [-54.8,-68.3],[78.22,15.65],
];

const FLIGHT_HOSTS = [
  'https://api.airplanes.live',
  'https://api.adsb.lol',
  'https://opendata.adsb.fi',
];

let refreshTimer = null;
let snapshotTimer = null;

async function safeFetch(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchHotspot(la, lo) {
  for (const host of FLIGHT_HOSTS) {
    const j = await safeFetch(`${host}/v2/point/${la}/${lo}/250`);
    if (j?.ac?.length) return j.ac;
  }
  return [];
}

async function refresh() {
  const now = Date.now();
  // Serialise with a small stagger — the public aggregators rate-limit
  // bursts, and we only have one instance hitting them so they should
  // let us through reliably if we pace ourselves.
  for (const [la, lo] of HOTSPOTS) {
    const ac = await fetchHotspot(la, lo);
    for (const a of ac) {
      if (a.lat == null || a.lon == null) continue;
      const hex = a.hex;
      if (!hex) continue;
      FLIGHTS.set(hex, {
        id: hex,
        callsign: (a.flight || '').trim() || a.r || hex,
        reg: a.r, type: a.t, desc: a.desc,
        lon: a.lon, lat: a.lat,
        alt: a.alt_baro, vel: a.gs, hdg: a.track,
        kind: 'flight',
        _ts: now,
      });
    }
    await new Promise(r => setTimeout(r, REQUEST_STAGGER_MS));
  }
  // Prune stale
  const cutoff = Date.now() - STALE_MS;
  for (const [hex, f] of FLIGHTS) {
    if (f._ts < cutoff) FLIGHTS.delete(hex);
  }
}

function startBackgroundJobs() {
  if (!refreshTimer) {
    refresh().catch(() => {});
    refreshTimer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
    refreshTimer.unref?.();
  }
  if (!snapshotTimer) {
    snapshotTimer = setInterval(() => {
      if (!SUBSCRIBERS.size) return;
      const list = Array.from(FLIGHTS.values());
      for (const fn of SUBSCRIBERS) {
        try { fn('s', list); } catch {}
      }
    }, SNAPSHOT_MS);
    snapshotTimer.unref?.();
  }
}

export default function handler(req, res) {
  startBackgroundJobs();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Immediate snapshot — whatever state we have, hand it over.
  const initial = Array.from(FLIGHTS.values());
  res.write(`event: s\ndata: ${JSON.stringify(initial)}\n\n`);

  const send = (type, data) => {
    try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { /* subscriber gone */ }
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
