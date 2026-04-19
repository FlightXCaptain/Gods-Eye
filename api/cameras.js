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
    // Windy's public embed player. ?view=live prefers live video and falls
    // back to latest frame / timelapse depending on what the cam exposes.
    const embedUrl = `https://webcams.windy.com/webcams/public/embed/player/${webcamId}?view=live`;
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
  // NPS exposes images + a streamingUrl. Prefer HLS streams; otherwise use
  // the static image as a refreshing still; fall back to link-only.
  const streamUrl = w.streamingUrl || w.streamUrl || null;
  const imgUrl = (Array.isArray(w.images) && w.images[0]?.url) || null;
  const pageUrl = (w.url && (w.url.startsWith('http') ? w.url : `https://www.nps.gov${w.url}`))
    || `https://www.nps.gov/search?query=${encodeURIComponent(w.title || 'webcam')}`;

  let embed;
  if (streamUrl && /\.m3u8(\?|$)/i.test(streamUrl)) {
    embed = { type: 'hls', url: streamUrl, posterUrl: imgUrl };
  } else if (imgUrl) {
    embed = { type: 'image-refresh', url: imgUrl, refreshSec: 60 };
  } else {
    embed = { type: 'link-only' };
  }
  return {
    id: 'nps-' + (w.id || Math.random().toString(36).slice(2, 10)),
    title: w.title || 'NPS webcam',
    lat, lon,
    category: 'park',
    source: 'nps',
    thumbnailUrl: imgUrl,
    pageUrl,
    embed,
  };
}

// ---------- USGS volcano ----------------------------------------------------
//
// Curated from HVO (Hawaii), CVO (Cascades), AVO (Alaska), YVO (Yellowstone).
// All are refreshing JPEG stills updated every 1–5 min; the image-refresh
// embed reloads every 60 s with a cache-buster so the dossier modal feels
// live. Image URLs sometimes rotate as the USGS updates their infra — if one
// 404s the marker still renders, just without a preview.

