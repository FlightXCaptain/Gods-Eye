// Smelters & mills — non-oil industrial refining / processing plants
// via OSM Overpass. Covers metal smelters (steel, aluminium, copper,
// lead, zinc) and sugar refineries / mills. Explicitly distinct from
// the oil refineries layer which filters for petroleum-specific
// entries; this layer captures the other half of `industrial=refinery`.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
(
  nwr["industrial"="smelter"];
  nwr["industrial"="steel"];
  nwr["industrial"="aluminium_smelter"];
  nwr["industrial"="aluminium"];
  nwr["industrial"="copper_smelter"];
  nwr["industrial"="copper"];
  nwr["industrial"="lead_smelter"];
  nwr["industrial"="zinc_smelter"];
  nwr["industrial"="sugar_refinery"];
  nwr["industrial"="sugar_mill"];
  nwr["industrial"="sugar"];
);
out center;
`;

function inferKind(tags) {
  const v = tags.industrial || '';
  if (v.includes('sugar')) return 'sugar';
  if (v.includes('steel')) return 'steel';
  if (v.includes('aluminium') || v.includes('aluminum')) return 'aluminium';
  if (v.includes('copper')) return 'copper';
  if (v.includes('lead')) return 'lead';
  if (v.includes('zinc')) return 'zinc';
  if (v === 'smelter') return 'smelter';
  return 'other';
}

function project(el) {
  const tags = el.tags;
  const name = tags['name:en'] || tags.name;
  if (!name) return null;
  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    operator: tags.operator || null,
    kind: inferKind(tags),
    country: tags['addr:country'] || null,
    lat: el.lat,
    lon: el.lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadOverpassDataset({ id: 'smelters', query: QUERY, project });
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
