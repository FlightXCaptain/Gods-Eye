// Cameras feed. Merges every source we can reach:
//
//   - Windy Webcams v3   — bulk, ~20k globally, paginated (needs key)
//   - NPS developer API  — ~200 US National Park cams, many with HLS streams (needs key)
//   - USGS volcano cams  — curated ~30 cams, refreshing stills (no API exists)
//   - NOAA observatories — curated partial list, refreshing stills
//
// Env vars (all optional — Windy/NPS fall back silently when unset):
//   WINDY_WEBCAMS_KEY   Windy Webcams v3 API key
//   NPS_API_KEY         developer.nps.gov key
//
// Each camera on the wire:
//   {
//     id, title, lat, lon, category, source,
//     thumbnailUrl, pageUrl,
//     embed: { type, ... }
//   }
//
// Embed shapes:
//   { type: 'iframe',         url }                        // Windy player
//   { type: 'image-refresh',  url, refreshSec }            // USGS / NOAA stills
//   { type: 'hls',            url, posterUrl? }            // some NPS streams
//   { type: 'link-only' }                                  // nothing embeddable

export const config = { runtime: 'nodejs', maxDuration: 60 };

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache = null;

// ---------- Windy v3 --------------------------------------------------------
//
// Pagination: limit max is 50 per call on the developer tier. 20k+ cams ≈
// 400+ calls. We fan out in parallel (bounded concurrency) and stop early
// if we hit a 429.

const WINDY_BATCH_LIMIT = 50;
const WINDY_CONCURRENCY = 6;

async function fetchWindyPage(key, offset) {
  const url = `https://api.windy.com/webcams/api/v3/webcams`
    + `?limit=${WINDY_BATCH_LIMIT}&offset=${offset}`
    + `&include=images,location,urls,categories`;
  const res = await fetch(url, { headers: { 'x-windy-api-key': key } });
  if (!res.ok) {
    if (res.status === 429) { const e = new Error('windy rate limit'); e.rate = true; throw e; }
    throw new Error('windy HTTP ' + res.status);
  }
  return res.json();
}

async function fetchAllWindy(key) {
  const out = [];
  const first = await fetchWindyPage(key, 0).catch(e => {
    console.warn('[cameras] windy first page failed:', e.message);
    return null;
  });
  if (!first) return out;
  const total = first.total || (first.webcams?.length || 0);
  console.log(`[cameras] windy total = ${total}`);
  pushWindy(out, first.webcams);

  const offsets = [];
  for (let o = WINDY_BATCH_LIMIT; o < total; o += WINDY_BATCH_LIMIT) offsets.push(o);

  let cursor = 0;
  let hitRateLimit = false;
  async function worker() {
    while (cursor < offsets.length && !hitRateLimit) {
      const myOffset = offsets[cursor++];
      try {
        const page = await fetchWindyPage(key, myOffset);
        pushWindy(out, page.webcams);
      } catch (e) {
        if (e.rate) { hitRateLimit = true; console.warn('[cameras] windy rate limited at', myOffset); }
        else console.warn('[cameras] windy page failed at', myOffset, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: WINDY_CONCURRENCY }, worker));
  console.log(`[cameras] windy fetched ${out.length} / ${total}`);
  return out;
}

function pushWindy(out, webcams) {
  if (!Array.isArray(webcams)) return;
  for (const w of webcams) {
    const lat = w.location?.latitude;
    const lon = w.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const webcamId = w.webcamId;
    // Windy's public embed player. The correct URL shape — discovered via
    // the 400 error body — is query-param form: ?webcamId=…&playerType=….
    // playerType must be one of [live, day, month, year, lifetime]. We use
    // "live" so cams with a live stream play through; cams without one fall
    // back gracefully to the most recent frame inside Windy's own player.
    const embedUrl = `https://webcams.windy.com/webcams/public/embed/player?webcamId=${webcamId}&playerType=live`;
    out.push({
      id: 'windy-' + webcamId,
      title: w.title || 'Webcam',
      lat, lon,
      category: mapWindyCategory(w.categories?.[0]?.id),
      source: 'windy',
      thumbnailUrl: w.images?.current?.preview || w.images?.current?.thumbnail || null,
      pageUrl: w.urls?.detail || null,
      embed: { type: 'iframe', url: embedUrl },
    });
  }
}

function mapWindyCategory(catId) {
  if (!catId) return 'other';
  const c = String(catId).toLowerCase();
  if (c.includes('volcano'))                                         return 'volcano';
  if (c.includes('wildlife') || c.includes('underwater'))            return 'wildlife';
  if (c.includes('nature') || c.includes('park') || c.includes('mountain')) return 'park';
  if (c.includes('airport') || c.includes('port') || c.includes('harbor') || c.includes('train') || c.includes('traffic')) return 'airport';
  if (c.includes('city') || c.includes('landmark') || c.includes('square')) return 'city';
  return 'other';
}

// ---------- NPS -------------------------------------------------------------
//
// NPS's API has a long-standing quirk where some URL fields come back
// concatenated, e.g. "https://www.nps.govhttps://www.nps.gov/common/..."
// We also need to handle relative paths (/common/uploads/...).
function sanitizeNpsUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Keep only the segment starting at the last `https://` (or `http://`) — if
  // there's no scheme in the string we treat it as a site-relative path.
  const lastHttps = raw.lastIndexOf('https://');
  const lastHttp  = raw.lastIndexOf('http://');
  const lastScheme = Math.max(lastHttps, lastHttp);
  if (lastScheme > 0) return raw.slice(lastScheme);
  if (lastScheme === 0) return raw;
  // No scheme — looks like a relative path. Prefix with nps.gov.
  if (raw.startsWith('/')) return 'https://www.nps.gov' + raw;
  return raw;
}