const USGS_CAMS = [
  // Hawai'i (HVO)
  { id:'kilauea-summit',    title:'Kīlauea Summit (KWcam)',         lat:19.406, lon:-155.281, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/KWcam/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/kilauea/webcams' },
  { id:'kilauea-halema',    title:'Kīlauea Halemaʻumaʻu (V1cam)',   lat:19.406, lon:-155.281, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/V1cam/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/kilauea/webcams' },
  { id:'kilauea-east-rift', title:'Kīlauea East Rift (PEcam)',      lat:19.351, lon:-155.105, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/PEcam/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/kilauea/webcams' },
  { id:'mauna-loa-ne',      title:'Mauna Loa NE Rift (M1cam)',      lat:19.470, lon:-155.580, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/M1cam/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mauna-loa/webcams' },
  { id:'mauna-loa-sw',      title:'Mauna Loa SW Rift (M2cam)',      lat:19.430, lon:-155.680, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/M2cam/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mauna-loa/webcams' },
  // Cascades (CVO)
  { id:'st-helens-sep',     title:'Mount St. Helens (MSH_SEP)',     lat:46.200, lon:-122.186, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MSH_SEP/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-st-helens/webcams' },
  { id:'st-helens-lvu',     title:'Mount St. Helens (MSH_LVU)',     lat:46.241, lon:-122.218, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MSH_LVU/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-st-helens/webcams' },
  { id:'rainier-tahoma',    title:'Mount Rainier (PR_PTR)',         lat:46.852, lon:-121.760, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/PR_PTR/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-rainier/webcams' },
  { id:'rainier-sunrise',   title:'Mount Rainier Sunrise (RR_EST)', lat:46.914, lon:-121.642, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/RR_EST/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-rainier/webcams' },
  { id:'hood-timberline',   title:'Mount Hood Timberline (MH_TIM)', lat:45.374, lon:-121.695, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MH_TIM/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-hood/webcams' },
  { id:'hood-hoodriver',    title:'Mount Hood Hood River (MH_HRV)', lat:45.520, lon:-121.521, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MH_HRV/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-hood/webcams' },
  { id:'shasta-black',      title:'Mount Shasta (SH_BLK)',          lat:41.409, lon:-122.194, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/SH_BLK/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-shasta/webcams' },
  { id:'newberry',          title:'Newberry Volcano (NB_PH)',       lat:43.722, lon:-121.230, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/NB_PH/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/newberry/webcams' },
  { id:'lassen',            title:'Lassen Peak (LA_BRK)',           lat:40.488, lon:-121.505, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/LA_BRK/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/lassen-volcanic-center/webcams' },
  { id:'three-sisters',     title:'Three Sisters (TS_BCH)',         lat:44.103, lon:-121.770, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/TS_BCH/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/three-sisters/webcams' },
  { id:'glacier-peak',      title:'Glacier Peak (GP_GRN)',          lat:48.111, lon:-121.114, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/GP_GRN/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/glacier-peak/webcams' },
  { id:'baker',             title:'Mount Baker (BK_LKE)',           lat:48.777, lon:-121.814, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/BK_LKE/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-baker/webcams' },
  // Alaska (AVO)
  { id:'redoubt',           title:'Redoubt Volcano (RDDR)',         lat:60.485, lon:-152.743, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/RDDR/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/redoubt/webcams' },
  { id:'augustine',         title:'Augustine Volcano (AUH)',        lat:59.363, lon:-153.435, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/AUH/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/augustine/webcams' },
  { id:'spurr',             title:'Mount Spurr (CKL)',              lat:61.299, lon:-152.251, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/CKL/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-spurr/webcams' },
  { id:'pavlof',            title:'Pavlof Volcano (PS1A)',          lat:55.417, lon:-161.887, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/PS1A/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/pavlof/webcams' },
  { id:'cleveland',         title:'Mount Cleveland (CLCO)',         lat:52.822, lon:-169.944, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/CLCO/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-cleveland/webcams' },
  { id:'shishaldin',        title:'Shishaldin Volcano (SSLW)',      lat:54.756, lon:-163.970, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/SSLW/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/shishaldin/webcams' },
  { id:'veniaminof',        title:'Mount Veniaminof (VNWF)',        lat:56.197, lon:-159.389, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/VNWF/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/mount-veniaminof/webcams' },
  { id:'great-sitkin',      title:'Great Sitkin (GSCK)',            lat:52.076, lon:-176.130, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/GSCK/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/great-sitkin/webcams' },
  { id:'semisopochnoi',     title:'Semisopochnoi (CERB)',           lat:51.929, lon:179.580, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/CERB/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/semisopochnoi/webcams' },
  // Yellowstone (YVO)
  { id:'yellowstone-mud',   title:'Yellowstone Mud Volcano',        lat:44.625, lon:-110.434, img:'https://volcanoes.usgs.gov/vsc/images/image_manager/YVO_cams/YMV/LATEST/main.jpg', page:'https://www.usgs.gov/volcanoes/yellowstone/webcams' },
];

function seedUSGS() {
  return USGS_CAMS.map(c => ({
    id: 'usgs-' + c.id,
    title: c.title,
    lat: c.lat, lon: c.lon,
    category: 'volcano',
    source: 'usgs',
    thumbnailUrl: c.img,
    pageUrl: c.page,
    embed: { type: 'image-refresh', url: c.img, refreshSec: 60 },
  }));
}

// ---------- NOAA (partial) --------------------------------------------------
//
// NOAA has no unified cam API. There are three publicly-documented, stable
// sources we curate here: GML atmospheric observatory cams (Mauna Loa,
// Barrow, Samoa, South Pole) and the NOAA/ESRL Boulder rooftop cam. Other
// NOAA camera systems (buoy cams, ship cams) aren't reliably public, so we
// skip them rather than ship dead markers.

const NOAA_CAMS = [
  { id:'mlo',    title:'Mauna Loa Observatory',           lat:19.536, lon:-155.576, category:'park', img:'https://gml.noaa.gov/webdata/mlo/camera/mlo.jpg',    page:'https://gml.noaa.gov/obop/mlo/livecamera.html' },
  { id:'brw',    title:'Barrow / Utqiaġvik Observatory',  lat:71.323, lon:-156.611, category:'park', img:'https://gml.noaa.gov/webdata/brw/camera/brw.jpg',    page:'https://gml.noaa.gov/obop/brw/livecamera.html' },
  { id:'smo',    title:'American Samoa Observatory',      lat:-14.247, lon:-170.564, category:'park', img:'https://gml.noaa.gov/webdata/smo/camera/smo.jpg',    page:'https://gml.noaa.gov/obop/smo/livecamera.html' },
  { id:'spo',    title:'South Pole Observatory',          lat:-89.997, lon:-24.802, category:'park', img:'https://gml.noaa.gov/webdata/spo/camera/spo.jpg',    page:'https://gml.noaa.gov/obop/spo/livecamera.html' },
  { id:'boulder',title:'NOAA Boulder — Flatirons',        lat:39.992, lon:-105.260, category:'city', img:'https://csd.noaa.gov/webcams/boulder/current.jpg',   page:'https://csd.noaa.gov/webcams/' },
];

function seedNOAA() {
  return NOAA_CAMS.map(c => ({
    id: 'noaa-' + c.id,
    title: c.title,
    lat: c.lat, lon: c.lon,
    category: c.category,
    source: 'noaa',
    thumbnailUrl: c.img,
    pageUrl: c.page,
    embed: { type: 'image-refresh', url: c.img, refreshSec: 120 },
  }));
}

// ---------- Assembly --------------------------------------------------------

async function buildList() {
  const cams = [];
  cams.push(...seedUSGS());
  cams.push(...seedNOAA());

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
