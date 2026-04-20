// Cement plants via OSM Overpass. `industrial=cement` is well-tagged
// globally — ~465 entries, mostly named portland-cement production
// facilities. No post-filter needed.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const QUERY = `
[out:json][timeout:45];
(
  nwr["industrial"="cement"];
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
    country: tags['addr:country'] || null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'cement', query: QUERY, project });
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
