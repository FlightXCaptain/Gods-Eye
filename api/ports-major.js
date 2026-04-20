// Major ports layer. Curated static list of ~50 top ports by TEU,
// strategic importance, or commodity throughput. NGA's World Port
// Index is public domain but ships as a shapefile ZIP which would
// need a shapefile parser; for this scale (~50 top ports) a curated
// JSON is simpler and the coverage is more selective anyway.
//
// The existing `src/ports.jsx` lookup table (for AIS destination
// resolution) is unrelated and remains untouched — this API serves a
// different curated subset for the map layer.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'ports-major.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const ports = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: ports.length,
      features: ports,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
