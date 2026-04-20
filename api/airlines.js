// Airlines lookup. Static data derived from OpenFlights' airlines.dat
// (CC BY-SA 3.0). The JSON file at src/data/airlines.json is the source
// of truth; this route serves it with long cache headers so the client
// only pays the download once per session and the edge shares the
// response across visitors.
//
// Keys are ICAO 3-letter airline codes (e.g. UAL, BAW, DLH). Values:
//   { name, iata|null, callsign|null, country|null }
//
// ICAO codes are the prefix of the callsigns the ADS-B layer already
// has (e.g. "UAL1234" → UAL → United Airlines), which makes client-side
// resolution trivial.
//
// ~5,800 entries, ~520 KB raw / ~80 KB gzipped. Fits comfortably in
// memory and parses fast.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'airlines.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const airlines = load();
    // Data changes at most a couple times a year (airlines folding,
    // new ICAO allocations). 30-day edge cache is safe, and
    // stale-while-revalidate means no user ever waits on a miss.
    res.setHeader('Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: Object.keys(airlines).length,
      airlines,
    });
  } catch (e) {
    console.warn('[airlines] load failed:', e?.message);
    res.status(500).json({ error: 'airlines data unavailable' });
  }
}
