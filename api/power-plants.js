// WRI Global Power Plant Database proxy. The upstream CSV is ~12 MB and
// static-ish (versioned releases, not a live feed), so we:
//   1. Fetch once per cold boot (Node fetch + stream parse).
//   2. Filter to capacity >= 100 MW — the user's stated threshold. This
//      drops ~24 k small distributed-generation plants and keeps ~10 k
//      utility-scale facilities globally.
//   3. Trim each row to the ~8 fields the UI actually uses.
//   4. Cache the processed array in module scope (shared across warm
//      invocations) and respond with ~1 MB JSON.
//
// Real cost is the one-time parse on cold boot (~400 ms). Every subsequent
// request is an in-memory array serialization.

import { parseCsvLine } from './_csv.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const SOURCE_URL = 'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv';
const MIN_MW = 100;

let cached = null;
let cachedAt = 0;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h — upstream only changes on version bumps

async function loadFleet() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`gppd fetch ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const idx = (k) => header.indexOf(k);
  const iName = idx('name'), iId = idx('gppd_idnr'),
        iCap = idx('capacity_mw'), iLat = idx('latitude'), iLon = idx('longitude'),
        iFuel = idx('primary_fuel'), iCountry = idx('country_long'),
        iYear = idx('commissioning_year'), iOwner = idx('owner');

  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const row = lines[li];
    if (!row) continue;
    const f = parseCsvLine(row);
    const mw = parseFloat(f[iCap]);
    if (!isFinite(mw) || mw < MIN_MW) continue;
    const lat = parseFloat(f[iLat]), lon = parseFloat(f[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    out.push({
      id: f[iId] || `p-${li}`,
      name: f[iName] || 'Plant',
      lon, lat,
      capacity: mw,
      fuel: (f[iFuel] || 'Other').trim(),
      country: f[iCountry] || '',
      year: parseInt(f[iYear], 10) || null,
      owner: f[iOwner] || null,
    });
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      cached = await loadFleet();
      cachedAt = now;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(200).json(cached);
  } catch (err) {
    return res.status(502).json({ error: 'fetch-failed', message: String(err) });
  }
}
