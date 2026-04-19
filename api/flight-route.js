// Flight route lookup. Given an ICAO24 transponder hex, returns the most
// recent flight's departure and arrival airports (resolved to lat/lon
// through OurAirports' open CSV). The client draws a great-circle from
// dep → arr on the globe when a flight is focused; the live ADS-B position
// from /api/flights-stream continues to mark the actual plane on top.
//
// Data sources:
//   - OpenSky Network  /flights/aircraft?icao24=&begin=&end=
//       Free public API. 400 credits/day anonymous, 4000/day authenticated.
//       Set OPENSKY_USERNAME + OPENSKY_PASSWORD to bump the quota.
//   - OurAirports airports.csv  (public-domain, refreshed daily)
//       ~13 MB. Fetched once per warm Fluid Compute instance and kept in
//       module memory for the lifetime of the instance.
//
// Caching:
//   - In-memory per-icao24 cache, 10-minute TTL — route data doesn't
//     meaningfully change that often within a single flight.
//   - s-maxage=600 header lets Vercel's edge share the response across
//     clients so only the first user pays the OpenSky round-trip.

export const config = { runtime: 'nodejs', maxDuration: 30 };

const AIRPORTS_URL      = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OPENSKY_BASE      = 'https://opensky-network.org/api';
const ROUTE_CACHE_TTL   = 10 * 60 * 1000;
const OPENSKY_WINDOW_S  = 14 * 3600;      // 12 h back + 2 h forward
const OPENSKY_LOOKBACK_S = 12 * 3600;

// ── Airport DB ──────────────────────────────────────────────────────

let airportsMap = null;       // Map<ICAO, { icao, iata, name, lat, lon, country }>
let airportsLoading = null;   // in-flight promise; prevents a thundering-herd fetch
                              // if multiple requests hit during cold start.

// Minimal CSV line parser that handles "quoted, strings, with commas".
// Good enough for OurAirports which uses standard RFC 4180 quoting.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadAirports() {
  if (airportsMap) return airportsMap;
  if (airportsLoading) return airportsLoading;
  airportsLoading = (async () => {
    const res = await fetch(AIRPORTS_URL);
    if (!res.ok) throw new Error('ourairports HTTP ' + res.status);
    const text = await res.text();
    const lines = text.split('\n');
    const header = parseCsvLine(lines[0] || '');
    // Column indices we care about. OurAirports rarely changes these but
    // we look them up by name to be defensive.
    const idx = {
      ident:  header.indexOf('ident'),
      type:   header.indexOf('type'),
      name:   header.indexOf('name'),
      lat:    header.indexOf('latitude_deg'),
      lon:    header.indexOf('longitude_deg'),
      country:header.indexOf('iso_country'),
      icao:   header.indexOf('icao_code'),
      iata:   header.indexOf('iata_code'),
      gps:    header.indexOf('gps_code'),
    };
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      // An airport might have ICAO in any of: icao_code, gps_code, or ident
      // (for entries that existed before ICAO codes were split out).
      const icao = (cols[idx.icao] || cols[idx.gps] || cols[idx.ident] || '').trim();
      if (!icao || icao.length !== 4) continue;
      const lat = parseFloat(cols[idx.lat]);
      const lon = parseFloat(cols[idx.lon]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      // Skip heliports / seaplane / closed unless they're the only match —
      // we want real airports first, so we overwrite only if we don't
      // already have an entry for this ICAO.
      const type = (cols[idx.type] || '').trim();
      if (map.has(icao) && (type.includes('heliport') || type.includes('seaplane') || type === 'closed')) continue;
      map.set(icao, {
        icao,
        iata:    (cols[idx.iata] || '').trim() || null,
        name:    (cols[idx.name] || '').trim(),
        lat, lon,
        country: (cols[idx.country] || '').trim() || null,
      });
    }
    console.log(`[flight-route] airports loaded: ${map.size}`);
    airportsMap = map;
    return map;
  })();
  try { return await airportsLoading; }
  finally { airportsLoading = null; }
}

// ── OpenSky ─────────────────────────────────────────────────────────

async function fetchMostRecentFlight(icao24) {
  const now   = Math.floor(Date.now() / 1000);
  const begin = now - OPENSKY_LOOKBACK_S;
  const end   = now + (OPENSKY_WINDOW_S - OPENSKY_LOOKBACK_S);
  const url = `${OPENSKY_BASE}/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`;
  const headers = {};
  const u = process.env.OPENSKY_USERNAME, p = process.env.OPENSKY_PASSWORD;
  if (u && p) headers.Authorization = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

  const res = await fetch(url, { headers });
  if (res.status === 404 || res.status === 429) return null;
  if (!res.ok) throw new Error('opensky HTTP ' + res.status);
  const flights = await res.json();
  if (!Array.isArray(flights) || !flights.length) return null;
  // Sort newest-first and pick the top one.
  flights.sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0));
  return flights[0];
}

// ── Response cache ──────────────────────────────────────────────────

const routeCache = new Map();   // icao24 → { t, route | null }

// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const raw = (req.query?.icao24 || '').toString().toLowerCase().trim();
  if (!/^[a-f0-9]{6}$/.test(raw)) {
    res.status(400).json({ error: 'icao24 must be 6 hex chars' });
    return;
  }
  const icao24 = raw;

  // Cache hit? (including negative-cache hits so we don't hammer OpenSky
  // for aircraft with no recent flight records.)
  const cached = routeCache.get(icao24);
  if (cached && (Date.now() - cached.t) < ROUTE_CACHE_TTL) {
    if (!cached.route) { res.status(404).json({ error: 'no recent flight' }); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(cached.route);
    return;
  }

  try {
    const [airports, flight] = await Promise.all([
      loadAirports(),
      fetchMostRecentFlight(icao24),
    ]);
    if (!flight || !flight.estDepartureAirport || !flight.estArrivalAirport) {
      routeCache.set(icao24, { t: Date.now(), route: null });
      res.status(404).json({ error: 'no recent flight' });
      return;
    }
    const dep = airports.get(flight.estDepartureAirport);
    const arr = airports.get(flight.estArrivalAirport);
    if (!dep || !arr) {
      // We found a flight but can't resolve one or both airports —
      // probably a private strip without an entry in OurAirports. Negative
      // cache so we don't retry aggressively.
      routeCache.set(icao24, { t: Date.now(), route: null });
      res.status(404).json({
        error: 'airport lookup failed',
        depIcao: flight.estDepartureAirport,
        arrIcao: flight.estArrivalAirport,
      });
      return;
    }
    const route = {
      icao24,
      callsign:      (flight.callsign || '').trim() || null,
      dep, arr,
      departureTime: flight.firstSeen || null,
      arrivalTime:   flight.lastSeen || null,
    };
    routeCache.set(icao24, { t: Date.now(), route });
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    res.status(200).json(route);
  } catch (e) {
    console.warn('[flight-route] failed:', e.message);
    res.status(502).json({ error: 'upstream failed', detail: e.message });
  }
}
