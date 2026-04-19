/* God's Eye — live data. 100% real public APIs, no seeding. */

async function safeFetch(url, opts = {}, timeoutMs = 15000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    // NASA's EONET currently serves JSON with `Content-Type: application/rss+xml`
    // (a server-config bug on their side). Don't rely on the header — try
    // JSON.parse first and fall back to raw text only if parsing genuinely fails.
    if (!text) return null;
    const firstNonWs = text.trimStart()[0];
    if (firstNonWs === '{' || firstNonWs === '[') {
      try { return JSON.parse(text); } catch { /* fall through */ }
    }
    return text;
  } catch (e) { return null; }
}

async function fetchQuakes() {
  // 30-day M2.5+ feed from USGS so the time-slider can scrub back a full
  // month of seismic activity. Filters microquakes that aren't perceptible
  // and would overwhelm the globe. USGS serves this with its own CDN
  // caching headers, so repeated loads across browsers hit their edge
  // rather than our proxy.
  const j = await safeFetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson');
  if (!j?.features) return [];
  return j.features.map(f => ({
    id: f.id,
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    depth: f.geometry.coordinates[2],
    mag: f.properties.mag, place: f.properties.place,
    time: f.properties.time, url: f.properties.url, kind:'quake',
  })).filter(q => q.mag != null);
}

async function fetchISS() {
  const j = await safeFetch('https://api.wheretheiss.at/v1/satellites/25544');
  if (!j) return null;
  return { id:'iss', lon:j.longitude, lat:j.latitude, alt:j.altitude, vel:j.velocity,
           kind:'iss', name:'ISS · ZARYA', time: Date.now() };
}

