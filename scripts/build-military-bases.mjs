// One-off snapshot builder for the Military bases dataset.
//
// Runs the full four-tag OSM Overpass union query (base / airfield /
// naval_base / barracks with a name tag) and writes a trimmed JSON
// snapshot to src/data/military-bases.json. The /api/military-bases
// route serves this static snapshot instead of hitting Overpass on
// every cold boot — turns a ~82-second first-load fetch into an
// instant static file read.
//
// Re-run this script when you want to refresh the snapshot:
//   node scripts/build-military-bases.mjs
//
// The snapshot changes slowly (OSM mappers edit military bases at
// maybe a few per month globally), so running this quarterly is fine.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'military-bases.json');

const QUERY = `
[out:json][timeout:180];
(
  nwr["military"="base"]["name"];
  nwr["military"="airfield"]["name"];
  nwr["military"="naval_base"]["name"];
  nwr["military"="barracks"]["name"];
);
out center;
`;

function inferKind(tags) {
  const v = tags.military || '';
  if (v === 'airfield') return 'airfield';
  if (v === 'naval_base') return 'naval base';
  if (v === 'barracks') return 'barracks';
  return 'base';
}

function project(el) {
  const tags = el.tags || {};
  const name = tags['name:en'] || tags.name;
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    kind: inferKind(tags),
    operator: tags.operator || null,
    country: tags['addr:country'] || null,
    lat,
    lon,
  };
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function main() {
  console.log('Fetching military-bases snapshot from Overpass…');
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`→ ${endpoint}`);
      const t0 = Date.now();
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'gods-eye snapshot builder (+https://github.com/FlightXCaptain/gods-eye)',
        },
        body: 'data=' + encodeURIComponent(QUERY),
      });
      if (!r.ok) { lastErr = new Error(`${endpoint} ${r.status}`); continue; }
      const j = await r.json();
      const elapsed = Date.now() - t0;
      console.log(`  status ${r.status}, elapsed ${elapsed}ms`);
      if (j.remark && (!j.elements || j.elements.length === 0)) {
        lastErr = new Error(`Overpass remark: ${j.remark}`); continue;
      }
      const projected = (j.elements || []).map(project).filter(Boolean);
      console.log(`  raw elements: ${(j.elements || []).length}`);
      console.log(`  projected features: ${projected.length}`);
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(projected), 'utf8');
      console.log(`Wrote ${OUT} (${projected.length} features)`);
      return;
    } catch (e) {
      lastErr = e;
      console.error(`  error: ${e.message}`);
    }
  }
  throw lastErr || new Error('all overpass endpoints failed');
}

main().catch(e => { console.error(e); process.exit(1); });
