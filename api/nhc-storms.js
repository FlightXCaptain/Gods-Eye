// National Hurricane Center CurrentStorms proxy.
//
// NHC's public endpoint at https://www.nhc.noaa.gov/CurrentStorms.json
// does not send Access-Control-Allow-Origin, so direct browser fetches
// fail with a CORS error. This tiny passthrough reads the upstream and
// returns the same JSON with permissive CORS headers. Kept thin — no
// transformation — so the client-side parser in fetchNHC() (which
// knows the schema) doesn't have to change.
//
// Cache TTL is 5 minutes. NHC publishes advisories every 3–6 hours,
// so 5 min is generous for liveness while avoiding hammering them.

export const config = { runtime: 'nodejs', maxDuration: 15 };

const TTL_MS = 5 * 60 * 1000;
let cache = null;
let cachedAt = 0;

export default async function handler(req, res) {
  const now = Date.now();
  if (!cache || now - cachedAt > TTL_MS) {
    try {
      const r = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json');
      if (!r.ok) throw new Error('nhc HTTP ' + r.status);
      cache = await r.json();
      cachedAt = now;
    } catch (err) {
      if (!cache) {
        res.status(502).json({ error: 'nhc-failed', message: String(err) });
        return;
      }
      // Stale-if-error: keep serving the old payload rather than 500.
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.status(200).json(cache);
}