async function fetchNPS(key) {
  try {
    const url = `https://developer.nps.gov/api/v1/webcams?limit=500&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn('[cameras] nps HTTP', res.status); return []; }
    const j = await res.json();
    const items = j?.data || [];
    return items.map(mapNPS).filter(Boolean);
  } catch (e) {
    console.warn('[cameras] nps failed:', e.message);
    return [];
  }
}

function mapNPS(w) {
  const lat = parseFloat(w.latitude);
  const lon = parseFloat(w.longitude);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  // Video-only policy: drop any NPS cam that doesn't expose an HLS stream.
  // The NPS catalogue is mostly refreshing-JPEG cams, which users now expect
  // to play as video and which feel broken when they don't.
  const streamUrl = sanitizeNpsUrl(w.streamingUrl || w.streamUrl);
  if (!streamUrl || !/\.m3u8(\?|$)/i.test(streamUrl)) return null;
  const imgUrl = sanitizeNpsUrl(Array.isArray(w.images) && w.images[0]?.url);
  const pageUrl = sanitizeNpsUrl(w.url)
    || `https://www.nps.gov/search?query=${encodeURIComponent(w.title || 'webcam')}`;
  return {
    id: 'nps-' + (w.id || Math.random().toString(36).slice(2, 10)),
    title: w.title || 'NPS webcam',
    lat, lon,
    category: 'park',
    source: 'nps',
    thumbnailUrl: imgUrl,
    pageUrl,
    embed: { type: 'hls', url: streamUrl, posterUrl: imgUrl },
  };
}

// ---------- Assembly --------------------------------------------------------
//
// Video-only: USGS volcano cams, NOAA observatory cams, and NPS image-only
// cams all used to live here. They were dropped because the user experience
// of "click marker → see static JPEG" wasn't what "live camera" promises.
// Only sources that play actual video remain:
//   - Windy:  iframe player (always works — handles live streams AND graceful
//             fallback to timelapses for non-live cams)
//   - NPS:    only cams with HLS m3u8 streams; everything else filtered out
//             in mapNPS.

async function buildList() {
  const cams = [];

  const windyKey = process.env.WINDY_WEBCAMS_KEY;
  const npsKey   = process.env.NPS_API_KEY;

  const jobs = [];
  if (windyKey) jobs.push(fetchAllWindy(windyKey).then(r => cams.push(...r)));
  if (npsKey)   jobs.push(fetchNPS(npsKey).then(r => cams.push(...r)));
  await Promise.all(jobs);

  return {
    generatedAt: Date.now(),
    counts: {
      total: cams.length,
      windy: cams.filter(c => c.source === 'windy').length,
      nps:   cams.filter(c => c.source === 'nps').length,
      usgs:  cams.filter(c => c.source === 'usgs').length,
      noaa:  cams.filter(c => c.source === 'noaa').length,
    },
    cameras: cams,
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  if (!cache || now - cache.generatedAt > CACHE_TTL_MS) {
    try { cache = await buildList(); }
    catch (e) {
      console.warn('[cameras] build failed:', e.message);
      if (!cache) { res.status(503).json({ error: 'cameras unavailable', detail: e.message }); return; }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');
  res.status(200).json(cache);
}
