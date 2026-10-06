// NASA FIRMS — near-real-time active fire thermal anomalies.
//
// FIRMS aggregates multiple satellite fire-detection sensors (VIIRS and
// MODIS). A "fire" in FIRMS is a single hot pixel that the satellite
// saw on its last pass (~3-hour latency). Unlike EONET's "named wildfire
// events" (~30 worldwide), FIRMS gives the actual fire lines spreading
// across California, Australia, Siberia — tens of thousands of points
// per day globally.
//
// Auth:
//   FIRMS_MAP_KEY        — free key from
//                          https://firms.modaps.eosdis.nasa.gov/api/map_key/
//                          (email-only, 30-second registration)
//
// Without the key, this endpoint returns 503 + auth_required so the
// client cleanly hides the layer rather than surfacing errors.
//
// Upstream:
//   GET /api/area/csv/{MAP_KEY}/{sensor}/world/{days}
//   Returns CSV, headers + one row per detection. We parse and strip to
//   just {lat, lon, conf, bright, t} to minimise payload.

export const config = { runtime: 'nodejs', maxDuration: 60 };

const CACHE_TTL_MS = 30 * 60 * 1000;   // FIRMS updates ~3×/day; 30 min is generous
let cache = null;

// VIIRS has the best resolution (375 m) and most pixels per day. SNPP has
// been up longest and is most reliable; NOAA-20 has better morning
// coverage. For world/2-day coverage, SNPP gives ~30-50k pixels — plenty
// without hammering the NASA quota.
//
// DAYS = 2 (not 1), because FIRMS's "world/1" means strictly "today UTC".
// NRT processing has ~3-hour latency, so for the first chunk of every
// new UTC day the response is empty — looks like the layer broke. With
// DAYS=2 we always have today + yesterday's pixels visible, with the
// client filtering by acq time if a tighter window is needed.
const SENSOR = 'VIIRS_SNPP_NRT';
const DAYS   = 2;

function parseCsv(text) {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const iLat   = header.indexOf('latitude');
  const iLon   = header.indexOf('longitude');
  const iConf  = header.indexOf('confidence');
  const iBr    = header.indexOf('brightness');
  const iDate  = header.indexOf('acq_date');
  const iTime  = header.indexOf('acq_time');
  const iDay   = header.indexOf('daynight');
  const iFrp   = header.indexOf('frp');
  if (iLat < 0 || iLon < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',');
    const lat = parseFloat(cols[iLat]);
    const lon = parseFloat(cols[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // confidence: VIIRS → 'l'|'n'|'h' (low/nominal/high). Normalise to 0..2.
    const rawConf = (cols[iConf] || '').trim().toLowerCase();
    const conf = rawConf === 'h' ? 2 : rawConf === 'n' ? 1 : rawConf === 'l' ? 0 : 1;
    const bright = parseFloat(cols[iBr]) || null;
    const frp    = parseFloat(cols[iFrp]) || null;
    // Combine acq_date (YYYY-MM-DD) + acq_time (HHMM, UTC) into epoch ms.
    let t = null;
    if (iDate >= 0 && iTime >= 0) {
      const d = (cols[iDate] || '').trim();
      const tm = (cols[iTime] || '').trim().padStart(4, '0');
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && /^\d{4}$/.test(tm)) {
        const iso = `${d}T${tm.slice(0, 2)}:${tm.slice(2, 4)}:00Z`;
        const parsed = Date.parse(iso);
        if (isFinite(parsed)) t = parsed;
      }
    }
    out.push({
      lat: +lat.toFixed(3),
      lon: +lon.toFixed(3),
      conf,
      bright: bright != null ? Math.round(bright) : null,
      frp:    frp != null    ? +frp.toFixed(1)    : null,
      t,
      day: (cols[iDay] || '').trim() === 'D',
    });
  }
  return out;
}

async function fetchFires(key) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${SENSOR}/world/${DAYS}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'gods-eye/1.0' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`firms HTTP ${res.status} ${body.slice(0, 80)}`);
  }
  const text = await res.text();
  // FIRMS sometimes returns HTML / error pages with 200 when the key is
  // missing/bad; sniff for the expected CSV header.
  if (!/^latitude,longitude/i.test(text.trim())) {
    throw new Error('firms returned non-CSV response (check MAP_KEY)');
  }
  return parseCsv(text);
}

export default async function handler(req, res) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    res.status(503).json({
      error: 'firms auth required',
      detail: 'Set FIRMS_MAP_KEY — free key from https://firms.modaps.eosdis.nasa.gov/api/map_key/',
      auth_required: true,
    });
    return;
  }

  const now = Date.now();
  if (!cache || (now - cache.generatedAt) > CACHE_TTL_MS) {
    try {
      const fires = await fetchFires(key);
      cache = { generatedAt: now, sensor: SENSOR, days: DAYS, fires };
      console.log(`[fires] loaded ${fires.length} detections from ${SENSOR}/${DAYS}d`);
    } catch (e) {
      console.warn('[fires] fetch failed:', e.message);
      if (!cache) { res.status(502).json({ error: 'firms unavailable' }); return; }
      // Keep serving the stale cache until we succeed again.
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.status(200).json(cache);
}
