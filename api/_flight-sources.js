// Free ADS-B aggregators queried per hotspot by api/stream.js.
//
// Each source has its own request shape, response key and rate limit, so
// they're described here instead of assuming one URL pattern for all:
//
//   adsb.fi   /api/v2/lat/{lat}/lon/{lon}/dist/{nm} → { aircraft: [...] }
//             documented limit ≈ 1 req/s per IP.
//   adsb.lol  /v2/point/{lat}/{lon}/{nm}            → { ac: [...] }
//             403s generic User-Agents; 429s aggressively, so it gets a
//             long back-off and mostly fills in while adsb.fi is paced.
//
// airplanes.live was dropped: it now returns 403 to unregistered projects
// (they ask projects to email contact@airplanes.live for access).
//
// The old loop hit all three hosts every 110 ms when they failed — about
// 27 rejected requests/s, which is the kind of traffic that gets an IP
// blocked. Pacing below keeps each source under its limit, and a source
// that answers 403/429 is left alone for FLIGHT_BACKOFF_MS.

export const FLIGHT_UA = 'gods-eye/1.0 (+https://github.com/FlightXCaptain/Gods-Eye)';
export const FLIGHT_BACKOFF_MS = 60_000;
const FLIGHT_TIMEOUT_MS = 8_000;
const RADIUS_NM = 250;

export function makeSources() {
  return [
    { name: 'adsb.fi',  minGapMs: 1100, nextAt: 0,
      url: (la, lo) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${RADIUS_NM}` },
    { name: 'adsb.lol', minGapMs: 1100, nextAt: 0,
      url: (la, lo) => `https://api.adsb.lol/v2/point/${la}/${lo}/${RADIUS_NM}` },
  ];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Returns the aircraft array for one hotspot, or [] if every source is
// unavailable. An empty array from a healthy source (open ocean) is a
// real answer and is returned as-is rather than retried elsewhere.
export async function fetchHotspot(sources, la, lo, { fetchImpl = fetch, now = Date.now } = {}) {
  // Earliest-available first, so two healthy sources alternate and a full
  // sweep takes roughly half as long as using either alone.
  const order = sources.slice().sort((a, b) => a.nextAt - b.nextAt);
  for (const src of order) {
    const wait = src.nextAt - now();
    if (wait > src.minGapMs) continue;          // backing off — try another
    if (wait > 0) await sleep(wait);
    src.nextAt = now() + src.minGapMs;
    try {
      const res = await fetchImpl(src.url(la, lo), {
        headers: { 'User-Agent': FLIGHT_UA },
        signal: AbortSignal.timeout(FLIGHT_TIMEOUT_MS),
      });
      if (res.status === 403 || res.status === 429) {
        src.nextAt = now() + FLIGHT_BACKOFF_MS;
        continue;
      }
      if (!res.ok) continue;
      const j = await res.json();
      return j.ac || j.aircraft || [];
    } catch {
      continue;
    }
  }
  return [];
}
