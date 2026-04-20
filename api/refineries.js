// Oil refineries via OpenStreetMap Overpass API. OSM tagging for
// refineries is inconsistent — we query three common tag patterns and
// union the results. Filters out entries without a name (drops
// low-quality / incomplete tags).

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
(
  nwr["industrial"="oil_refinery"];
  nwr["industrial"="refinery"];
  nwr["man_made"="oil_refinery"];
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
    capacity_bpd: tags.capacity ? parseFloat(tags.capacity) || null : null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'refineries', query: QUERY, project });
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
