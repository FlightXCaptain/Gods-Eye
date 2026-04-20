// Major mines via OSM Overpass. Filters to `man_made=mine` with a
// name — excludes the vast pool of unnamed / historic / micro-scale
// quarries that `landuse=quarry` would include. Produces ~3,000
// named mines worldwide.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
(
  nwr["man_made"="mine"]["name"];
  nwr["industrial"="mine"]["name"];
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
    operator: tags.operator || null,
    resource: tags.resource || tags.mineral || tags['mining:mineral'] || null,
    country: tags['addr:country'] || null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'mines', query: QUERY, project });
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
