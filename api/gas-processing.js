// Gas processing plants — curated static list of ~20 major natural-
// gas processing / treatment facilities worldwide. Distinct from LNG
// terminals (which are liquefaction/regasification endpoints) — these
// are the upstream treatment plants that clean raw gas before it
// enters the LNG chain or long-haul pipelines.
//
// OSM's `industrial=gas` tag is too broad (~7500 matches including
// distribution, compressor stations, fuel stations) to filter into
// processing plants alone, so we ship a curated list.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'gas-processing.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const data = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: data.length,
      features: data,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
