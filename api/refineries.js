// Oil refineries via OpenStreetMap Overpass API.
//
// OSM's `industrial=refinery` tag is semantically ambiguous — it covers
// oil refineries, sugar refineries, metal smelters, chemical plants,
// tank terminals, polymer plants, and generic industrial processing.
// Roughly 620 entries worldwide; only ~60 carry a disambiguating `product`
// tag. The remaining 560+ must be filtered heuristically by name.
//
// Two-stage filter:
//   1. HARD INCLUDES — strict `industrial=oil_refinery` / `man_made=oil_refinery`
//      tag, or a `product` tag containing oil/petroleum/gasoline/etc.
//   2. HARD REJECTS — name matches a non-oil pattern: chemical plants,
//      tank/gas terminals, polymer plants, smelters, sugar / paper mills,
//      cement plants. Carve-outs for petrochemical complexes (which are
//      oil-adjacent) and for "refinery terminals" (which are storage
//      facilities at real refineries).
//   3. Residual ambiguous entries: include if the name clearly says
//      "refinery" / "raffinerie" / etc. or if the operator tag is set
//      (OSM mappers generally only bother to tag oil refineries that way).
//      Otherwise reject to avoid polluting the layer.

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

// Oil-positive signals.
const OIL_PRODUCT_RE = /\b(oil|petroleum|petrol|crude|gasoline|diesel|kerosene|jet[-_ ]?fuel|naphtha|bitumen|asphalt|lpg|fuel[-_ ]?oil|lubricant|distillate)\b/i;

// Positive-name signals.
//   - `rafin|refin|raffin` stems catch refinery variants across English,
//     Spanish, Portuguese, French, German, Italian, Dutch, Romanian, etc.
//   - Product / crude-oil words.
//   - "Petrochem" / "petroquím" for oil-adjacent petrochemical complexes.
//   - A curated list of global oil & gas operators whose names alone are
//     sufficient signal (e.g. "Suncor", "Tamoil" — no product word in name).
const OIL_NAME_RE = new RegExp(
  '\\b(' +
    'rafin|refin|raffin|' +                         // refinery stems (multi-language, accent-free after normalize)
    'oil|petroleum|petrol|crude|fuel|gasoline|diesel|kerosene|naphtha|bitumen|asphalt|lubricant|neft|' +
    'petrochem|petroqu[íi]m|petroleo|nafta|' +
    // Oil & gas operators / brands
    'aramco|sonatrach|petrobras|petronor|pemex|sinopec|petrochina|cnpc|cnooc|' +
    'lukoil|rosneft|gazprom|novatek|tatneft|bashneft|surgutneft|' +
    'citgo|exxon|esso|shell|chevron|phillips\\s*66|valero|marathon|koch|hollyfrontier|crossbridge|' +
    'total\\b|totalenergies|bp\\b|eni\\b|galp|repsol|cepsa|preem|neste|orlen|mol\\b|omv|' +
    'hellenic\\s*petroleum|motor\\s*oil|tupra|turkmenbas|' +                 // accent-free
    'idemitsu|cosmo\\s*oil|eneos|jx\\s*nippon|' +
    'enap|ypf|ecopetrol|pdvsa|nioc|adnoc|kpc|qatarenergy|kazmunaigas|' +
    'suncor|tamoil|paramo|stanic|petroplus|gunvor|vitol|glencore|axion\\s*energy|exolum|' +
    'ioc[l]?|bharat\\s*petroleum|bpcl|hpcl|indianoil|hindustan\\s*petroleum|' +
    'rafo|arpechim' +
  ')',
  'i'
);

