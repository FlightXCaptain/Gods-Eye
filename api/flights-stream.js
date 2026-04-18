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
const REFRESH_COOLDOWN_MS = 2_000;    // cool-down between full cycles
const SNAPSHOT_MS = 5_000;            // snapshot push cadence to browsers
const REQUEST_STAGGER_MS = 110;        // delay between per-hotspot fetches
// Per-flight track history. Storing the last N positions (as [lon, lat])
// means clients that connect mid-flight see the trail already drawn instead
// of a lone icon with no tail. Kept at 10 so payload growth stays modest.
const TRACK_MAX = 10;
const TRACK_MIN_DLL = 0.02;

// Per-source stale tolerance. Public aggregators update every few seconds, so
// a 5-min window is ample. ADSBx polls are spaced minutes apart, so records
// need longer grace before we drop them — otherwise they flicker between polls.
const STALE_BY_SOURCE = {
  'public':      5 * 60 * 1000,
  'adsbx-mil':   15 * 60 * 1000,
  'adsbx-ocean': 50 * 60 * 1000,
};

// Covers every continent + polar + major oceanic corridors. Each anchor
// pulls aircraft within 250 nm; 250 nm ≈ 463 km, so dense anchors with
// overlap give effectively global coverage including mid-ocean routes.
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

const FLIGHT_HOSTS = [
  'https://api.airplanes.live',
  'https://api.adsb.lol',
  'https://opendata.adsb.fi',
];

let refreshRunning = false;
let snapshotTimer = null;
let adsbxMilTimer = null;
let adsbxOceanTimer = null;

// ADSBx via RapidAPI — the user's plan allows 10 000 queries/month; we
// target 8 000 with margin for per-instance duplication on Vercel Fluid
// Compute (a warm second instance doubles the rate briefly during scale-out).
//
//   Single-instance math:
//     poll every 8 min × 60 min/hr × 24 hr × 30 day / 8 min = 5 400 /mo
//     ≈ 0.65 × 8 000 budget → room for 2 concurrent instances and the
//     occasional on-demand hex lookup without tripping the quota.
const ADSBX_MIL_INTERVAL_MS = 8 * 60 * 1000;

// ADSBx ocean augmentation. Public aggregators rely on crowd-sourced
// receivers which cluster around population centres; huge tracts of ocean
// (mid-Atlantic, mid-Pacific, Indian Ocean, Southern Ocean) have no
// receivers and public feeds go dark there. ADSBx has satellite-ADS-B
// coverage for those gaps. Polling 4 strategic ocean points every 45 min
// fills the trans-ocean corridors without burning the RapidAPI quota.
//
//   4 × (30d × 24h × 60m/45m) = 3 840 queries/month
//   Combined with mil (5 400/mo): 9 240/mo, under the 10 k cap
const ADSBX_OCEAN_INTERVAL_MS = 45 * 60 * 1000;
const ADSBX_OCEAN_POINTS = [
  [40, -40],     // North Atlantic (NYC ↔ Europe corridor)
  [35, -170],    // North Pacific (NA ↔ East Asia corridor)
  [-10, 75],     // Indian Ocean (Europe ↔ Australia corridor)
  [-20, -140],   // South Pacific (Australia ↔ South America)
];

async function safeFetch(url, opts = {}, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
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

// ADSBx augmentation — global military aircraft feed. Merges into the same
// FLIGHTS map so they render alongside civilian traffic. Tagged so dossier
// can surface the source. Runs on its own interval (60 s) to conserve the
// RapidAPI quota.
async function refreshAdsbxMil() {
  const key = process.env.ADSBX_RAPIDAPI_KEY;
  if (!key) return;
  const j = await safeFetch('https://adsbexchange-com1.p.rapidapi.com/v2/mil/', {
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
    if (!last || Math.abs(last[0] - a.lon) > TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > TRACK_MIN_DLL) {
      track.push([a.lon, a.lat]);
      while (track.length > TRACK_MAX) track.shift();
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
// points and pulls aircraft within 250 nm via RapidAPI. Merges into the
// shared FLIGHTS map so they're indistinguishable from civilian aircraft
// in the UI, just with `source: 'adsbx-ocean'` for the dossier and for
// the prune to know how long to keep them around.
async function refreshAdsbxOcean() {
  const key = process.env.ADSBX_RAPIDAPI_KEY;
  if (!key) return;
  const headers = {
    'x-rapidapi-host': 'adsbexchange-com1.p.rapidapi.com',
    'x-rapidapi-key': key,
  };
  for (const [la, lo] of ADSBX_OCEAN_POINTS) {
    const j = await safeFetch(
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
      if (!last || Math.abs(last[0] - a.lon) > TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > TRACK_MIN_DLL) {
        track.push([a.lon, a.lat]);
        while (track.length > TRACK_MAX) track.shift();
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
        // Preserve mil tag if we already have it via the mil poller.
        source: prev?.mil ? 'adsbx-mil' : 'adsbx-ocean',
        mil: prev?.mil || false,
        _ts: now,
      });
    }
    // Small stagger so we don't thrash the RapidAPI host.
    await new Promise(r => setTimeout(r, 250));
  }
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
      const prev = FLIGHTS.get(hex);
      const track = prev?.track ? prev.track.slice() : [];
      // Append the new position only if the aircraft has actually moved —
      // stationary reports (taxiing, holding pattern) shouldn't fill the
      // buffer with dupes.
      const last = track[track.length - 1];
      if (!last || Math.abs(last[0] - a.lon) > TRACK_MIN_DLL || Math.abs(last[1] - a.lat) > TRACK_MIN_DLL) {
        track.push([a.lon, a.lat]);
        while (track.length > TRACK_MAX) track.shift();
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
    await new Promise(r => setTimeout(r, REQUEST_STAGGER_MS));
  }
  // Prune stale — per-source TTL from STALE_BY_SOURCE (defined at top).
  const nowPrune = Date.now();
  for (const [hex, f] of FLIGHTS) {
    const staleMs = STALE_BY_SOURCE[f.source] || STALE_MS;
    if (f._ts < nowPrune - staleMs) FLIGHTS.delete(hex);
  }
}

async function refreshLoop() {
  if (refreshRunning) return;
  refreshRunning = true;
  // Continuous poll loop — as soon as one hotspot pass finishes, sleep a
  // short cool-down and start the next. With ~85 hotspots × 110ms stagger
  // that's ~9.5s per cycle, plus the 2s cool-down = ~11s between same-plane
  // refreshes. Fast enough that airliners don't stutter visibly.
  while (true) {
    try { await refresh(); } catch {}
    await new Promise(r => setTimeout(r, REFRESH_COOLDOWN_MS));
  }
}

function startBackgroundJobs() {
  if (!refreshRunning) refreshLoop();
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
  // Only spin up the ADSBx pollers if the API key is present, and only
  // once per warm instance. The two pollers share quota so both run as
  // a pair — disabling one would be minimal saving.
  if (process.env.ADSBX_RAPIDAPI_KEY) {
    if (!adsbxMilTimer) {
      refreshAdsbxMil().catch(() => {});
      adsbxMilTimer = setInterval(() => { refreshAdsbxMil().catch(() => {}); }, ADSBX_MIL_INTERVAL_MS);
      adsbxMilTimer.unref?.();
    }
    if (!adsbxOceanTimer) {
      refreshAdsbxOcean().catch(() => {});
      adsbxOceanTimer = setInterval(() => { refreshAdsbxOcean().catch(() => {}); }, ADSBX_OCEAN_INTERVAL_MS);
      adsbxOceanTimer.unref?.();
    }
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