// Global ADS-B sampling grid. The free aggregators expose a per-point radius
// API (`/v2/point/<lat>/<lon>/250` = all aircraft within 250 nm of the point).
// To cover the whole planet we fan out to ~40 anchor points sized so the
// 250nm disks overlap slightly — this reaches every continent, major oceans,
// polar regions and underserved South America / Africa / Central Asia.
// Deduped by aircraft hex so overlap doesn't double-count flights.
const FLIGHT_HOTSPOTS = [
  // Europe
  [51.5,-0.12], [50.1,8.68], [41.9,12.5], [37.98,23.7], [55.75,37.6],
  [64.13,-21.94], [52.23,21.01], [60.17,24.94],
  // North America
  [40.7,-74], [41.88,-87.63], [34.05,-118.2], [29.76,-95.37], [49.28,-123.12],
  [61.22,-149.9], [43.65,-79.38], [25.76,-80.19],
  // Central / South America
  [19.43,-99.13], [-23.55,-46.63], [4.71,-74.07], [-12.05,-77.04],
  [-34.6,-58.38], [-33.45,-70.67],
  // Africa
  [30.04,31.24], [6.52,3.38], [-26.2,28.04], [-1.29,36.82], [33.57,-7.59],
  [14.72,-17.47],
  // Middle East / Central Asia
  [25.2,55.27], [35.7,51.42], [41.01,28.98], [24.71,46.68], [43.24,76.89],
  // South Asia
  [28.6,77.2], [24.86,67.0], [19.07,72.87], [23.73,90.4],
  // East / Southeast Asia
  [31.2,121.5], [35.68,139.7], [37.57,126.98], [22.28,114.16], [25.03,121.56],
  [13.75,100.49], [14.6,120.98], [-6.2,106.85], [1.35,103.8], [10.82,106.63],
  // Oceania / Pacific
  [-33.86,151.2], [-37.81,144.96], [-36.85,174.76], [21.31,-157.86],
  // Polar / remote
  [-54.8,-68.3], [78.22,15.65],
];
// Community ADS-B aggregators — all free, no key, same API shape.
// Tried in order per hotspot; first successful response wins. This gives us
// resilience when one mirror rate-limits or briefly 5xx's.
const FLIGHT_HOSTS = [
  'https://api.airplanes.live',
  'https://api.adsb.lol',
  'https://opendata.adsb.fi',
];
async function fetchFlightsForPoint(la, lo) {
  for (const host of FLIGHT_HOSTS) {
    const j = await safeFetch(`${host}/v2/point/${la}/${lo}/250`);
    if (j?.ac?.length) return j.ac;
  }
  return [];
}
async function fetchFlights() {
  // Sequence with small delay — aggregators rate-limit parallel bursts. Serial
  // is slower but reliable; we rotate across mirrors as fallbacks.
  const seen = new Set(); const out = [];
  for (const [la,lo] of FLIGHT_HOTSPOTS) {
    const ac = await fetchFlightsForPoint(la, lo);
    for (const a of ac) {
      if (a.lat == null || a.lon == null) continue;
      if (seen.has(a.hex)) continue;
      seen.add(a.hex);
      out.push({
        id: a.hex,
        callsign: (a.flight||'').trim() || a.r || a.hex,
        reg: a.r, type: a.t, desc: a.desc,
        lon: a.lon, lat: a.lat,
        alt: a.alt_baro, vel: a.gs, hdg: a.track,
        kind:'flight', _ts: Date.now(),
      });
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function fetchEONET() {
  // 30-day window covering both currently-active events and anything that
  // resolved in the last month. status=all includes closed events so the
  // time-slider can scrub through history.
  const j = await safeFetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=30&limit=1000');
  if (!j?.events) return [];
  const out = [];
  for (const e of j.events) {
    const last = e.geometry?.[e.geometry.length - 1]; if (!last) continue;
    let lon, lat;
    if (last.type === 'Point') [lon,lat] = last.coordinates;
    else if (last.type === 'Polygon') {
      const r = last.coordinates[0];
      const [sx,sy] = r.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]);
      lon = sx/r.length; lat = sy/r.length;
    } else continue;
    // Normalise EONET timestamps to epoch ms at ingestion so downstream
    // filters can do cheap numeric comparisons instead of parsing ISO on
    // every render.
    //   - `time`       — last geometry point (most recent known position)
    //   - `startTime`  — first geometry point (when detected)
    //   - `closedTime` — epoch ms when EONET marked the event closed, or
    //                    null if it's still active. This is what lets us
    //                    filter "currently active" independently of how
    //                    recently the geometry has been updated (storms
    //                    and fires often go days between updates).
    const timeMs = last.date ? new Date(last.date).getTime() : NaN;
    if (!isFinite(timeMs)) continue;
    const first = e.geometry?.[0];
    const startMs = first?.date ? new Date(first.date).getTime() : timeMs;
    const closedMs = e.closed ? new Date(e.closed).getTime() : null;
    out.push({
      id: e.id, lon, lat, title: e.title,
      category: e.categories?.[0]?.title || 'Event',
      categoryId: e.categories?.[0]?.id || 'other',
      time: timeMs, startTime: startMs, closedTime: closedMs,
      link: e.link, kind:'eonet',
    });
  }
  return out;
}

async function fetchKp() {
  const j = await safeFetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  if (!Array.isArray(j)) return null;
  let rows;
  if (typeof j[0] === 'object' && !Array.isArray(j[0])) rows = j.map(o => [o.time_tag, o.Kp ?? o.kp_index ?? o.kp]);
  else rows = j.slice(1);
  const last = rows[rows.length-1];
  const kp = parseFloat(last[1]);
  return { kp, time: last[0], series: rows.slice(-24).map(r => ({t:r[0], k: parseFloat(r[1])})) };
}

async function fetchAurora() {
  const j = await safeFetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
  if (!j?.coordinates) return [];
  return j.coordinates.filter(c => c[2] >= 10).map(c => ({ lon: c[0] > 180 ? c[0]-360 : c[0], lat: c[1], p: c[2] }));
}

async function fetchTsunamis() {
  const j = await safeFetch('https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events?minYear=2024');
  if (!j?.items) return [];
  return j.items.slice(-50).filter(i => i.latitude && i.longitude).map(i => ({
    id: i.id, lat:i.latitude, lon:i.longitude, country:i.country,
    location:i.locationName, year:i.year, month:i.month, day:i.day,
    // Compose a ms timestamp from year/month/day so dossier / filters / hover
    // "X ago" labels all work the same as other sources.
    time: Date.UTC(i.year || 1970, (i.month || 1) - 1, i.day || 1),
    mag: i.eqMagnitude, height: i.maxWaterHeight, kind:'tsunami',
  }));
}

/* Satellites — tle.ivanstanojevic.me (CelesTrak proxy with open CORS).
   Propagated live in browser via satellite.js SGP4. */

// Satellite metadata lookup — the tle.* API includes names already, so we derive
// "group" from the name prefix rather than needing a separate satcat fetch.
let SATCAT_CACHE = null;
async function loadSatcat() {
  // No-op kept for API compatibility — ownership is now inferred from name.
  if (SATCAT_CACHE) return SATCAT_CACHE;
  SATCAT_CACHE = {};
  return SATCAT_CACHE;
}

// Extract NORAD catalog number from TLE line 1 (chars 3-7, 1-indexed → slice 2,7)
function noradIdFromTLE(tle1) {
  if (!tle1) return null;
  const n = parseInt(tle1.slice(2, 7).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Name-based group classifier — rough but useful
function classifySat(name) {
  const n = (name || '').toUpperCase();
  if (n.startsWith('STARLINK')) return 'Starlink';
  if (n.startsWith('ONEWEB')) return 'OneWeb';
  if (n.startsWith('ISS') || n.includes('ZARYA') || n.includes('TIANGONG') || n.includes('CSS')) return 'Space Stations';
  if (n.startsWith('GPS') || n.startsWith('GLONASS') || n.startsWith('GALILEO') || n.startsWith('BEIDOU') || n.startsWith('NAVSTAR')) return 'Navigation';
  if (n.startsWith('NOAA') || n.startsWith('GOES') || n.startsWith('METEOSAT') || n.startsWith('METOP') || n.startsWith('HIMAWARI') || n.startsWith('FY-')) return 'Weather';
  if (n.startsWith('IRIDIUM')) return 'Iridium';
  if (n.startsWith('COSMOS')) return 'Cosmos';
  if (n.startsWith('USA')) return 'Military';
  return 'Other';
}

async function fetchSatellites() {
  // The API returns pages of {name, line1, line2, satelliteId}. We pull a
  // larger spread (~600 sats) so the orbital belt reads as a real swarm rather
  // than a sparse sprinkle, plus dedicated searches for the major
  // constellations so they render even if they're not in the first N pages.
  const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const PAGE_SIZE = 60;
  const all = await Promise.all(pages.map(p =>
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?page=${p}&page-size=${PAGE_SIZE}`)
  ));
  const searches = await Promise.all([
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?search=starlink&page-size=60`),
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?search=iridium&page-size=40`),
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?search=oneweb&page-size=40`),
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?search=gps&page-size=40`),
  ]);
  const out = [];
  const seen = new Set();
  const consume = (j) => {
    if (!j?.member) return;
    for (const s of j.member) {
      if (!s.line1 || !s.line2 || seen.has(s.satelliteId)) continue;
      seen.add(s.satelliteId);
      out.push({
        name: s.name, tle1: s.line1, tle2: s.line2,
        group: classifySat(s.name),
        norad: s.satelliteId,
      });
    }
  };
  for (const p of all) consume(p);
  for (const s of searches) consume(s);
  return out;
}

function subscribeWikiEdits(onEdit) {
  let es;
  try { es = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange'); }
  catch(e){ return ()=>{}; }
  es.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.type !== 'edit') return;
      if (!d.wiki?.endsWith('wiki')) return;
      onEdit({
        id: d.meta?.id || Math.random(), title: d.title, user: d.user,
        wiki: d.wiki, url: d.meta?.uri, bot: d.bot, comment: d.comment||'',
        time: d.timestamp*1000, kind:'wiki',
      });
    } catch {}
  };
  es.onerror = () => {};
  return () => { try { es.close(); } catch {} };
}

const COUNTRY_POINTS = {
  US:[-98,39], GB:[-2,54], FR:[2,46], DE:[10,51], IT:[12,43], ES:[-4,40],
  CN:[104,35], JP:[138,36], KR:[127,37], IN:[79,22], RU:[90,62], BR:[-53,-10],
  CA:[-106,60], MX:[-102,23], AU:[134,-25], ZA:[25,-30], EG:[30,26], SA:[45,24],
  IR:[53,32], IQ:[44,33], TR:[35,39], IL:[35,31], UA:[32,49], PL:[19,52],
  NG:[8,10], AR:[-64,-34], CL:[-71,-35], CO:[-74,4], TH:[100,15], VN:[106,16],
  PH:[121,13], ID:[113,-0.5], SG:[103,1], PK:[70,30], AF:[65,33], SY:[38,35],
  NL:[5,52], SE:[15,62], NO:[9,61], CH:[8,47], GR:[22,39], PT:[-8,40], IE:[-8,53],
  NZ:[174,-41], TW:[121,23], HK:[114,22], KZ:[68,48], BY:[28,54], RO:[25,46],
};

/* Propagate all TLEs to current lat/lon using satellite.js (loaded globally). */
function propagateSats(tleList, when) {
  if (!window.satellite) return [];
  const satcat = SATCAT_CACHE || {};
  const out = [];
  // Propagate at `when` AND `when + 1s` so we can emit a °/sec velocity
  // alongside each position. The second propagation is cheap (~6 trig ops
  // via SGP4 mean motion) and gives the client the velocity it needs for
  // smooth dead-reckoning between the 2-second propagation cadence.
  const when2 = new Date(when.getTime() + 1000);
  const gmst  = window.satellite.gstime(when);
  const gmst2 = window.satellite.gstime(when2);
  for (const s of tleList) {
    try {
      const rec = window.satellite.twoline2satrec(s.tle1, s.tle2);
      const pv = window.satellite.propagate(rec, when);
      if (!pv || !pv.position) continue;
      const geo = window.satellite.eciToGeodetic(pv.position, gmst);
      const lat = window.satellite.degreesLat(geo.latitude);
      const lon = window.satellite.degreesLong(geo.longitude);
      const alt = geo.height; // km
      if (!isFinite(lat) || !isFinite(lon)) continue;
      // Velocity via position delta over 1 second. Reading °/sec directly
      // avoids the ECI→ECEF→geodetic velocity-vector conversion.
      let velLat = 0, velLon = 0;
      const pv2 = window.satellite.propagate(rec, when2);
      if (pv2?.position) {
        const geo2 = window.satellite.eciToGeodetic(pv2.position, gmst2);
        const lat2 = window.satellite.degreesLat(geo2.latitude);
        const lon2 = window.satellite.degreesLong(geo2.longitude);
        if (isFinite(lat2) && isFinite(lon2)) {
          velLat = lat2 - lat;
          velLon = lon2 - lon;
          if (velLon > 180) velLon -= 360;
          if (velLon < -180) velLon += 360;
        }
      }
      out.push({
        name: s.name, group: s.group, norad: s.norad,
        owner: s.norad ? satcat[s.norad] : null,
        lat, lon, alt, velLat, velLon, kind:'sat',
      });
    } catch {}
  }
  return out;
}

Object.assign(window, {
  fetchQuakes, fetchISS, fetchFlights, fetchEONET, fetchKp, fetchAurora,
  fetchTsunamis, fetchSatellites, propagateSats, loadSatcat,
  subscribeWikiEdits, COUNTRY_POINTS,
});
