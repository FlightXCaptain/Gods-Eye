/* God's Eye — live data. 100% real public APIs, no seeding. */

async function safeFetch(url, opts = {}, timeoutMs = 15000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return await res.json();
    return await res.text();
  } catch (e) { return null; }
}

async function fetchQuakes() {
  // Use the M2.5+ daily feed by default — filters out microquakes that are
  // not perceptible and overwhelm the globe with noise. Callers can still
  // post-filter by magnitude for the UI slider.
  const j = await safeFetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
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

const FLIGHT_HOTSPOTS = [
  [51.5,-0.12], [40.7,-74], [34.05,-118.2], [35.68,139.7], [1.35,103.8],
  [25.2,55.27], [-33.86,151.2], [-23.55,-46.63], [19.43,-99.13], [28.6,77.2],
  [50.1,8.68], [41.9,12.5], [37.98,23.7], [55.75,37.6], [31.2,121.5],
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
  const j = await safeFetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200');
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
    out.push({
      id: e.id, lon, lat, title: e.title,
      category: e.categories?.[0]?.title || 'Event',
      categoryId: e.categories?.[0]?.id || 'other',
      time: last.date, link: e.link, kind:'eonet',
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
  // The API returns pages of {name, line1, line2, satelliteId}. We pull several
  // pages in parallel to build a decent sample (~200 sats).
  const pages = [1, 2, 3, 4, 5];
  const PAGE_SIZE = 40;
  const all = await Promise.all(pages.map(p =>
    safeFetch(`https://tle.ivanstanojevic.me/api/tle/?page=${p}&page-size=${PAGE_SIZE}`)
  ));
  // Plus a dedicated Starlink page
  const starlink = await safeFetch(`https://tle.ivanstanojevic.me/api/tle/?search=starlink&page-size=60`);
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
  consume(starlink);
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
  const gmst = window.satellite.gstime(when);
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
      out.push({
        name: s.name, group: s.group, norad: s.norad,
        owner: s.norad ? satcat[s.norad] : null,
        lat, lon, alt, kind:'sat',
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
