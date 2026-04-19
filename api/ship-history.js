// Ship position history — reads from Neon Postgres.
//
// Writes are performed by api/ships-stream.js at ~30-min intervals per
// MMSI. This endpoint answers the client's "give me the track for vessel
// X over the last 30 days" query.
//
// Graceful no-op when DATABASE_URL isn't set: returns 503 with
// {auth_required: true} so the client silently falls back to its
// IndexedDB-accumulated history.

import { shipDb, shipDbReady, ensureShipSchema } from './_ship-db.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

export default async function handler(req, res) {
  const mmsiRaw = (req.query?.mmsi || '').toString().trim();
  const mmsi = parseInt(mmsiRaw, 10);
  if (!Number.isInteger(mmsi) || mmsi <= 0) {
    res.status(400).json({ error: 'mmsi must be a positive integer' });
    return;
  }
  if (!shipDbReady) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(503).json({
      error: 'ship history db unavailable',
      detail: 'Install Neon Postgres via the Vercel Marketplace to enable server-side history.',
      auth_required: true,
    });
    return;
  }

  const days = Math.min(30, Math.max(1, parseInt(req.query?.days || '30', 10) || 30));
  const cutoffSec = Math.floor((Date.now() - days * 24 * 3600 * 1000) / 1000);

  try {
    await ensureShipSchema();
    const rows = await shipDb`
      SELECT t, lat, lon, sog, cog
      FROM ship_positions
      WHERE mmsi = ${mmsi} AND t >= ${cutoffSec}
      ORDER BY t ASC
    `;
    const positions = rows.map(r => ({
      // Emit epoch ms to match the client's IndexedDB format.
      t:   r.t * 1000,
      lat: r.lat,
      lon: r.lon,
      sog: r.sog != null ? r.sog / 10 : null,
      cog: r.cog != null ? r.cog      : null,
    }));
    const out = {
      mmsi,
      source: 'server',
      positions,
      firstSeen: positions[0]?.t ?? null,
      lastSeen:  positions[positions.length - 1]?.t ?? null,
      count:     positions.length,
    };
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json(out);
  } catch (e) {
    console.warn('[ship-history] query failed:', e.message);
    res.status(502).json({ error: 'db query failed', detail: e.message });
  }
}
