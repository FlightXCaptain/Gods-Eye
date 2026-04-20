// LNG terminals layer. Curated static list — no upstream fetch.
// OSM's LNG tagging is inconsistent (< 15 properly-tagged terminals
// globally), so we ship ~35 curated major import/export facilities.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'lng-terminals.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const lng = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: lng.length,
      features: lng,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
