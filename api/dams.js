// Major dams via OpenStreetMap Overpass API. OSM has thousands of
// small dams tagged `waterway=dam`; we filter to those that also carry
// a `dam:type` tag, which OSM mappers apply to notable / engineered
// dams (gravity, arch, embankment, etc.). That produces ~200 entries
// globally — roughly the "major dams" set without needing a volume
// or height threshold that OSM tagging doesn't reliably carry.
//
// Pivoted from GRanD (which gates downloads behind NASA Earthdata
// login) for the same reason we pivoted refineries from GEM — need
// an auth-less server-reachable source.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
(
  nwr["waterway"="dam"]["dam:type"];
);
out center;
`;

function project(el) {
  const tags = el.tags;
  const name = tags['name:en'] || tags.name;
  if (!name) return null;
  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    dam_type: tags['dam:type'] || null,
    height_m: tags.height ? parseFloat(tags.height) || null : null,
    river: tags.river || tags['waterway:name'] || null,
    country: tags['addr:country'] || null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'dams', query: QUERY, project });
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
