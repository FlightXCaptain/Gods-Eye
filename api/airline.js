// Single-ICAO airline lookup with fallback. Checks the local
// OpenFlights-derived airlines.json first (~5,800 carriers); on miss,
// falls back to ADSBdb's /v0/airline/{icao} endpoint (community-
// maintained, has much better coverage of regional carriers and some
// military designators). Caches the fallback result for a day so the
// endpoint doesn't re-hit ADSBdb on every view.
//
// Why this split:
// - /api/airlines (plural) serves the whole dataset for bulk client
//   lookup — 5,800 entries, one download per visitor per session.
// - /api/airline (singular) is the on-demand fallback for the 5–10%
//   of observed callsigns whose ICAOs aren't in the bulk dataset
//   (Endeavor, CommuteAir, Mexicana, etc. — mostly US regionals and
//   newer operators OpenFlights hasn't absorbed).

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

const ADSBDB_BASE = 'https://api.adsbdb.com/v0/airline/';

let local = null;
function loadLocal() {
  if (local) return local;
  const file = path.join(process.cwd(), 'src', 'data', 'airlines.json');
  local = JSON.parse(fs.readFileSync(file, 'utf8'));
  return local;
}

const cache = new Map();   // icao → { t, data | null }
const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchAdsbdb(icao) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(ADSBDB_BASE + encodeURIComponent(icao), {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const j = await res.json();
    // ADSBdb returns { response: [{ ... }] } on hit, { response: "invalid airline: XXX" } on miss.
    const arr = Array.isArray(j?.response) ? j.response : null;
    if (!arr?.length) return null;
    const a = arr[0];
    return {
      name:     a.name     || null,
      iata:     a.iata     || null,
      callsign: a.callsign || null,
      country:  a.country  || null,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  const icao = (req.query?.icao || '').toString().toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(icao)) {
    res.status(400).json({ error: 'icao must be 3 letters' });
    return;
  }

  // Local OpenFlights dataset first — fast path for the common case.
  try {
    const l = loadLocal();
    if (l[icao]) {
      res.setHeader('Cache-Control', 'public, s-maxage=2592000, stale-while-revalidate=2592000');
      res.status(200).json({ icao, ...l[icao], source: 'local' });
      return;
    }
  } catch (e) {
    console.warn('[airline] local load failed:', e?.message);
  }

  // ADSBdb fallback, with in-memory positive + negative cache.
  const hit = cache.get(icao);
  if (hit && (Date.now() - hit.t) < CACHE_TTL) {
    if (!hit.data) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.status(404).json({ error: 'unknown airline', icao });
      return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    res.status(200).json({ icao, ...hit.data, source: 'adsbdb-cached' });
    return;
  }

  const data = await fetchAdsbdb(icao);
  cache.set(icao, { t: Date.now(), data });
  if (!data) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(404).json({ error: 'unknown airline', icao });
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.status(200).json({ icao, ...data, source: 'adsbdb' });
}
