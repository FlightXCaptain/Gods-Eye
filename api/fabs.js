// Semiconductor fabs layer. Curated static list — no upstream fetch.
// The JSON file at src/data/fabs.json is the source of truth; this
// route just loads, wraps in the standard response envelope, and
// caches the parsed array in module scope.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'fabs.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const fabs = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: fabs.length,
      features: fabs,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
