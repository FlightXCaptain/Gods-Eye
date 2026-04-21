// Military bases layer. Previously made a live OSM Overpass call per
// cold boot (~82 s), which was a brutal first-load experience. Now
// serves a static snapshot committed to src/data/military-bases.json
// (~9,200 features, 1.4 MB). The snapshot is rebuilt with
// `node scripts/build-military-bases.mjs` whenever it needs refreshing
// — military bases change slowly enough that quarterly is fine.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'military-bases.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const data = load();
    // Short CDN cache (5 min) with long stale-while-revalidate (7d) —
    // the underlying JSON is baked at build time so we can be generous.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=604800');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: data.length,
      features: data,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
