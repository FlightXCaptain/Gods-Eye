// Oil & gas pipelines layer. Curated static list of ~20 major cross-
// border / cross-regional pipelines with multi-waypoint paths. GEM's
// pipeline trackers 403 on direct access; OSM has 27k+ individual
// pipeline ways but querying and stitching them into named routes
// isn't tractable for a ~90s Vercel function. For the overview-level
// story (strategic petroleum/gas arteries), a curated list of major
// named pipelines is the right fidelity.
//
// Each entry's `path` is a GeoJSON-style array of [lon, lat] pairs;
// the globe renderer strokes a line through them using the current
// projection's great-circle-aware path generator.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'pipelines.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const pipelines = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: pipelines.length,
      features: pipelines,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
