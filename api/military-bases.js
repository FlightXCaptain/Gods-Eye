// Military bases via OSM Overpass. Publicly-known installations only —
// what OSM mappers have documented from satellite imagery and open
// government sources. Coverage is strong for US / NATO / Australia /
// Japan, decent for major powers visible from satellite (Russia, China),
// thinner for closed states (DPRK, etc.) — see PR notes for the
// transparency caveat shown in the detail card.
//
// Tag union:
//   military=base         (bases — ~4,500 named globally)
//   military=airfield     (military aviation)
//   military=naval_base   (naval facilities)
//   military=barracks     (infantry garrisons)
// `landuse=military` deliberately EXCLUDED because it's often large
// polygons (training areas, impact ranges) that would clutter rather
// than inform — users care about installations, not range boundaries.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
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
  const tags = el.tags;
  const name = tags['name:en'] || tags.name;
  if (!name) return null;
  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    kind: inferKind(tags),
    operator: tags.operator || null,
    country: tags['addr:country'] || null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'military-bases', query: QUERY, project });
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
