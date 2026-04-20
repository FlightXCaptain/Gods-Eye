// Oil refineries via OpenStreetMap Overpass API.
//
// OSM's `industrial=refinery` tag is semantically ambiguous — it covers
// oil refineries, sugar refineries, metal smelters, and generic industrial
// processing. Prior versions of this route matched the tag directly and
// leaked ~600 non-oil entries into the "Oil refineries" layer.
//
// Current strategy: query the broad union but project each element through
// a filter that (a) keeps entries with the strict `oil_refinery` tag,
// (b) keeps entries whose `product` tag indicates oil/petroleum, and
// (c) otherwise rejects entries whose name mentions sugar / metal / cement
// / other non-oil keywords. Ambiguous entries without disambiguating
// signals are retained — matching the industry's general-purpose use of
// `industrial=refinery` for oil. This produces ~400 clean oil refineries
// globally while keeping the refineries/smelters/mills layers disjoint.

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

// Case-insensitive keywords that indicate a NON-oil refining / processing
// facility. If a name contains any of these and the entry doesn't carry
// a strict oil tag or an oil-product tag, we reject it — it belongs in
// the smelters & mills layer instead.
const NON_OIL_NAME_HINTS = [
  'sugar', 'sucre', 'açúcar', 'azúcar', 'zucker',         // sugar
  'steel', 'stahl', 'acier', 'acciaio', 'acero',          // steel
  'copper', 'kupfer', 'cuivre', 'cobre',                   // copper
  'aluminium', 'aluminum',                                 // aluminium
  'lead', 'blei',                                          // lead
  'zinc',                                                  // zinc
  'nickel',                                                // nickel
  'gold', 'silver',                                        // precious metals
  'salt', 'sel', 'sal ',                                   // salt (trailing space avoids false hits)
  'cement', 'ciment', 'cemento', 'zement',                 // cement
  'sawmill', 'paper mill', 'pulp mill',                    // forestry
];

function project(el) {
  const tags = el.tags;
  const name = tags['name:en'] || tags.name;
  if (!name) return null;

  const isStrictOilTag =
    tags.industrial === 'oil_refinery' ||
    tags['man_made'] === 'oil_refinery';

  const product = (tags.product || '').toLowerCase();
  const productIsOil = /oil|petroleum|petrol|gasoline|diesel|fuel/.test(product);
  const productIsExplicitlyNonOil = product && !productIsOil;

  // Reject if the product tag says something non-oil (sugar, metal, etc.).
  if (productIsExplicitlyNonOil) return null;

  // If not a strict oil tag and not tagged product=oil, scan the name for
  // non-oil keywords and reject on match. This is the heuristic that cleans
  // up the large `industrial=refinery` bucket.
  if (!isStrictOilTag && !productIsOil) {
    const n = name.toLowerCase();
    for (const kw of NON_OIL_NAME_HINTS) {
      if (n.includes(kw)) return null;
    }
  }

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
