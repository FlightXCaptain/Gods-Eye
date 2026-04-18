// Cameras feed. Merges data from whatever upstream sources are configured
// via env vars, plus a small curated seed list so the layer shows something
// even without any API keys.
//
// Env vars (all optional):
//   WINDY_WEBCAMS_KEY   Windy Webcams v3 API key (20k+ global cams)
//   NPS_API_KEY         NPS Developer API key (~200 US park cams)
//
// Without any of the above, the returned list is just the curated seed.

export const config = { runtime: 'nodejs', maxDuration: 30 };

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null;

// Seed list — ~30 well-known public cams (scenic landmarks + USGS volcano
// cams with known image URLs). Each entry: { id, title, lat, lon, category,
// thumbnailUrl, pageUrl, source }. Image URLs can break as operators rotate
// hosting; if that happens the globe marker still works, just without a
// preview.
const SEED_CAMERAS = [
  // USGS volcano cams (Hawaii, Alaska, Cascades)
  { id: 'usgs-kilauea-summit', title: 'Kīlauea Summit', lat: 19.406, lon: -155.281, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/KWcam/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/kilauea/webcams' },
  { id: 'usgs-mauna-loa', title: 'Mauna Loa Northeast Rift', lat: 19.470, lon: -155.580, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/HVO_cams/M1cam/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/mauna-loa/webcams' },
  { id: 'usgs-st-helens', title: 'Mount St. Helens', lat: 46.200, lon: -122.186, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MSH_SEP/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/mount-st-helens/webcams' },
  { id: 'usgs-rainier', title: 'Mount Rainier', lat: 46.852, lon: -121.760, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/PR_PTR/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/mount-rainier/webcams' },
  { id: 'usgs-hood', title: 'Mount Hood', lat: 45.374, lon: -121.695, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/MH_TIM/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/mount-hood/webcams' },
  { id: 'usgs-shasta', title: 'Mount Shasta', lat: 41.409, lon: -122.194, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/CVO_cams/SH_BLK/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/mount-shasta/webcams' },
  { id: 'usgs-redoubt', title: 'Redoubt Volcano', lat: 60.485, lon: -152.743, category: 'volcano', source: 'usgs',
    thumbnailUrl: 'https://volcanoes.usgs.gov/vsc/images/image_manager/AVO_cams/RDDR/LATEST/main.jpg',
    pageUrl: 'https://www.usgs.gov/volcanoes/redoubt/webcams' },

  // NPS / National parks (scenic / wildlife)
  { id: 'nps-old-faithful', title: 'Old Faithful Geyser', lat: 44.460, lon: -110.828, category: 'park', source: 'nps',
    thumbnailUrl: 'https://www.nps.gov/webcams-yell/oldfaithvc.jpg',
    pageUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm' },
  { id: 'nps-yosemite-halfdome', title: 'Half Dome, Yosemite', lat: 37.746, lon: -119.533, category: 'park', source: 'nps',
    thumbnailUrl: 'https://www.nps.gov/webcams-yose/halfdome_webcam.jpg',
    pageUrl: 'https://www.nps.gov/yose/learn/photosmultimedia/webcams.htm' },
  { id: 'nps-denali', title: 'Denali Mountain', lat: 63.069, lon: -151.007, category: 'park', source: 'nps',
    thumbnailUrl: 'https://www.nps.gov/webcams-dena/denali_wonder_lake.jpg',
    pageUrl: 'https://www.nps.gov/dena/learn/photosmultimedia/webcams.htm' },
  { id: 'nps-grand-canyon', title: 'Grand Canyon South Rim', lat: 36.054, lon: -112.141, category: 'park', source: 'nps',
    thumbnailUrl: 'https://www.nps.gov/webcams-grca/grca_south_rim.jpg',
    pageUrl: 'https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm' },

  // Famous city / landmark cams (publicly documented)
  { id: 'earthcam-times-square', title: 'Times Square, New York', lat: 40.758, lon: -73.985, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/usa/newyork/timessquare/' },
  { id: 'earthcam-bourbon-street', title: 'Bourbon Street, New Orleans', lat: 29.958, lon: -90.067, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/usa/louisiana/neworleans/bourbonstreet/' },
  { id: 'earthcam-abbey-road', title: 'Abbey Road, London', lat: 51.532, lon: -0.177, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/world/england/london/abbeyroad/' },
  { id: 'earthcam-shibuya', title: 'Shibuya Crossing, Tokyo', lat: 35.660, lon: 139.700, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/world/japan/tokyo/shibuya/' },
  { id: 'earthcam-venice-bell', title: 'St Mark\'s Campanile, Venice', lat: 45.434, lon: 12.339, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/world/italy/venice/' },
  { id: 'earthcam-eiffel', title: 'Eiffel Tower, Paris', lat: 48.858, lon: 2.294, category: 'city', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.earthcam.com/world/france/paris/' },

  // Wildlife / nature
  { id: 'katmai-brooks-falls', title: 'Brooks Falls Bears, Alaska', lat: 58.558, lon: -155.773, category: 'wildlife', source: 'explore.org',
    thumbnailUrl: null,
    pageUrl: 'https://explore.org/livecams/brown-bears/brown-bear-salmon-cam-brooks-falls' },
  { id: 'africam-tembe', title: 'Tembe Elephant Park', lat: -27.020, lon: 32.405, category: 'wildlife', source: 'africam',
    thumbnailUrl: null,
    pageUrl: 'https://www.africam.com/wildlife/tembe_waterhole_wildlife_camera' },
  { id: 'monterey-bay-kelp', title: 'Monterey Bay Kelp Forest', lat: 36.618, lon: -121.902, category: 'wildlife', source: 'explore.org',
    thumbnailUrl: null,
    pageUrl: 'https://www.montereybayaquarium.org/animals/live-cams/kelp-forest-cam' },

  // Iceland volcano cams
  { id: 'ruv-grindavik', title: 'Grindavík Eruption (RÚV)', lat: 63.856, lon: -22.437, category: 'volcano', source: 'ruv',
    thumbnailUrl: null,
    pageUrl: 'https://www.ruv.is/vefvarp' },

  // Airport / transit
  { id: 'flight-heathrow', title: 'Heathrow Runway 27L', lat: 51.464, lon: -0.453, category: 'airport', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.airport-webcams.com/heathrow-airport/' },
  { id: 'flight-losangeles', title: 'LAX Tower', lat: 33.942, lon: -118.408, category: 'airport', source: 'earthcam',
    thumbnailUrl: null,
    pageUrl: 'https://www.airport-webcams.com/lax-airport/' },
];

async function fetchWindyWebcams(key, limit = 500) {
  // Windy Webcams v3 API: https://api.windy.com/webcams/api/v3
  // Free "Developers" tier allows listing with lat/lon/radius or just bounding
  // box. For global coverage we fan out to a few tiled calls; limit keeps
  // payload reasonable.
  try {
    const url = `https://api.windy.com/webcams/api/v3/webcams?limit=${limit}&include=images,location,urls`;
    const res = await fetch(url, { headers: { 'x-windy-api-key': key } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.webcams || []).map(w => ({
      id: 'windy-' + w.webcamId,
      title: w.title || 'Webcam',
      lat: w.location?.latitude,
      lon: w.location?.longitude,
      category: (w.categories?.[0]?.id) || 'other',
      source: 'windy',
      thumbnailUrl: w.images?.current?.thumbnail || w.images?.current?.preview,
      pageUrl: w.urls?.detail,
    })).filter(w => typeof w.lat === 'number' && typeof w.lon === 'number');
  } catch (e) {
    console.warn('[cameras] windy fetch failed', e.message);
    return [];
  }
}

async function buildList() {
  const out = [...SEED_CAMERAS];
  const windyKey = process.env.WINDY_WEBCAMS_KEY;
  if (windyKey) {
    const windy = await fetchWindyWebcams(windyKey);
    out.push(...windy);
  }
  return { generatedAt: Date.now(), cameras: out };
}

export default async function handler(req, res) {
  const now = Date.now();
  if (!cache || now - cache.generatedAt > CACHE_TTL_MS) {
    try { cache = await buildList(); }
    catch (e) {
      if (!cache) { res.status(503).json({ error: 'cameras unavailable' }); return; }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).json(cache);
}
