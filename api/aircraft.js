// Aircraft lookup by ICAO24 hex. Thin proxy over ADSBdb's
// /v0/aircraft/{hex} endpoint which returns the *registered owner* of
// a specific airframe — works even when the callsign lookup path
// can't help (tactical military callsigns that aren't airline
// designators, charter callsigns, etc.).
//
// Example payload the client gets back:
//   {
//     hex: "ae5c9c",
//     owner:   "United States Air Force",
//     country: "United States",
//     type:    "HC-130J Hercules",
//     manufacturer: "Lockheed",
//     reg:     "15-5829"
//   }
//
// Cached aggressively (7 days in memory + at the edge) since
// registration rarely changes within that window. Negative results
// cached briefly (1 h) in case ADSBdb adds coverage for a previously
// unknown hex.

export const config = { runtime: 'nodejs', maxDuration: 10 };

const ADSBDB_BASE = 'https://api.adsbdb.com/v0/aircraft/';

const cache = new Map();    // hex → { t, data | null }
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const NEG_CACHE_TTL = 60 * 60 * 1000;

async function fetchAdsbdb(hex) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(ADSBDB_BASE + encodeURIComponent(hex), {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const j = await res.json();
    const ac = j?.response?.aircraft;
    if (!ac) return null;
    return {
      hex,
      owner:        ac.registered_owner              || null,
      country:      ac.registered_owner_country_name || null,
      type:         ac.type       || ac.icao_type    || null,
      manufacturer: ac.manufacturer                   || null,
      reg:          ac.registration                   || null,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  const hex = (req.query?.hex || '').toString().toLowerCase().trim();
  if (!/^[a-f0-9]{6}$/.test(hex)) {
    res.status(400).json({ error: 'hex must be 6 hex chars' });
    return;
  }

  const hit = cache.get(hex);
  if (hit) {
    const age = Date.now() - hit.t;
    if (hit.data && age < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=604800');
      res.status(200).json(hit.data);
      return;
    }
    if (!hit.data && age < NEG_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.status(404).json({ error: 'unknown aircraft', hex });
      return;
    }
  }

  const data = await fetchAdsbdb(hex);
  cache.set(hex, { t: Date.now(), data });
  if (!data) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(404).json({ error: 'unknown aircraft', hex });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=604800');
  res.status(200).json(data);
}