// Hard-reject patterns — each runs against the NAME (after NFD normalize).
// These catch the specific non-oil industrial categories that OSM maps
// under `industrial=refinery` or that carry "oil" in their names but
// refer to agricultural / food oils rather than petroleum.
const NON_OIL_PATTERNS = [
  // Sugar / food / forestry
  /\bsugar\b/i, /\bsucre\b/i, /\bacucar\b/i, /\bazucar\b/i, /\bzucker\b/i,
  /\bpaper[-_ ]?mill\b/i, /\bpulp[-_ ]?mill\b/i, /\bsawmill\b/i, /\bkraft\b/i,
  // Metals (smelters & refineries)
  /\bsteel\b/i, /\bstahl\b/i, /\bacier\b/i, /\bacciaio\b/i, /\bacero\b/i,
  /\bcopper\b/i, /\bkupfer\b/i, /\bcuivre\b/i, /\bcobre\b/i,
  /\baluminium\b/i, /\baluminum\b/i, /\balumina\b/i, /\bbauxite\b/i,
  /\bsmelter\b/i, /\bfundicion\b/i, /\bfonderie\b/i, /\bschmelze\b/i,
  /\blead\b/i, /\bzinc\b/i, /\bnickel\b/i,
  /\bgold\s+mine\b/i, /\bsilver\s+mine\b/i,
  // Salt / cement
  /\bsalt\b/i, /\bcement\b/i, /\bciment\b/i, /\bcemento\b/i, /\bzement\b/i,
  // Chemical plants — ALLOW "petrochemical" / "petrochem"
  /(?<!petro)(?<!petro\s)chemical[s]?\b/i,
  /(?<!petro)(?<!petro\s)chimique\b/i,
  /(?<!petro)(?<!petro\s)chimica\b/i,
  /(?<!petro)(?<!petro\s)chemie\b/i,
  /(?<!petro)(?<!petro\s)quimica\b/i,
  // Polymer / plastics
  /\bpolymer\b/i, /\bpolimer\b/i, /\bpolymere\b/i, /\bpolypropylene\b/i, /\bpolyethylene\b/i,
  // Coin / currency mints (Royal Mint, US Mint, etc.) — occasionally
  // mis-tagged as `industrial=refinery`.
  /\bmint\b/i, /\broyal\s*mint\b/i,
  // Water / wastewater treatment — sometimes tagged as refinery.
  /\bwastewater\b/i, /\bwater\s+treatment\b/i, /\bwater\s+plant\b/i, /\bsewage\b/i,
  // Beverage distilleries (whisky / vodka / etc.) — not oil.
  /\bdistillery\b/i, /\bdistillerie\b/i, /\bdistilleria\b/i,
  // Agricultural / food oils — the "oil" in their name is vegetable
  // oil, not petroleum. Palm oil mills especially get mis-tagged.
  /\bpalm\s+oil\b/i, /\bpalm[-_\s]?kernel\b/i, /\bpalm\s+mill\b/i,
  /\bolive\s+oil\b/i, /\bvegetable\s+oil\b/i, /\bcooking\s+oil\b/i,
  /\bcoconut\s+oil\b/i, /\bsoybean\s+oil\b/i, /\bcanola\s+oil\b/i,
  /\brapeseed\s+oil\b/i, /\bsunflower\s+oil\b/i, /\bpeanut\s+oil\b/i,
  /\bmustard\s+oil\b/i, /\bcastor\s+oil\b/i, /\bcopra\b/i,
  /\banimal\s+oil\b/i, /\bfish\s+oil\b/i, /\bessential\s+oil\b/i,
  /\blubricat(or|ion)\s+oil\b/i,
];

// Name signals that keep an entry even if "terminal" appears (because
// the terminal is at / part of an actual refinery).
const REFINERY_WORD_RE = /\b(refiner[íy]|refinaria|raffineri|raffinaderij|raffineria)\b/i;

// Strip diacritics so "pétrochimique" matches "petro..." lookbehinds
// and "Türkmenbaşy" matches "turkmenbas".
function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function project(el) {
  const tags = el.tags;
  const rawName = tags['name:en'] || tags.name;
  if (!rawName) return null;
  const name = rawName;
  // All regex tests run against the normalized (accent-stripped) form
  // so French/Turkish/Spanish oil-industry names match cleanly.
  const nName = normalize(rawName);

  // Stage 1: hard includes.
  const isStrictOilTag =
    tags.industrial === 'oil_refinery' ||
    tags['man_made'] === 'oil_refinery';
  const product = tags.product || '';
  const productIsOilLike = OIL_PRODUCT_RE.test(product);
  const productIsExplicitlyNonOil = product && !productIsOilLike;

  if (productIsExplicitlyNonOil) return null;

  const keepRecord = () => ({
    id: `osm-${el.type}-${el.id}`,
    name,
    operator: tags.operator || null,
    country: tags['addr:country'] || null,
    capacity_bpd: tags.capacity ? parseFloat(tags.capacity) || null : null,
    lat: el.lat,
    lon: el.lon,
  });

  if (isStrictOilTag || productIsOilLike) return keepRecord();

  // Stage 2: hard rejects by name pattern. Tests run against the
  // accent-normalized name so "pétrochimique" is preserved (the
  // `(?<!petro)` lookbehind matches the normalized "petro").
  for (const re of NON_OIL_PATTERNS) {
    if (re.test(nName)) return null;
  }

  // Terminal carve-out: reject "terminal" in name unless paired with a
  // refinery-word (then it's a refinery's adjacent terminal, keep it).
  if (/\b(tank\s*)?terminal\b/i.test(nName) && !REFINERY_WORD_RE.test(nName)) {
    return null;
  }

  // Stage 3: ambiguous residuals. Keep only if there's a positive oil
  // signal in the NAME or in the OPERATOR tag. Previous version kept
  // anything with an operator tag set, which let coin mints / water
  // plants / etc. through because they all have operator tags; now
  // the operator's text must itself match the oil regex.
  const hasOilNameSignal = OIL_NAME_RE.test(nName);
  const hasOilOperatorSignal =
    tags.operator && OIL_NAME_RE.test(normalize(tags.operator));
  if (hasOilNameSignal || hasOilOperatorSignal) return keepRecord();

  return null;
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
