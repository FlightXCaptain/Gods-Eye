// Submarine cable proxy. TeleGeography's public endpoint doesn't send
// Access-Control-Allow-Origin, so a direct browser fetch fails. We mirror
// the response server-side with a long cache (the dataset is updated on a
// weekly-to-monthly cadence, so 6 hours is conservative).

export const config = { runtime: 'nodejs', maxDuration: 15 };

const SOURCE_URL = 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json';
const TTL_MS = 6 * 60 * 60 * 1000;

let cached = null;
let cachedAt = 0;

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      const r = await fetch(SOURCE_URL);
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const j = await r.json();
      // Trim to just the fields the UI uses — halves payload size by
      // dropping landing-point metadata and alt color schemes.
      const out = (j.features || []).map(f => ({
        id: f.properties?.id || f.properties?.feature_id || null,
        name: f.properties?.name || 'Unnamed cable',
        color: f.properties?.color || '#22d3ee',
        geometry: f.geometry,
      }));
      cached = out;
      cachedAt = now;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(200).json(cached);
  } catch (err) {
    return res.status(502).json({ error: 'fetch-failed', message: String(err) });
  }
}
