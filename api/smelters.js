// Smelters, mills, and non-oil refineries via OSM Overpass.
//
// Scope:
//   • Explicit metal smelters (steel, aluminium, copper, lead, zinc)
//   • Alumina / bauxite refineries
//   • Sugar refineries & mills
//   • Generic `industrial=refinery` entries whose NAME identifies them
//     as non-oil (sugar, metal, alumina, salt, cement, chemical, polymer,
//     paper/pulp) — MIRRORS the oil refineries filter so any entry
//     rejected there shows up here instead, rather than vanishing.
//
// Net effect: users see ALL industrial refineries on the globe —
// oil variants in the Oil refineries sub-layer, everything else in
// Smelters & mills. Neither layer has accidental overlap.

import { loadOverpassDataset } from './_overpass.js';

export const config = { runtime: 'nodejs', maxDuration: 90 };

const QUERY = `
[out:json][timeout:60];
(
  nwr["industrial"="smelter"];
  nwr["industrial"="steel"];
  nwr["industrial"="aluminium_smelter"];
  nwr["industrial"="aluminium"];
  nwr["industrial"="alumina_refinery"];
  nwr["industrial"="alumina_plant"];
  nwr["industrial"="alumina"];
  nwr["industrial"="copper_smelter"];
  nwr["industrial"="copper"];
  nwr["industrial"="lead_smelter"];
  nwr["industrial"="zinc_smelter"];
  nwr["industrial"="sugar_refinery"];
  nwr["industrial"="sugar_mill"];
  nwr["industrial"="sugar"];
  nwr["industrial"="refinery"];
);
out center;
`;

// Strip diacritics so French / Spanish / Turkish names match the
// English-stem regexes below.
function normalize(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// A raw `industrial=refinery` entry is included here IFF its name
// matches one of these non-oil keywords. Kept in lockstep with the oil
// refineries NON_OIL_PATTERNS list so the two layers don't overlap.
const NON_OIL_NAME_RE = new RegExp(
  '\\b(' +
    'sugar|sucre|acucar|azucar|zucker|' +
    'paper[-_ ]?mill|pulp[-_ ]?mill|sawmill|kraft|' +
    'steel|stahl|acier|acciaio|acero|' +
    'copper|kupfer|cuivre|cobre|' +
    'aluminium|aluminum|alumina|bauxite|' +
    'smelter|fundicion|fonderie|schmelze|' +
    'lead|zinc|nickel|' +
    'salt|' +
    'cement|ciment|cemento|zement|' +
    'polymer|polimer|polymere|polypropylene|polyethylene|' +
    // Agricultural / food-oil mills (palm, olive, etc.) — these DO
    // refine a commodity (crude palm oil → refined palm oil) so they
    // belong in Smelters & mills rather than dropped entirely.
    'palm\\s+oil|palm[-_\\s]?kernel|palm\\s+mill|' +
    'olive\\s+oil|vegetable\\s+oil|cooking\\s+oil|' +
    'coconut\\s+oil|soybean\\s+oil|canola\\s+oil|rapeseed\\s+oil|' +
    'sunflower\\s+oil|peanut\\s+oil|mustard\\s+oil|castor\\s+oil|copra' +
  ')\\b',
  'i'
);

// Infer a kind label for the detail card. Checks explicit tag first,
// falls back to a name-keyword sniff.
function inferKind(tags, nName) {
  const v = (tags.industrial || '').toLowerCase();
  if (v.includes('sugar')) return 'sugar';
  if (v.includes('steel')) return 'steel';
  if (v.includes('alumina')) return 'alumina';
  if (v.includes('aluminium') || v.includes('aluminum')) return 'aluminium';
  if (v.includes('copper')) return 'copper';
  if (v.includes('lead')) return 'lead';
  if (v.includes('zinc')) return 'zinc';
  if (v === 'smelter') return 'smelter';
  // Sniff name for explicit keyword
  if (/alumina|bauxite/i.test(nName)) return 'alumina';
  if (/sugar|sucre|acucar|azucar|zucker/i.test(nName)) return 'sugar';
  if (/steel|stahl|acier|acciaio|acero/i.test(nName)) return 'steel';
  if (/copper|kupfer|cuivre|cobre/i.test(nName)) return 'copper';
  if (/aluminium|aluminum/i.test(nName)) return 'aluminium';
  if (/\bzinc\b/i.test(nName)) return 'zinc';
  if (/\blead\b/i.test(nName)) return 'lead';
  if (/\bnickel\b/i.test(nName)) return 'nickel';
  if (/cement|ciment|cemento|zement/i.test(nName)) return 'cement';
  if (/paper|pulp|sawmill|kraft/i.test(nName)) return 'paper';
  if (/salt/i.test(nName)) return 'salt';
  if (/polymer|polimer|polymere|polypropylene|polyethylene/i.test(nName)) return 'polymer';
  if (/palm\s+oil|palm[-_\s]?kernel|palm\s+mill|copra/i.test(nName)) return 'palm oil';
  if (/olive\s+oil/i.test(nName)) return 'olive oil';
  if (/vegetable\s+oil|cooking\s+oil|coconut\s+oil|soybean\s+oil|canola\s+oil|rapeseed\s+oil|sunflower\s+oil|peanut\s+oil|mustard\s+oil|castor\s+oil/i.test(nName)) return 'vegetable oil';
  return 'other';
}

function project(el) {
  const tags = el.tags;
  const rawName = tags['name:en'] || tags.name;
  if (!rawName) return null;
  const nName = normalize(rawName);

  // If the element's `industrial` tag is specifically a smelter/mill
  // type (anything other than the ambiguous 'refinery'), keep it.
  const explicit = tags.industrial && tags.industrial !== 'refinery';
  if (!explicit) {
    // It's `industrial=refinery` — include only if name identifies
    // it as non-oil. Otherwise it either belongs in oil refineries
    // or is genuinely ambiguous.
    if (!NON_OIL_NAME_RE.test(nName)) return null;
  }

  return {
    id: `osm-${el.type}-${el.id}`,
    name: rawName,
    operator: tags.operator || null,
    kind: inferKind(tags, nName),
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
