// Flight route lookup — given an aircraft callsign (e.g. "UAL1234" /
// "BAW115"), returns the actual scheduled origin + destination
// airports so the client can draw the dep→arr great-circle on the
// globe and fill in the dossier.
//
// Data source: ADSBdb (https://adsbdb.com), a free community-run
// aviation database widely used in the ADS-B hobbyist ecosystem.
// Keyed by callsign; response is a single JSON object with full
// airline + origin + destination records (names, IATA/ICAO codes,
// lat/lon, country). No auth required.
//
// This replaces an earlier OpenSky /flights/aircraft implementation
// that went dark in 2025 when OpenSky restricted historical flights
// to paid Contributor tier. ADSBdb is free, covers essentially all
// scheduled commercial + cargo, and returns the exact route rather
// than OpenSky's "most recent logged flight" heuristic. Trade-off:
// no SLA, coverage follows community logging — ferry flights,
// charters, private, and military may miss (they did with OpenSky
// too).
//
// Caching:
//   - In-memory per-callsign cache, 10-minute TTL — route data for a
//     given flight number doesn't change within one flight.
//   - s-maxage=600 header lets Vercel's edge share the response across
//     clients so only the first user pays the ADSBdb round-trip.

export const config = { runtime: 'nodejs', maxDuration: 15 };

const ADSBDB_BASE      = 'https://api.adsbdb.com/v0/callsign/';
const ROUTE_CACHE_TTL  = 10 * 60 * 1000;

const routeCache = new Map();   // callsign → { t, route | null }

// Map ADSBdb airport object → the shape the client has rendered against
// since the OpenSky era. Keeping the contract stable means no UI
// changes downstream.
function mapAirport(a) {
  if (!a) return null;
  const lat = Number(a.latitude);
  const lon = Number(a.longitude);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  return {
    iata:    a.iata_code || null,
    icao:    a.icao_code || null,
    name:    a.name       || null,
    city:    a.municipality || null,
    country: a.country_name || null,
    lat:     +lat.toFixed(4),
    lon:     +lon.toFixed(4),
  };
}

async function fetchRoute(callsign) {
  const url = ADSBDB_BASE + encodeURIComponent(callsign);
  // Short client-side timeout so a single slow ADSBdb response doesn't
  // tie up the serverless invocation for its full 15 s budget.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404) return null;
    if (!res.ok)             throw new Error('adsbdb HTTP ' + res.status);
    const j = await res.json();
    const route = j?.response?.flightroute;
    // ADSBdb returns 200 with {"response": "unknown callsign"} when the
    // callsign isn't in their database. Treat that as a clean null.
    if (!route || typeof route !== 'object') return null;
    const dep = mapAirport(route.origin);
    const arr = mapAirport(route.destination);
    if (!dep || !arr) return null;
    return {
      callsign:      route.callsign_icao || callsign,
      callsign_iata: route.callsign_iata || null,
      dep,
      arr,
      airline: route.airline ? {
        name:     route.airline.name     || null,
        icao:     route.airline.icao     || null,
        iata:     route.airline.iata     || null,
        callsign: route.airline.callsign || null,
        country:  route.airline.country  || null,
      } : null,
    };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

export default async function handler(req, res) {
  const raw = (req.query?.callsign || '').toString().toUpperCase().trim();
  if (!/^[A-Z0-9]{3,10}$/.test(raw)) {
    res.status(400).json({ error: 'callsign required (alphanumeric 3–10 chars)' });
    return;
  }
  const callsign = raw;

  // Cache hit? (positive and negative — we don't re-query ADSBdb for
  // callsigns they don't know about until the TTL expires.)
  const cached = routeCache.get(callsign);
  if (cached && (Date.now() - cached.t) < ROUTE_CACHE_TTL) {
    if (!cached.route) { res.status(404).json({ error: 'unknown callsign' }); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(cached.route);
    return;
  }

  try {
    const route = await fetchRoute(callsign);
    routeCache.set(callsign, { t: Date.now(), route });
    if (!route) {
      res.setHeader('Cache-Control', 'public, s-maxage=600');
      res.status(404).json({ error: 'unknown callsign' });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(route);
  } catch (e) {
    console.warn('[flight-route] adsbdb fetch failed:', e?.message || e);
    res.status(502).json({ error: 'adsbdb unavailable', detail: String(e?.message || e) });
  }
}
