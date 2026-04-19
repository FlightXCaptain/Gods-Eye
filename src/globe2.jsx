/* God's Eye — Globe v2. Proper d3-zoom+drag, smooth transitions. */
/* globals React, d3, topojson */
const { useRef, useEffect, useState, useCallback, useMemo } = React;

// ──────────────────────────────────────────────────────────────────────
// Icon primitives — each draws a small glyph centered at (cx,cy).
// Size is the "design size" in px (~10-14 for marker icons).
// ──────────────────────────────────────────────────────────────────────

// Earthquake: epicenter — concentric rings radiating from a filled center.
// Reads clearly even at small sizes; rings fade outward.
function iconQuake(ctx, cx, cy, size, color, isDark) {
  const r = Math.max(3, size * 0.5);
  // outer ring (faint)
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.stroke();
  // mid ring
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, cy, r*0.62, 0, Math.PI*2);
  ctx.stroke();
  // filled core
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.6, r*0.32), 0, Math.PI*2);
  ctx.fill();
  // short radial ticks (N/E/S/W) for that seismic "epicenter" feel
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const t1 = r*1.05, t2 = r*1.35;
  ctx.moveTo(cx, cy - t1); ctx.lineTo(cx, cy - t2);
  ctx.moveTo(cx, cy + t1); ctx.lineTo(cx, cy + t2);
  ctx.moveTo(cx - t1, cy); ctx.lineTo(cx - t2, cy);
  ctx.moveTo(cx + t1, cy); ctx.lineTo(cx + t2, cy);
  ctx.stroke();
}

// Tsunami: three stacked wave curves
function iconTsunami(ctx, cx, cy, size, color) {
  const w = size * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const yy = cy - size*0.35 + i * size*0.35;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, yy);
    ctx.quadraticCurveTo(cx - w/4, yy - 2.2, cx, yy);
    ctx.quadraticCurveTo(cx + w/4, yy + 2.2, cx + w/2, yy);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// Wildfire: flame silhouette
function iconFire(ctx, cx, cy, size, color) {
  const s = size * 0.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.bezierCurveTo(cx + s*0.9, cy - s*0.2, cx + s*0.7, cy + s*0.6, cx, cy + s);
  ctx.bezierCurveTo(cx - s*0.7, cy + s*0.6, cx - s*0.9, cy - s*0.2, cx, cy - s);
  ctx.fill();
  // inner lighter core
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s*0.4);
  ctx.bezierCurveTo(cx + s*0.4, cy, cx + s*0.25, cy + s*0.45, cx, cy + s*0.6);
  ctx.bezierCurveTo(cx - s*0.25, cy + s*0.45, cx - s*0.4, cy, cx, cy - s*0.4);
  ctx.fillStyle = '#fde68a';
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Volcano: triangle with eruption cap
function iconVolcano(ctx, cx, cy, size, color) {
  const s = size * 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s*0.6);
  ctx.lineTo(cx - s*0.3, cy - s*0.4);
  ctx.lineTo(cx + s*0.3, cy - s*0.4);
  ctx.lineTo(cx + s, cy + s*0.6);
  ctx.closePath();
  ctx.fill();
  // eruption dots
  ctx.beginPath();
  ctx.arc(cx, cy - s*0.75, 1.2, 0, Math.PI*2);
  ctx.arc(cx - s*0.45, cy - s*0.55, 0.8, 0, Math.PI*2);
  ctx.arc(cx + s*0.45, cy - s*0.55, 0.8, 0, Math.PI*2);
  ctx.fill();
}

// Storm: spiral
function iconStorm(ctx, cx, cy, size, color) {
  const r = size * 0.48;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const a = t * Math.PI * 2.2;
    const rr = r * (1 - t*0.85);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 1.1, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Ice / sea-ice: hexagon with crossbars (snowflake-ish, compact)
function iconIce(ctx, cx, cy, size, color) {
  const r = size * 0.45;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  // 3 crossing lines forming an asterisk
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
    ctx.lineTo(cx - Math.cos(a)*r, cy - Math.sin(a)*r);
    ctx.stroke();
  }
  // center
  ctx.beginPath();
  ctx.arc(cx, cy, 1, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Generic event: small square outline
// Low-precision solar position (good to ~0.01° for present dates). Returns
// the subsolar point in [lon, lat] degrees — i.e. the spot on Earth where
// the sun is directly overhead at the given instant. Derived from the
// Astronomical Almanac's low-precision formula; no external deps.
//
// For the day/night terminator we use the ANTISOLAR point (sun +180° lon,
// negated lat) and draw a 90°-radius great-circle around it — every point
// inside that circle is in night.
function solarPosition(date) {
  const d = (date - Date.UTC(2000, 0, 1, 12)) / 86400000;       // days since J2000
  const g = (357.5291 + 0.98560028 * d) * Math.PI / 180;        // mean anomaly
  const q = (280.459  + 0.98564736 * d) * Math.PI / 180;        // mean longitude
  const L = q + ((1.915 * Math.sin(g) + 0.020 * Math.sin(2*g)) * Math.PI / 180);
  const e = (23.439 - 0.00000036 * d) * Math.PI / 180;          // obliquity
  const RA  = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  // Greenwich Mean Sidereal Time (hours), then to hour-angle of the sun.
  const GMST = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  let lon = (RA * 180 / Math.PI) - GMST * 15;
  lon = ((lon + 540) % 360) - 180;
  const lat = dec * 180 / Math.PI;
  return [lon, lat];
}

// Advance an eased display position each frame. Supports two sources of
// velocity: (a) DECLARED — the caller passes velLat/velLon in °/sec
// (e.g. sats use TLE-propagated velocity; ships convert sog+cog), or
// (b) INFERRED — null/undefined velocity triggers position-delta between
// consecutive snapshots (used for ISS, which has a scalar speed but no
// heading in the feed).
//
// st fields (created/maintained by caller, ° and ms):
//   aLat, aLon, aT   anchor (last snapshot) position + time
//   vLat, vLon       velocity (°/sec) — declared or inferred
//   dLat, dLon       currently-displayed (eased) position
//   lastKey          snapshot-change detection
function advanceEased(st, newLat, newLon, tickNow, velLat, velLon, ease = 0.22) {
  const key = newLat + ',' + newLon;
  if (key !== st.lastKey) {
    // Snapshot changed — re-anchor, and infer velocity if no declared.
    if (velLat == null || velLon == null) {
      const dt = Math.max(0.01, (tickNow - st.aT) / 1000);
      let dlon = newLon - st.aLon;
      if (dlon > 180) dlon -= 360; if (dlon < -180) dlon += 360;
      const vLatNew = (newLat - st.aLat) / dt;
      const vLonNew = dlon / dt;
      // Reject velocity spikes from data-feed oddities (wraparound,
      // transient bad rows). 20°/sec is far above any real orbital motion.
      if (Math.abs(vLatNew) < 20 && Math.abs(vLonNew) < 20) {
        st.vLat = vLatNew;
        st.vLon = vLonNew;
      }
    }
    st.aLat = newLat; st.aLon = newLon;
    st.aT = tickNow;
    st.lastKey = key;
  }
  // Declared velocity is applied every frame (caller's latest).
  if (velLat != null && velLon != null) {
    st.vLat = velLat;
    st.vLon = velLon;
  }
  const dtSec = (tickNow - st.aT) / 1000;
  let pLat = st.aLat + st.vLat * dtSec;
  let pLon = st.aLon + st.vLon * dtSec;
  if (pLon > 180) pLon -= 360;
  if (pLon < -180) pLon += 360;
  st.dLat += (pLat - st.dLat) * ease;
  let dlo = pLon - st.dLon;
  if (dlo > 180) dlo -= 360; if (dlo < -180) dlo += 360;
  st.dLon += dlo * ease;
  if (st.dLon > 180) st.dLon -= 360; if (st.dLon < -180) st.dLon += 360;
}

function iconEvent(ctx, cx, cy, size, color) {
  const s = size * 0.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.strokeRect(cx - s, cy - s, s*2, s*2);
  ctx.beginPath();
  ctx.arc(cx, cy, 1, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Satellite: tiny horizontal body with two rectangular solar panel wings.
// Reads as "sat with panels" at any size; distinct from ISS which is larger + labelled.
function iconSat(ctx, cx, cy, size, color) {
  const s = size * 0.5;
  ctx.fillStyle = color;
  // body
  ctx.fillRect(cx - s*0.28, cy - s*0.22, s*0.56, s*0.44);
  // left panel
  ctx.fillRect(cx - s*1.0, cy - s*0.18, s*0.55, s*0.36);
  // right panel
  ctx.fillRect(cx + s*0.45, cy - s*0.18, s*0.55, s*0.36);
}

// ISS: proper silhouette — central body with two solar panel wings
function iconISS(ctx, cx, cy, size, color) {
  const s = size;
  ctx.fillStyle = color;
  // center body
  ctx.fillRect(cx - s*0.15, cy - s*0.18, s*0.3, s*0.36);
  // left panel
  ctx.fillRect(cx - s*0.75, cy - s*0.1, s*0.5, s*0.2);
  // right panel
  ctx.fillRect(cx + s*0.25, cy - s*0.1, s*0.5, s*0.2);
  // connecting struts
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - s*0.25, cy); ctx.lineTo(cx - s*0.15, cy);
  ctx.moveTo(cx + s*0.15, cy); ctx.lineTo(cx + s*0.25, cy);
  ctx.stroke();
}

// Tiny density dot — used when local density is too high for a full icon
function iconDot(ctx, cx, cy, size, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Ship — elongated hull silhouette viewed top-down, oriented by heading (deg).
// Designed at ~8px length so "scale=1" means ~8px long ship.
function iconShip(ctx, cx, cy, heading, scale, color, stroke) {
  ctx.save();
  ctx.translate(cx, cy);
  const rot = ((heading || 0) - 0) * Math.PI / 180;
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  // Hull: pointed bow, squared stern — classic ship-icon read at a glance.
  ctx.beginPath();
  ctx.moveTo(0, -4);          // bow
  ctx.lineTo(1.4, -1.2);
  ctx.lineTo(1.4, 3);         // starboard stern
  ctx.lineTo(-1.4, 3);        // port stern
  ctx.lineTo(-1.4, -1.2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.45 / scale;
    ctx.stroke();
  }
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────
// LOD helper: bucket markers into a screen grid and assign each a
// rendering mode based on local density.
//   mode 'full'    → draw full iconographic glyph
//   mode 'compact' → draw a small hint glyph
//   mode 'minimal' → draw just a colored pixel dot
// Items in the SAME cell collapse visually so we don't overdraw.
// ──────────────────────────────────────────────────────────────────────
function classifyLOD(points, cellPx = 36) {
  // points: [{px, py, ...}, ...]
  // Returns array parallel to points with {mode, cellCount}
  const bins = new Map();
  for (const p of points) {
    const k = Math.floor(p.px / cellPx) + ':' + Math.floor(p.py / cellPx);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  const out = [];
  for (const p of points) {
    const k = Math.floor(p.px / cellPx) + ':' + Math.floor(p.py / cellPx);
    const n = bins.get(k) || 1;
    let mode;
    if (n === 1) mode = 'full';
    else if (n <= 4) mode = 'compact';
    else mode = 'minimal';
    out.push({ mode, cellCount: n });
  }
  return out;
}


function Globe({
  width, height, data, nowCursor, onPickMarker, onFocusItem, focusTarget,
  theme, animationIntensity = 0.7, layers, autoRotate = true,
  onInteract, onUserPan, zoomOutSignal = 0,
}) {
  const wrapRef = useRef(null);
  const baseRef = useRef(null);   // land (cached, redraws on rotation)
  const windRef = useRef(null);   // wind particle layer (fade-clear, flows)
  const overRef = useRef(null);   // dynamic overlay (redraws every frame)
  const rotRef = useRef([0, -15, 0]);
  const scaleRef = useRef(Math.min(width, height) / 2.1);
  const targetRotRef = useRef([0, -15, 0]);
  const targetScaleRef = useRef(scaleRef.current);
  const dirtyBase = useRef(true);
  const hoverRef = useRef(null);
  const [hover, setHover] = useState(null);
  const landRef = useRef(null);
  const gridRef = useRef(null);
  // Motion trails. For each moving entity (keyed by stable ID) we keep the last
  // TRAIL_MAX lon/lat samples. Only pushed when the item has actually moved
  // (> TRAIL_MIN_DLL degrees) so stationary vessels don't accumulate dupes.
  const TRAIL_MAX = 5;
  const TRAIL_MIN_DLL = 0.005;
  const TRAIL_STALE_MS = 10 * 60 * 1000;
  const flightHistRef = useRef(new Map());
  const shipHistRef   = useRef(new Map());
  const satHistRef    = useRef(new Map());
  const issHistRef    = useRef([]);
  // Wind grid (global 5° u/v) + particle pool for the flow animation.
  // Grid arrives from /api/wind via window.subscribeWind; particles are
  // re-seeded on dimensions change and live across frames on their own
  // canvas so the fade-clear creates visible trails.
  const windGridRef = useRef(null);
  const windParticlesRef = useRef([]);
  const windViewRef = useRef(null);   // last rot/scale snapshot for smear detection
  const WIND_PARTICLE_COUNT = 2000;
  // Auto-rotate runs whenever the `autoRotate` prop is true. On any user
  // interaction we fire `onInteract` so the parent can flip it off; to resume
  // the user clicks the toolbar rotate button (also triggers zoomOutSignal).
  const lastFrameMsRef = useRef(null);
  const AUTO_ROTATE_DEG_PER_SEC = 4;
  // GEO belt sample cache — reusing the same 181-point polyline across frames
  // while the view is stationary saves 180 projectAtAltitude calls per RAF.
  const geoBeltCacheRef = useRef({ belt: null, rotLon: null, rotLat: null, scale: null });
  // Sorted flight list — memoised so the expensive O(n log n) altitude sort
  // runs only when the flight dataset actually refreshes (every ~25s), not
  // on every RAF frame.
  const sortedFlightsRef = useRef([]);
  // Per-flight smoothing state. Each entry tracks the last real ADS-B
  // report (the "anchor") and the currently-displayed position that
  // eases toward a dead-reckoned prediction from that anchor. Removes
  // the teleport-on-snapshot jank when polls finish every 10-25 s.
  //
  //   anchorLat/Lon/Hdg/Vel/T  — from the last real server update
  //   displayLat/Lon/Hdg       — what we draw this frame
  //   lastTs                   — server's _ts, detects "new update arrived"
  const flightStateRef = useRef(new Map());
  // Ship smoothing state — declared sog (knots) + cog (degrees) feed
  // the eased display, same idea as flights. Keyed by mmsi.
  const shipStateRef   = useRef(new Map());
  // Satellite smoothing state. propagateSats now emits velLat/velLon in
  // °/sec alongside the position, computed from a second propagation
  // step at +1 s. advanceEased uses those declared values directly.
  // Keyed by norad (or name fallback).
  const satStateRef    = useRef(new Map());
  // ISS is a singleton — no key needed. wheretheiss.at returns scalar
  // velocity in km/h but no heading, so we infer both from position
  // delta between successive polls.
  const issStateRef    = useRef(null);
  // Base canvas redraw throttle. During idle auto-rotate we'd otherwise be
  // reparsing country / state / river / lake features 60×/sec; cap to ~30fps.
  const lastBaseRedrawMsRef = useRef(0);
  const countriesRef = useRef(null);        // internal country borders (mesh) — drawing only
  const countryFeaturesRef = useRef(null);  // NE admin_0 features — hit-test (has names)
  const statesRef = useRef(null);           // NE admin_1 state/province lines (zoom ≥ 2.5)
  const riversRef = useRef(null);           // Natural Earth rivers 50m
  const lakesRef = useRef(null);            // Natural Earth lakes 50m
  const citiesRef = useRef(null);           // Natural Earth populated places 50m

  // Day/night terminator drifts ~15°/hour. If the user isn't rotating
  // the globe, the base canvas isn't redrawing — and the terminator
  // would silently lag. A once-per-minute tick marks the base dirty so
  // the shade stays current. One pixel of drift per minute at any
  // reasonable zoom is imperceptible, so 60 s is plenty.
  useEffect(() => {
    if (!layers?.daynight) return;
    const id = setInterval(() => { dirtyBase.current = true; }, 60 * 1000);
    return () => clearInterval(id);
  }, [layers?.daynight]);

  // Zoom-out signal — parent increments zoomOutSignal when auto-rotate is
  // re-enabled via the toolbar button; we animate back to the default scale
  // so the view restores to "global" before the spin picks up again.
  useEffect(() => {
    if (zoomOutSignal > 0) {
      targetScaleRef.current = Math.min(width, height) / 2.1;
    }
  }, [zoomOutSignal, width, height]);

  // Rebuild the altitude-sorted flight array only when data.flights changes.
  useEffect(() => {
    sortedFlightsRef.current = data.flights
      ? data.flights.slice().sort((a, b) => (b.alt || 0) - (a.alt || 0))
      : [];
  }, [data.flights]);

  // Wind — subscribe to the global grid from /api/wind (see src/wind.jsx).
  useEffect(() => {
    if (typeof window.subscribeWind !== 'function') return;
    return window.subscribeWind((g) => { windGridRef.current = g; });
  }, []);

  // Live position of the currently-tracked object — written every frame by
  // the tracking block in the tick loop, read by the reticle renderer so
  // the ring follows a moving target instead of sitting at the dblclick
  // position forever. null when nothing is being tracked.
  const focusLiveCoordsRef = useRef(null);

  // NASA FIRMS thermal hotspot detections. Small (15-40k points) and
  // refreshed only every 15 min, so a ref is fine — no need to re-render
  // on every update.
  const firesRef = useRef([]);
  useEffect(() => {
    if (typeof window.subscribeFires !== 'function') return;
    return window.subscribeFires((list) => { firesRef.current = list || []; });
  }, []);

  // When the focused target is a ship, we load its 30-day IndexedDB
  // history and stash the polyline here. The draw loop renders it on the
  // overlay canvas with age-based alpha fade. Cleared when focus moves
  // away. Null shape: { mmsi, positions: [{t, lon, lat}, ...] }.
  const shipHistoryRef = useRef(null);
  useEffect(() => {
    if (focusTarget?.trackLayer !== 'ship' || !focusTarget.trackId) {
      shipHistoryRef.current = null;
      return;
    }
    if (typeof window.getShipHistory !== 'function') return;
    const requestedMmsi = focusTarget.trackId;
    let cancelled = false;
    window.getShipHistory(requestedMmsi).then((h) => {
      // Guard against a stale response — user may have focused a
      // different ship while this was in flight.
      if (cancelled || focusTarget?.trackId !== requestedMmsi) return;
      shipHistoryRef.current = h;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [focusTarget]);

  // When the focused target is a flight, fetch its most recent
  // OpenSky-logged dep→arr route and stash it here. The draw loop paints
  // a dashed great-circle from dep to arr plus dots at each airport;
  // meanwhile the live ADS-B stream keeps the plane icon moving on top
  // so the user can see it traverse the simulated path. null when not
  // focused on a flight or when the aircraft has no recent logged flight.
  const flightRouteRef = useRef(null);
  useEffect(() => {
    if (focusTarget?.trackLayer !== 'flight' || !focusTarget.trackId) {
      flightRouteRef.current = null;
      return;
    }
    if (typeof window.getFlightRoute !== 'function') return;
    const reqIcao = focusTarget.trackId;
    let cancelled = false;
    window.getFlightRoute(reqIcao).then((route) => {
      if (cancelled || focusTarget?.trackId !== reqIcao) return;
      flightRouteRef.current = route || null;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [focusTarget]);

  // Initialise / refresh the wind particle pool when size changes. Random
  // lon/lat and ages so the fade-in is staggered rather than synchronous.
  useEffect(() => {
    const pool = new Array(WIND_PARTICLE_COUNT);
    for (let i = 0; i < WIND_PARTICLE_COUNT; i++) {
      pool[i] = {
        lon: Math.random() * 360 - 180,
        lat: (Math.random() - 0.5) * 170,   // avoid absolute poles
        // Longer lifetimes (~4-14 s at 60fps) so the respawn rate is lower
        // and flow lines read as continuous streams rather than blinking
        // dashes.
        age: Math.random() * 400,
        maxAge: 240 + Math.floor(Math.random() * 600),
        prevX: null, prevY: null,
      };
    }
    windParticlesRef.current = pool;
  }, [width, height]);

  // Periodic prune of trail history — drop entries whose newest point is older
  // than TRAIL_STALE_MS. Without this, the flight/ship Maps grow unbounded as
  // aircraft land or vessels go dark.
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - TRAIL_STALE_MS;
      for (const map of [flightHistRef.current, shipHistRef.current, satHistRef.current]) {
        for (const [k, arr] of map) {
          if (!arr.length || arr[arr.length - 1].t < cutoff) map.delete(k);
        }
      }
      const iss = issHistRef.current;
      while (iss.length && iss[0].t < cutoff) iss.shift();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Load basemap layers. Land/graticule first so the globe paints immediately;
  // detail layers stream in and trigger re-draws as they arrive.
  useEffect(() => {
    (async () => {
      try {
        const t = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
        landRef.current = topojson.feature(t, t.objects.land);
        gridRef.current = d3.geoGraticule().step([15,15])();
        dirtyBase.current = true;
      } catch (e) { console.warn('land topo fail', e); }

      // Countries — drawing uses topojson mesh (efficient dashed borders).
      try {
        const c = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
        countriesRef.current = topojson.mesh(c, c.objects.countries, (a, b) => a !== b);
        dirtyBase.current = true;
      } catch (e) { console.warn('countries topo fail', e); }

      // Hit-test dataset — Natural Earth 110m has names and includes lake holes,
      // so clicks inside lakes resolve to the lake, not the surrounding country.
      try {
        const hc = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/110m/cultural/ne_110m_admin_0_countries_lakes.json');
        countryFeaturesRef.current = hc.features || [];
      } catch (e) { console.warn('country hit-data load fail', e); }

      // State / province lines (admin_1). Lines-only file so there's no fill
      // overhead. Drawn only at zoom ≥ 2.5 — at globe view they'd just be noise.
      try {
        const s = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/cultural/ne_50m_admin_1_states_provinces_lines.json');
        statesRef.current = s;
        dirtyBase.current = true;
      } catch (e) { console.warn('states load fail', e); }

      // Rivers, lakes, cities — Natural Earth via jsdelivr-hosted geojson.
      try {
        const r = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/physical/ne_50m_rivers_lake_centerlines.json');
        riversRef.current = r;
        dirtyBase.current = true;
      } catch (e) { console.warn('rivers load fail', e); }

      try {
        const l = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/physical/ne_50m_lakes.json');
        lakesRef.current = l;
        dirtyBase.current = true;
      } catch (e) { console.warn('lakes load fail', e); }

      try {
        const p = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/cultural/ne_50m_populated_places_simple.json');
        citiesRef.current = p;
        dirtyBase.current = true;
      } catch (e) { console.warn('cities load fail', e); }
    })();
  }, []);

  // Build projection
  const projection = useMemo(() => {
    const p = d3.geoOrthographic()
      .translate([width/2, height/2])
      .clipAngle(90)
      .precision(0.4);
    return p;
  }, [width, height]);

  // Keep projection in sync with refs every frame (handled in raf)

  // Focus target smooth transition
  useEffect(() => {
    if (!focusTarget) return;
    const [lon, lat] = focusTarget.coords;
    targetRotRef.current = [-lon, -lat, 0];
    if (focusTarget.zoom) {
      const s = Math.min(width, height) / 2.1;
      targetScaleRef.current = s * focusTarget.zoom;
    }
  }, [focusTarget, width, height]);

  // Interactions via d3-drag + d3-zoom
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const sel = d3.select(el);
    // Any input disables auto-rotate. Parent owns the on/off state, so we
    // bubble up via onInteract rather than mutating a local ref — the user
    // only re-enables rotation by clicking the toolbar button.
    const markInteraction = () => { onInteract?.(); };
    // Velocity tracking for inertia
    let vx = 0, vy = 0, lastMove = 0, lastMx = 0, lastMy = 0;
    let dragging = false;

    const drag = d3.drag()
      // Mouse only. Touch is handled by our custom pan+pinch+double-tap
      // state machine below — d3-drag's touch pipeline doesn't compose
      // cleanly with a 2-finger pinch handler, and trying to bolt
      // pinchActive guards on top produced drag-dies-mid-gesture bugs
      // (especially when App re-renders tore down the listeners mid-
      // touch).
      .filter((ev) => {
        if (ev.type === 'touchstart') return false;
        return !ev.ctrlKey && ev.button === 0;
      })
      .on('start', (ev) => {
        dragging = true;
        markInteraction();
        onUserPan?.();
        lastMove = performance.now();
        lastMx = ev.x; lastMy = ev.y;
        vx = 0; vy = 0;
        targetRotRef.current = [...rotRef.current];
      })
      .on('drag', (ev) => {
        markInteraction();
        const now = performance.now();
        const dt = Math.max(1, now - lastMove);
        // Sensitivity scales inversely with zoom
        const sens = 180 / scaleRef.current;
        // Standard d3 orthographic drag (Bostock canonical):
        //   λ' = λ + Δx · sens     (drag right ⇒ globe spins so land follows cursor)
        //   φ' = φ - Δy · sens     (drag down ⇒ tilt so ground under cursor comes toward you)
        const dx = (ev.x - lastMx) * sens;
        const dy = -(ev.y - lastMy) * sens;
        const r = rotRef.current;
        const newLat = Math.max(-89, Math.min(89, r[1] + dy));
        rotRef.current = [r[0] + dx, newLat, 0];
        targetRotRef.current = [...rotRef.current];
        dirtyBase.current = true;
        vx = dx / dt; vy = dy / dt;
        lastMove = now; lastMx = ev.x; lastMy = ev.y;
      })
      .on('end', () => {
        dragging = false;
        // Apply inertia — fold velocity into target delta
        const momentum = 240; // ms
        const r = rotRef.current;
        const nx = r[0] + vx * momentum;
        const ny = Math.max(-89, Math.min(89, r[1] + vy * momentum));
        targetRotRef.current = [nx, ny, 0];
      });

    sel.call(drag);

    // Wheel — cursor-anchored zoom. Captures the lon/lat under the cursor, scales,
    // then iteratively rotates to keep that point fixed. 3 iterations converges
    // to sub-pixel on orthographic (inverting is nonlinear so one-shot can drift).
    const zoomToward = (mx, my, factor) => {
      const min = Math.min(width, height) / 3.5;
      const max = Math.min(width, height) * 50;
      const newScale = Math.max(min, Math.min(max, scaleRef.current * factor));
      projection.rotate(rotRef.current).scale(scaleRef.current);
      const anchor = projection.invert([mx, my]);
      if (anchor && isFinite(anchor[0]) && isFinite(anchor[1])) {
        projection.scale(newScale);
        let rot = [...rotRef.current];
        for (let i = 0; i < 3; i++) {
          projection.rotate(rot);
          const p = projection(anchor);
          if (!p || !isFinite(p[0])) break;
          const dx = mx - p[0], dy = my - p[1];
          if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) break;
          // Pixel → degree. At zoom level newScale, 1 radian ≈ newScale px at the centre.
          const degPerPx = (180 / Math.PI) / newScale;
          rot[0] += dx * degPerPx;
          rot[1] -= dy * degPerPx;
          rot[1] = Math.max(-89, Math.min(89, rot[1]));
        }
        rotRef.current = rot;
        targetRotRef.current = rot;
      }
      scaleRef.current = newScale;
      targetScaleRef.current = newScale;
      dirtyBase.current = true;
    };
    const onWheel = (e) => {
      e.preventDefault();
      markInteraction();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = Math.pow(1.0015, -e.deltaY);
      zoomToward(mx, my, factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Double click — if on a marker, focus + track it (parent decides zoom
    // level and whether to keep centring as the object moves). Otherwise
    // fall through to a generic free-space zoom toward the cursor.
    const onDbl = (e) => {
      markInteraction();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = hitTest(mx, my);
      if (hit && onFocusItem) {
        onFocusItem(hit);
        return;
      }
      projection.rotate(rotRef.current).scale(scaleRef.current);
      const inv = projection.invert([mx, my]);
      if (!inv) return;
      targetRotRef.current = [-inv[0], -inv[1], 0];
      targetScaleRef.current = Math.min(scaleRef.current * 2.5, Math.min(width, height) * 50);
    };
    el.addEventListener('dblclick', onDbl);

    // Click — hit test markers, then cities, then fall through to country/lake
    // polygon containment (expensive, so only on click).
    const onClick = (e) => {
      markInteraction();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      projection.rotate(rotRef.current).scale(scaleRef.current);
      let pick = hitTest(mx, my);
      if (!pick) pick = geoHitAt(mx, my);
      if (!pick) return;
      if (pick._layer === 'cluster') {
        targetRotRef.current = [-pick.lon, -pick.lat, 0];
        targetScaleRef.current = Math.min(scaleRef.current * 2.2, Math.min(width, height) * 50);
        return;
      }
      onPickMarker?.(pick);
    };
    el.addEventListener('click', onClick);

    // Mousemove for hover
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      projection.rotate(rotRef.current).scale(scaleRef.current);
      const pick = hitTest(mx, my);
      hoverRef.current = pick ? { ...pick, sx: mx, sy: my } : null;
      el.style.cursor = pick ? 'pointer' : '';
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', () => { hoverRef.current = null; });

    // Touch pipeline — owned directly (no d3-drag for touch). Three
    // gestures to disambiguate:
    //   1-finger small move + release ............ tap       → opens dossier via synthetic click
    //   1-finger move ........................... pan       → rotates globe with inertia on release
    //   2 rapid 1-finger taps at the same spot .. double-tap → focus+track a marker or zoom
    //   2 fingers ............................... pinch     → zoom toward midpoint
    //
    // Key details:
    //   - Pan tracks by touch.identifier so drift+replace doesn't lose it.
    //   - preventDefault only on touchmove while gesturing — NOT on
    //     touchstart or non-double-tap touchend, so the browser still
    //     synthesises click events for single-taps (which onClick picks
    //     up and routes to onPickMarker).
    //   - No pinchActive-gated d3-drag guards; the two gestures never
    //     mutate rotRef in the same frame because touch events are
    //     dispatched in a well-defined order.

    const DOUBLE_TAP_MS        = 350;
    const DOUBLE_TAP_MAX_DRIFT = 30;   // px between consecutive taps
    const TAP_MAX_MOVE         = 10;   // px — if the finger moved more, it was a drag

    let pan    = null;   // { id, startX, startY, x, y, lastT, vx, vy }
    let pinch  = null;   // { anchor: {x,y}, lastDist }
    let lastTap = null;  // { x, y, t }

    const onTouchStart = (e) => {
      markInteraction();
      if (e.touches.length >= 2) {
        // Enter pinch. Abandon pan if it was active — user changed intent.
        pan = null;
        const t0 = e.touches[0], t1 = e.touches[1];
        const rect = el.getBoundingClientRect();
        pinch = {
          anchor: {
            x: (t0.clientX + t1.clientX) / 2 - rect.left,
            y: (t0.clientY + t1.clientY) / 2 - rect.top,
          },
          lastDist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY),
        };
      } else if (e.touches.length === 1 && !pinch) {
        // Enter pan. Snap targets to current so animation doesn't fight.
        onUserPan?.();
        const t = e.touches[0];
        pan = {
          id: t.identifier,
          startX: t.clientX, startY: t.clientY,
          x: t.clientX, y: t.clientY,
          lastT: performance.now(),
          vx: 0, vy: 0,
        };
        targetRotRef.current = [...rotRef.current];
      }
    };

    const onTouchMove = (e) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        markInteraction();
        const t0 = e.touches[0], t1 = e.touches[1];
        const d = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        if (pinch.lastDist > 0) {
          zoomToward(pinch.anchor.x, pinch.anchor.y, d / pinch.lastDist);
        }
        pinch.lastDist = d;
        return;
      }
      if (pan && e.touches.length === 1) {
        const t = Array.from(e.touches).find(tch => tch.identifier === pan.id);
        if (!t) return;
        e.preventDefault();
        markInteraction();
        const now = performance.now();
        const dt = Math.max(1, now - pan.lastT);
        const sens = 180 / scaleRef.current;
        const dLon = (t.clientX - pan.x) * sens;
        const dLat = -(t.clientY - pan.y) * sens;
        const r = rotRef.current;
        const newLat = Math.max(-89, Math.min(89, r[1] + dLat));
        rotRef.current = [r[0] + dLon, newLat, 0];
        targetRotRef.current = [...rotRef.current];
        dirtyBase.current = true;
        pan.vx = dLon / dt;
        pan.vy = dLat / dt;
        pan.x = t.clientX;
        pan.y = t.clientY;
        pan.lastT = now;
      }
    };

    const onTouchEnd = (e) => {
      // Pinch terminates as soon as we drop below 2 fingers.
      if (pinch && e.touches.length < 2) pinch = null;

      if (pan) {
        // Did the pan-tracked finger just lift?
        const released = Array.from(e.changedTouches).find(t => t.identifier === pan.id);
        if (released) {
          const moved = Math.hypot(released.clientX - pan.startX, released.clientY - pan.startY);
          if (moved <= TAP_MAX_MOVE && !pinch) {
            // It was a tap — check for double-tap. Single-tap falls through
            // to the synthetic click event (no preventDefault here) so
            // onPickMarker / onClick runs normally.
            const now = performance.now();
            if (lastTap
                && (now - lastTap.t) < DOUBLE_TAP_MS
                && Math.hypot(released.clientX - lastTap.x, released.clientY - lastTap.y) < DOUBLE_TAP_MAX_DRIFT) {
              e.preventDefault();   // suppress the click that would otherwise fire
              const rect = el.getBoundingClientRect();
              const mx = released.clientX - rect.left;
              const my = released.clientY - rect.top;
              const hit = hitTest(mx, my);
              if (hit && onFocusItem) {
                onFocusItem(hit);
              } else {
                projection.rotate(rotRef.current).scale(scaleRef.current);
                const inv = projection.invert([mx, my]);
                if (inv) {
                  targetRotRef.current = [-inv[0], -inv[1], 0];
                  targetScaleRef.current = Math.min(scaleRef.current * 2.5, Math.min(width, height) * 50);
                }
              }
              lastTap = null;
            } else {
              lastTap = { x: released.clientX, y: released.clientY, t: now };
            }
          } else {
            // True pan — apply inertia via target rotation overshoot.
            lastTap = null;
            const momentum = 240;
            const r = rotRef.current;
            const nx = r[0] + pan.vx * momentum;
            const ny = Math.max(-89, Math.min(89, r[1] + pan.vy * momentum));
            targetRotRef.current = [nx, ny, 0];
          }
          pan = null;
        }
      }

      // Pinch-to-pan transition: if exactly one finger remains after a
      // pinch (or any multi-touch sequence), resume pan with it so the
      // gesture feels continuous.
      if (!pan && !pinch && e.touches.length === 1) {
        const t = e.touches[0];
        pan = {
          id: t.identifier,
          startX: t.clientX, startY: t.clientY,
          x: t.clientX, y: t.clientY,
          lastT: performance.now(),
          vx: 0, vy: 0,
        };
        targetRotRef.current = [...rotRef.current];
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: false });
    el.addEventListener('touchcancel', onTouchEnd,  { passive: true });

    return () => {
      sel.on('.drag', null);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('click', onClick);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [width, height, projection, onPickMarker, onFocusItem, onUserPan]);

  const hitRegionsRef = useRef([]);
  // City hit regions are rebuilt with the base canvas (only redraws on
  // rotation/zoom change), so they persist between overlay frames and don't
  // need to be pushed by the overlay draw.
  const cityHitsRef = useRef([]);

  function hitTest(mx, my) {
    // Overlay markers first (data layers — last drawn = topmost).
    const regions = hitRegionsRef.current;
    let best = null, bestD = Infinity;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      const dx = r.x - mx, dy = r.y - my;
      const d2 = dx*dx + dy*dy;
      const hitR = r.radius || 8;
      if (d2 < hitR*hitR && d2 < bestD) { bestD = d2; best = r; }
    }
    if (best) return best.payload;
    // Then cities (cheap — point-distance check).
    const cities = cityHitsRef.current;
    for (let i = cities.length - 1; i >= 0; i--) {
      const c = cities[i];
      const dx = c.x - mx, dy = c.y - my;
      const d2 = dx*dx + dy*dy;
      if (d2 < 8*8 && d2 < bestD) { bestD = d2; best = c; }
    }
    return best?.payload || null;
  }

  // Expensive polygon hit test — only invoked on click, never on hover.
  // Returns a country feature or a lake feature, preferring lakes because
  // admin_0_countries_lakes already has lake holes cut out of countries.
  function geoHitAt(mx, my) {
    projection.rotate(rotRef.current).scale(scaleRef.current);
    const ll = projection.invert([mx, my]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
    // Lakes first — they're physically on top of countries visually.
    if (lakesRef.current?.features) {
      for (const f of lakesRef.current.features) {
        if (d3.geoContains(f, ll)) {
          const n = f.properties?.name;
          return { _layer: 'lake', name: n || 'Unnamed lake', lon: ll[0], lat: ll[1] };
        }
      }
    }
    if (countryFeaturesRef.current) {
      for (const f of countryFeaturesRef.current) {
        if (d3.geoContains(f, ll)) {
          const p = f.properties || {};
          return {
            _layer: 'country',
            name: p.NAME || p.ADMIN || p.name || 'Unknown',
            iso: p.ISO_A2 || p.iso_a2 || null,
            continent: p.CONTINENT || p.continent || null,
            region: p.SUBREGION || p.subregion || null,
            pop: p.POP_EST || p.pop_est || null,
            gdp: p.GDP_MD || p.gdp_md || null,
            lon: ll[0], lat: ll[1],
          };
        }
      }
    }
    return null;
  }

  function visibleOn(proj, lon, lat) {
    const pt = proj([lon, lat]);
    if (!pt) return false;
    // geoOrthographic returns null for back hemisphere due to clipAngle but only for paths; for points it still returns coords. Check via geoDistance.
    const rot = proj.rotate();
    const center = [-rot[0], -rot[1]];
    const d = d3.geoDistance([lon,lat], center);
    return d < Math.PI/2;
  }

  // Project a point "at altitude" — offset radially outward from the globe center
  // based on its altitude above Earth's surface (km). Returns null if the sub-point
  // is on the far hemisphere (so the satellite would be behind the globe).
  function projectAtAltitude(proj, lon, lat, altKm) {
    if (!visibleOn(proj, lon, lat)) return null;
    const pt = proj([lon, lat]);
    if (!pt) return null;
    const EARTH_R = 6371;
    const r = proj.scale(); // px radius of globe
    const cx = width/2, cy = height/2;
    // radial factor — 1 at surface, grows with altitude; capped for visual clarity
    const factor = 1 + Math.min(altKm / EARTH_R, 6); // GEO ≈ 1 + 5.6 ≈ 6.6x
    // scale factor should be more gentle visually so ring doesn't fly off-screen
    const visualFactor = 1 + Math.log10(1 + altKm/300) * 0.18; // LEO≈1.02, MEO≈1.1, GEO≈1.4
    const dx = pt[0]-cx, dy = pt[1]-cy;
    const len = Math.hypot(dx,dy);
    if (len < 0.5) return pt; // sub-point at center
    const scaled = visualFactor;
    return [cx + dx/len * len * scaled, cy + dy/len * len * scaled];
  }

  // Grid-based clustering — groups nearby markers into bins sized in pixels.
  // Returns list of { x, y, count, items, lon, lat }
  function clusterPoints(proj, items, binPx) {
    const bins = new Map();
    for (const it of items) {
      const pt = proj([it.lon, it.lat]);
      if (!pt) continue;
      if (!visibleOn(proj, it.lon, it.lat)) continue;
      const kx = Math.floor(pt[0] / binPx);
      const ky = Math.floor(pt[1] / binPx);
      const key = kx + ':' + ky;
      let b = bins.get(key);
      if (!b) { b = { sx:0, sy:0, slon:0, slat:0, count:0, items:[] }; bins.set(key, b); }
      b.sx += pt[0]; b.sy += pt[1]; b.slon += it.lon; b.slat += it.lat;
      b.count++; b.items.push(it);
    }
    const out = [];
    for (const b of bins.values()) {
      out.push({
        x: b.sx/b.count, y: b.sy/b.count,
        lon: b.slon/b.count, lat: b.slat/b.count,
        count: b.count, items: b.items,
      });
    }
    return out;
  }

  // Main draw loop
  useEffect(() => {
    let raf;
    const base = baseRef.current, over = overRef.current, wind = windRef.current;
    if (!base || !over || !wind) return;
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    base.width = width*dpr; base.height = height*dpr;
    over.width = width*dpr; over.height = height*dpr;
    wind.width = width*dpr; wind.height = height*dpr;
    base.style.width = width+'px'; base.style.height = height+'px';
    over.style.width = width+'px'; over.style.height = height+'px';
    wind.style.width = width+'px'; wind.style.height = height+'px';
    const bctx = base.getContext('2d'); bctx.scale(dpr, dpr);
    const octx = over.getContext('2d'); octx.scale(dpr, dpr);
    const wctx = wind.getContext('2d'); wctx.scale(dpr, dpr);
    dirtyBase.current = true;

    const tick = () => {
      const tickNow = performance.now();
      const frameDt = lastFrameMsRef.current ? (tickNow - lastFrameMsRef.current) / 1000 : 0;
      lastFrameMsRef.current = tickNow;

      // Auto-rotate runs whenever the prop is true. Interactions flip it
      // off via onInteract (parent owns the flag). Base redraw is throttled
      // to ~30fps so we don't reparse every Natural Earth feature at 60 Hz.
      if (autoRotate && !focusTarget && frameDt > 0 && frameDt < 0.5) {
        const r = rotRef.current;
        const nx = r[0] + AUTO_ROTATE_DEG_PER_SEC * frameDt;
        rotRef.current = [nx, r[1], 0];
        targetRotRef.current = [...rotRef.current];
        // Throttling is now centralised at the base-redraw check below —
        // setting the dirty flag unconditionally here lets the throttle
        // decide when to actually render.
        dirtyBase.current = true;
      }

      // Live-track moving objects when the user double-clicked to focus
      // them. Each frame we re-resolve the tracked item's current position
      // from the data stream (flights/ships update every 15–30 s, ISS every
      // second) and update the target rotation so the easing interpolator
      // keeps the globe centred on the object as it moves. The live
      // position is also stashed in a ref so the reticle render code can
      // draw at the moving position instead of the stale dblclick coords.
      if (focusTarget?.trackId && data) {
        let live = null;
        switch (focusTarget.trackLayer) {
          case 'iss':    live = data.iss; break;
          case 'flight': live = data.flights?.find(f => f.id === focusTarget.trackId); break;
          case 'ship':   live = data.ships?.find(s => s.mmsi === focusTarget.trackId); break;
          case 'sat':    live = data.sats?.find(s => (s.norad || s.name) === focusTarget.trackId); break;
        }
        // Prefer the eased display position over the raw snapshot for ALL
        // moving targets — otherwise the camera lurches every time a new
        // snapshot arrives even though the icon visibly glides.
        if (live) {
          let st = null;
          if      (focusTarget.trackLayer === 'flight') st = flightStateRef.current.get(focusTarget.trackId);
          else if (focusTarget.trackLayer === 'ship')   st = shipStateRef.current.get(focusTarget.trackId);
          else if (focusTarget.trackLayer === 'sat')    st = satStateRef.current.get(focusTarget.trackId);
          else if (focusTarget.trackLayer === 'iss')    st = issStateRef.current;
          if (st) {
            // Flights store display in .displayLat/Lon; ships/sats/ISS in .dLat/Lon.
            const eLat = st.displayLat != null ? st.displayLat : st.dLat;
            const eLon = st.displayLon != null ? st.displayLon : st.dLon;
            if (eLat != null && eLon != null) live = { ...live, lat: eLat, lon: eLon };
          }
        }
        if (live && typeof live.lat === 'number' && typeof live.lon === 'number') {
          targetRotRef.current = [-live.lon, -live.lat, 0];
          focusLiveCoordsRef.current = [live.lon, live.lat];
        }
      } else {
        focusLiveCoordsRef.current = null;
      }

      // Smooth toward target (lerp)
      const R = rotRef.current, T = targetRotRef.current;
      // angular shortest path for longitude
      let dx = T[0]-R[0];
      while (dx > 180) dx -= 360; while (dx < -180) dx += 360;
      const dy = T[1]-R[1];
      const lerp = 0.15;
      if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
        rotRef.current = [R[0]+dx*lerp, R[1]+dy*lerp, 0];
        dirtyBase.current = true;
      }
      const S = scaleRef.current, TS = targetScaleRef.current;
      if (Math.abs(TS-S) > 0.5) {
        scaleRef.current = S + (TS-S)*0.18;
        dirtyBase.current = true;
      }

      projection.rotate(rotRef.current).scale(scaleRef.current);

      // Draw base (only when dirty AND enough time has passed) — the base
      // layer re-projects country polygons, states, rivers, lakes, and
      // cities; on mobile a 60-120 Hz touchmove stream used to redraw all
      // of that on every frame, making drag/pinch feel janky. Cap to
      // ~45 FPS (22 ms) — imperceptible drift, massive CPU savings.
      const BASE_REDRAW_MIN_MS = 22;
      if (dirtyBase.current && (tickNow - lastBaseRedrawMsRef.current) >= BASE_REDRAW_MIN_MS) {
        lastBaseRedrawMsRef.current = tickNow;
        bctx.clearRect(0,0,width,height);
        const path = d3.geoPath(projection, bctx);
        const isDark = theme === 'dark';
        const baseScaleB = Math.min(width, height) / 2.1;
        const zoomB = scaleRef.current / baseScaleB;

        // Ocean disk
        bctx.beginPath(); path({type:'Sphere'});
        bctx.fillStyle = isDark ? 'rgba(20,25,40,0.35)' : 'rgba(240,245,255,0.55)';
        bctx.fill();

        // Graticule — thinner/dimmer as we zoom in so detail layers breathe.
        if (gridRef.current) {
          bctx.beginPath(); path(gridRef.current);
          const gridAlpha = isDark ? (zoomB > 2.2 ? 0.04 : 0.07) : (zoomB > 2.2 ? 0.05 : 0.09);
          bctx.strokeStyle = isDark ? `rgba(255,255,255,${gridAlpha})` : `rgba(20,30,60,${gridAlpha})`;
          bctx.lineWidth = 0.5; bctx.stroke();
        }

        // Day / night terminator — shade the night hemisphere. The antisolar
        // point is 180° opposite the subsolar point; every location within
        // 90° of antisolar is currently in night. d3.geoCircle builds the
        // GeoJSON polygon with proper horizon-aware clipping on the
        // orthographic projection. Subtle dark tint so country borders and
        // coastlines still read through it.
        if (layers.daynight) {
          const sub = solarPosition(Date.now());
          const antiLon = ((sub[0] + 180 + 540) % 360) - 180;
          const antiLat = -sub[1];
          const nightPoly = d3.geoCircle().center([antiLon, antiLat]).radius(90)();
          bctx.beginPath();
          path(nightPoly);
          bctx.fillStyle = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(10,14,32,0.22)';
          bctx.fill();
        }

        // Lakes (filled) — zoom ≥ 1.2. Painted before land outline so the land
        // stroke still reads over the inset water bodies.
        if (lakesRef.current && zoomB >= 1.2) {
          bctx.beginPath(); path(lakesRef.current);
          bctx.fillStyle = isDark ? 'rgba(56,189,248,0.14)' : 'rgba(14,116,144,0.12)';
          bctx.fill();
          bctx.strokeStyle = isDark ? 'rgba(56,189,248,0.3)' : 'rgba(14,116,144,0.35)';
          bctx.lineWidth = 0.5; bctx.stroke();
        }

        // Land — wireframe outline (the signature look)
        if (landRef.current) {
          bctx.beginPath(); path(landRef.current);
          bctx.strokeStyle = isDark ? 'rgba(244,63,94,0.55)' : 'rgba(244,63,94,0.75)';
          bctx.lineWidth = 0.9; bctx.stroke();
        }

        // Country borders — always visible but fade up with zoom.
        if (countriesRef.current) {
          const ca = Math.min(0.55, 0.12 + (zoomB - 1) * 0.22);
          bctx.beginPath(); path(countriesRef.current);
          bctx.strokeStyle = isDark ? `rgba(226,232,240,${ca})` : `rgba(30,41,59,${ca * 0.9})`;
          bctx.lineWidth = zoomB >= 2 ? 0.65 : 0.5;
          bctx.setLineDash([2, 2]);
          bctx.stroke();
          bctx.setLineDash([]);
        }

        // State / province lines — fade in from zoom 1.8, fully visible by 4.
        // Dropped the threshold from 2.5 → 1.8 so sub-national borders appear
        // at the same zoom cities do; no point showing Tokyo but hiding the
        // Kanto boundary around it.
        if (statesRef.current && zoomB >= 1.8) {
          const sa = Math.min(0.5, (zoomB - 1.8) * 0.22 + 0.08);
          bctx.beginPath(); path(statesRef.current);
          bctx.strokeStyle = isDark ? `rgba(148,163,184,${sa})` : `rgba(71,85,105,${sa * 1.1})`;
          bctx.lineWidth = zoomB >= 3 ? 0.5 : 0.4;
          bctx.setLineDash([1, 2]);
          bctx.stroke();
          bctx.setLineDash([]);
        }

        // Rivers — zoom ≥ 1.5. Thin cyan hairlines.
        if (riversRef.current && zoomB >= 1.5) {
          const ra = Math.min(0.65, 0.15 + (zoomB - 1.5) * 0.3);
          bctx.beginPath(); path(riversRef.current);
          bctx.strokeStyle = isDark ? `rgba(125,211,252,${ra})` : `rgba(14,165,233,${ra})`;
          bctx.lineWidth = 0.55;
          bctx.stroke();
        }

        // Cities — zoom ≥ 1.8, filtered by SCALERANK (0 = biggest). Higher zoom
        // reveals smaller cities. Dot + optional label. Also builds hit regions.
        cityHitsRef.current = [];
        if (citiesRef.current && zoomB >= 1.8) {
          const rankCap =
            zoomB >= 6 ? 10 :
            zoomB >= 4 ? 8 :
            zoomB >= 3 ? 6 :
            zoomB >= 2.4 ? 4 : 2;
          bctx.fillStyle = isDark ? 'rgba(253,224,71,0.95)' : 'rgba(180,83,9,0.95)';
          bctx.strokeStyle = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
          bctx.lineWidth = 0.8;
          bctx.font = `500 ${zoomB >= 3 ? 10 : 9}px Geist Mono, monospace`;
          bctx.textBaseline = 'middle';
          for (const f of citiesRef.current.features) {
            const p = f.properties || {};
            const sr = p.scalerank ?? p.SCALERANK ?? 99;
            if (sr > rankCap) continue;
            const [lon, lat] = f.geometry.coordinates;
            if (!visibleOn(projection, lon, lat)) continue;
            const pt = projection([lon, lat]); if (!pt) continue;
            const r = sr <= 1 ? 2.6 : sr <= 3 ? 2.1 : 1.6;
            bctx.beginPath(); bctx.arc(pt[0], pt[1], r, 0, Math.PI*2);
            bctx.fill(); bctx.stroke();
            cityHitsRef.current.push({
              x: pt[0], y: pt[1],
              payload: {
                _layer: 'city',
                name: p.name || p.NAME || 'Unknown',
                country: p.adm0name || p.ADM0NAME || '',
                admin1: p.adm1name || '',
                pop: p.pop_max ?? p.pop_min ?? null,
                featurecla: p.featurecla || '',
                megacity: !!p.megacity,
                worldcity: !!p.worldcity,
                lon, lat,
              },
            });
            // City LABELS are opt-in via deep zoom. Dots + hover tooltips are
            // available from zoom 1.8 (see rankCap above) so the user can
            // identify any city interactively; labels only paint at zoom 10+
            // and even then only for the top-tier cities until you zoom
            // further still. Keeps the map legible when the user is just
            // orienting regionally.
            const labelRankCap =
              zoomB >= 18 ? 8 :
              zoomB >= 14 ? 5 :
              zoomB >= 10 ? 2 : -1;
            if (sr <= labelRankCap) {
              const name = p.name || p.NAME || '';
              if (name) {
                bctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(15,23,42,0.9)';
                bctx.fillText(name, pt[0] + r + 3, pt[1]);
                bctx.fillStyle = isDark ? 'rgba(253,224,71,0.95)' : 'rgba(180,83,9,0.95)';
              }
            }
          }
        }

        // Sphere edge — last so it always tops the base stack.
        bctx.beginPath(); path({type:'Sphere'});
        bctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
        bctx.lineWidth = 1; bctx.stroke();
        dirtyBase.current = false;
      }

      // Wind particle flow. Dedicated canvas using fade-clear (paint a
      // translucent rect over the whole thing each frame) so moving particles
      // leave short-lived trails. Bilinear interpolation on the 5° grid
      // smooths the motion between anchor points.
      const isDarkW = theme === 'dark';
      if (layers.wind && windGridRef.current) {
        const g = windGridRef.current;
        const { latMin, lonMin, latStep, lonStep, nLat, nLon, u, v } = g;
        const sampleWind = (lon, lat) => {
          // wrap lon to the grid's range
          let x = (lon - lonMin) / lonStep;
          let y = (lat - latMin) / latStep;
          if (x < 0) x += nLon; if (x >= nLon) x -= nLon;
          if (y < 0 || y >= nLat - 1) return null;
          const x0 = Math.floor(x) % nLon;
          const x1 = (x0 + 1) % nLon;
          const y0 = Math.floor(y);
          const y1 = y0 + 1;
          const fx = x - Math.floor(x), fy = y - y0;
          const i00 = y0 * nLon + x0, i10 = y0 * nLon + x1;
          const i01 = y1 * nLon + x0, i11 = y1 * nLon + x1;
          // Bilinear
          const uu = (1-fx)*(1-fy)*u[i00] + fx*(1-fy)*u[i10] + (1-fx)*fy*u[i01] + fx*fy*u[i11];
          const vv = (1-fx)*(1-fy)*v[i00] + fx*(1-fy)*v[i10] + (1-fx)*fy*v[i01] + fx*fy*v[i11];
          return [uu, vv];
        };

        // Only hard-reset particle prev-coords on *big* user pans (>0.5°
        // lat/lon or noticeable scale change). Auto-rotate advances about
        // 0.07°/frame — far below this — so we don't fight the animation
        // there. Individual frame drift of ~1-2px under auto-rotate is
        // imperceptible and the fade-clear cleans up any staleness.
        const view = windViewRef.current;
        const rNow = rotRef.current, sNow = scaleRef.current;
        const moved = !view
          || Math.abs(view[0] - rNow[0]) > 0.6
          || Math.abs(view[1] - rNow[1]) > 0.6
          || Math.abs(view[2] - sNow) > 2.0;
        if (moved) {
          const particles = windParticlesRef.current;
          for (let i = 0; i < particles.length; i++) {
            particles[i].prevX = null;
            particles[i].prevY = null;
          }
          windViewRef.current = [rNow[0], rNow[1], sNow];
        }
        wctx.save();
        wctx.globalCompositeOperation = 'destination-out';
        wctx.fillStyle = `rgba(0,0,0,${isDarkW ? 0.025 : 0.04})`;
        wctx.fillRect(0, 0, width, height);
        wctx.restore();

        // Map m/s → HSL colour. Blue for calm, through cyan / green / yellow
        // / orange / red, maxing out at "hurricane" speeds.
        const windColor = (speed, alpha) => {
          const t = Math.min(speed / 28, 1);
          const hue = 210 - t * 210;        // 210 blue → 0 red
          const sat = 65 + t * 25;
          const light = 58 + (1 - t) * 8;
          return `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha})`;
        };

        // Particle advance. SQRT compression on speed so 1 m/s still shows
        // visible motion and 25 m/s isn't a blur. Direction vector is
        // preserved; only the magnitude is remapped.
        //
        //   effective motion = direction × sqrt(speed + 0.5) × SCALE
        //     1 m/s  → 1.22 units
        //    10 m/s  → 3.24 units
        //    25 m/s  → 5.05 units
        //
        // SCALE of 0.025 puts typical jet-stream flow at roughly 5°/s
        // traverse — quick enough to read as flow, slow enough to track.
        const SCALE = 0.025;
        const particles = windParticlesRef.current;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.age++;
          // Respawn on age timeout or if position is wild.
          if (p.age > p.maxAge || p.lat > 88 || p.lat < -88) {
            p.lon = Math.random() * 360 - 180;
            p.lat = (Math.random() - 0.5) * 160;
            p.age = 0;
            p.prevX = null; p.prevY = null;
            continue;
          }
          const w = sampleWind(p.lon, p.lat);
          if (!w) continue;
          const [uu, vv] = w;
          const speed = Math.hypot(uu, vv);
          const visMag = Math.sqrt(speed + 0.5);
          const dirX = uu / Math.max(speed, 0.01);
          const dirY = vv / Math.max(speed, 0.01);
          // Advance in degrees. Lon needs cos(lat) correction.
          const latRad = p.lat * Math.PI / 180;
          const cosLat = Math.max(0.05, Math.cos(latRad));
          p.lat += dirY * visMag * SCALE;
          p.lon += (dirX * visMag * SCALE) / cosLat;
          if (p.lon > 180) p.lon -= 360;
          if (p.lon < -180) p.lon += 360;

          // Only draw when on the visible hemisphere.
          if (!visibleOn(projection, p.lon, p.lat)) { p.prevX = null; p.prevY = null; continue; }
          const pt = projection([p.lon, p.lat]);
          if (!pt) continue;
          if (p.prevX != null && p.prevY != null) {
            wctx.beginPath();
            wctx.moveTo(p.prevX, p.prevY);
            wctx.lineTo(pt[0], pt[1]);
            wctx.strokeStyle = windColor(speed, 0.9);
            wctx.lineWidth = 1.3;
            wctx.stroke();
          }
          p.prevX = pt[0]; p.prevY = pt[1];
        }
      } else if (wctx && !layers.wind) {
        // Layer is off — clear the wind canvas once per frame cheaply.
        wctx.clearRect(0, 0, width, height);
      }

      // Overlay (dynamic)
      octx.clearRect(0,0,width,height);
      hitRegionsRef.current = [];
      const pushHit = (x, y, radius, layer, payload) => {
        hitRegionsRef.current.push({ x, y, radius, payload: { ...payload, _layer: layer } });
      };
      const now = performance.now();
      const nowMs = Date.now();
      const isDark = theme === 'dark';

      // Trail helpers. `pushTrail` dedupes stationary updates; `drawTrail`
      // renders a fading polyline using the projection (optional altitude for
      // satellites) and returns the final [px, py] so the caller can place the
      // marker at the current position.
      const pushTrail = (map, id, lon, lat) => {
        const arr = map.get(id);
        if (!arr) { map.set(id, [{ lon, lat, t: nowMs }]); return; }
        const last = arr[arr.length - 1];
        if (Math.abs(last.lon - lon) < TRAIL_MIN_DLL && Math.abs(last.lat - lat) < TRAIL_MIN_DLL) {
          last.t = nowMs;
          return;
        }
        arr.push({ lon, lat, t: nowMs });
        if (arr.length > TRAIL_MAX) arr.shift();
      };
      // Normalises either form — records may pass:
      //   a) [{lon, lat, t}, ...]      (client-side pushTrail history)
      //   b) [[lon, lat], ...]         (server-seeded track from SSE record)
      // so callers don't have to adapt.
      const toLL = (p) => Array.isArray(p) ? { lon: p[0], lat: p[1] } : p;
      // Max great-circle delta between consecutive points that we're willing
      // to draw a segment for. Satellite TLE refreshes occasionally jump the
      // predicted position; and anything wrapping the 180° meridian produces
      // an antipodal pair after projection. Clip those artefacts.
      const TRAIL_MAX_DEG_PER_SEG = 25;
      const drawTrail = (hist, color, altKm) => {
        if (!hist || hist.length < 2) return;
        const project = altKm ? ((lon, lat) => projectAtAltitude(projection, lon, lat, altKm)) : ((lon, lat) => projection([lon, lat]));
        for (let i = 0; i < hist.length - 1; i++) {
          const a1 = toLL(hist[i]);
          const a2 = toLL(hist[i+1]);
          // Quick skip on degenerate or absurd segments.
          let dLon = Math.abs(a1.lon - a2.lon);
          if (dLon > 180) dLon = 360 - dLon;
          const dLat = Math.abs(a1.lat - a2.lat);
          if (dLon > TRAIL_MAX_DEG_PER_SEG || dLat > TRAIL_MAX_DEG_PER_SEG) continue;
          const p1 = project(a1.lon, a1.lat);
          const p2 = project(a2.lon, a2.lat);
          if (!p1 || !p2) continue;
          const a = 0.08 + (i / Math.max(1, hist.length - 2)) * 0.27;
          octx.beginPath();
          octx.moveTo(p1[0], p1[1]);
          octx.lineTo(p2[0], p2[1]);
          octx.strokeStyle = color.replace(/[\d.]+\)$/, a.toFixed(2) + ')');
          octx.lineWidth = 0.7;
          octx.stroke();
        }
      };

      // Aurora
      if (layers.aurora && data.aurora) {
        for (const a of data.aurora) {
          if (!visibleOn(projection, a.lon, a.lat)) continue;
          const pt = projection([a.lon, a.lat]); if (!pt) continue;
          octx.beginPath(); octx.arc(pt[0], pt[1], 2, 0, Math.PI*2);
          octx.fillStyle = `rgba(132,204,163,${(a.p/100)*0.45})`;
          octx.fill();
        }
      }

      // Compute zoom factor once, used for all LOD decisions below.
      const baseScale = Math.min(width, height) / 2.1;
      const zoom = scaleRef.current / baseScale;
      const binPx = Math.max(12, 42 / zoom);

      // Earthquakes. Magnitude threshold filtering happens in App's
      // filteredData so by the time we render, every quake is "above the
      // user's chosen floor." We no longer paint magnitude labels on the map
      // (too noisy — dossier + hover tooltip carry the number). Icons are
      // roughly half the size they used to be so dense regions read cleanly.
      if (layers.quakes && data.quakes) {
        const visibleQuakes = data.quakes.filter(q => {
          const age = (nowCursor - q.time) / (24*3600*1000);
          return age >= 0 && age <= 1 && visibleOn(projection, q.lon, q.lat);
        });
        for (const q of visibleQuakes) {
          const pt = projection([q.lon, q.lat]); if (!pt) continue;
          const [px, py] = pt;
          const mag = q.mag || 0;
          const age = (nowCursor - q.time) / (24*3600*1000);
          const col = mag >= 5 ? '#f43f5e' : mag >= 4 ? '#fb923c' : mag >= 3 ? '#fbbf24' : '#d97706';

          if (mag >= 5) {
            // Significant — still keep the pulse, just smaller.
            const phase = ((now/1000) + (q.id?.charCodeAt(0) || 0))%1.8/1.8;
            const sz = 9 + (mag - 5) * 1.4;
            octx.beginPath();
            octx.arc(px, py, sz*0.7 + phase*10*animationIntensity, 0, Math.PI*2);
            octx.strokeStyle = `rgba(244,63,94,${0.45*(1-phase)*(1-age*0.6)})`;
            octx.lineWidth = 1; octx.stroke();
            iconQuake(octx, px, py, sz, col, isDark);
            pushHit(px, py, Math.max(sz, 8), 'quake', q);
          } else if (mag >= 4) {
            iconQuake(octx, px, py, 7, col, isDark);
            pushHit(px, py, 7, 'quake', q);
          } else if (mag >= 3) {
            iconQuake(octx, px, py, 6, col, isDark);
            pushHit(px, py, 6, 'quake', q);
          } else {
            // M<3 — minimum tappable hit target even though the glyph is tiny.
            iconQuake(octx, px, py, 5, isDark ? 'rgba(251,146,60,0.7)' : 'rgba(217,119,6,0.75)', isDark);
            pushHit(px, py, 6, 'quake', q);
          }
        }
      }

      // EONET events — per-category iconography with LOD
      if (layers.events && data.events) {
        const catMeta = (cid) => {
          cid = cid || '';
          if (cid.includes('wildfire'))                          return { c:'#ef4444', fn:iconFire };
          if (cid.includes('volcano'))                           return { c:'#f97316', fn:iconVolcano };
          if (cid.includes('storm') || cid.includes('cyclone'))  return { c:'#38bdf8', fn:iconStorm };
          if (cid.includes('ice') || cid.includes('snow'))       return { c:'#a5f3fc', fn:iconIce };
          return { c:'#a78bfa', fn:iconEvent };
        };
        const isStormCat = (cid) => {
          cid = cid || '';
          return cid.includes('storm') || cid.includes('cyclone');
        };

        // Storm tracks — draw the past-path polyline first so the current
        // marker and heading arrow render on top. Age-faded segments mirror
        // the ship-trail pattern at ~L2122 so history reads as history.
        if (layers.stormTracks !== false) {
          const now = Date.now();
          const maxAge = 30 * 24 * 3600 * 1000;
          octx.lineWidth = 1.2;
          for (const e of data.events) {
            if (!e.track || e.track.length < 2) continue;
            if (!isStormCat(e.categoryId)) continue;
            const { c } = catMeta(e.categoryId);
            const pos = e.track;
            // Polyline segments (only where both endpoints are on the
            // visible hemisphere — a great-circle horizon split would need
            // densification to render cleanly).
            for (let i = 0; i < pos.length - 1; i++) {
              const a = pos[i], b = pos[i + 1];
              if (!visibleOn(projection, a.lon, a.lat)) continue;
              if (!visibleOn(projection, b.lon, b.lat)) continue;
              const pa = projection([a.lon, a.lat]);
              const pb = projection([b.lon, b.lat]);
              if (!pa || !pb) continue;
              const age = Math.max(0, (now - a.t) / maxAge);
              const alpha = Math.max(0.15, 0.75 * (1 - age));
              octx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(3)})`;
              octx.beginPath();
              octx.moveTo(pa[0], pa[1]);
              octx.lineTo(pb[0], pb[1]);
              octx.stroke();
            }
            // Small dots at each ping so cadence is visible.
            octx.fillStyle = `rgba(56, 189, 248, 0.55)`;
            for (const p of pos) {
              if (!visibleOn(projection, p.lon, p.lat)) continue;
              const pt = projection([p.lon, p.lat]);
              if (!pt) continue;
              octx.beginPath();
              octx.arc(pt[0], pt[1], 0.9, 0, Math.PI * 2);
              octx.fill();
            }
            // Heading arrow at the current (last) position — screen-space
            // angle from penultimate → last point, so projection curvature
            // is already baked in.
            const lastP = pos[pos.length - 1];
            const prevP = pos[pos.length - 2];
            if (visibleOn(projection, lastP.lon, lastP.lat) &&
                visibleOn(projection, prevP.lon, prevP.lat)) {
              const pl = projection([lastP.lon, lastP.lat]);
              const pp = projection([prevP.lon, prevP.lat]);
              if (pl && pp) {
                const dx = pl[0] - pp[0], dy = pl[1] - pp[1];
                const mag = Math.hypot(dx, dy);
                if (mag > 0.5) {
                  const ang = Math.atan2(dy, dx);
                  const tipD = 14, baseD = 8, wing = 4;
                  const tx = pl[0] + Math.cos(ang) * tipD;
                  const ty = pl[1] + Math.sin(ang) * tipD;
                  const bx = pl[0] + Math.cos(ang) * baseD;
                  const by = pl[1] + Math.sin(ang) * baseD;
                  const nx = -Math.sin(ang), ny = Math.cos(ang);
                  octx.fillStyle = c;
                  octx.beginPath();
                  octx.moveTo(tx, ty);
                  octx.lineTo(bx + nx * wing, by + ny * wing);
                  octx.lineTo(bx - nx * wing, by - ny * wing);
                  octx.closePath();
                  octx.fill();
                }
              }
            }
          }
        }

        const ePts = [];
        for (const e of data.events) {
          if (!visibleOn(projection, e.lon, e.lat)) continue;
          const pt = projection([e.lon, e.lat]); if (!pt) continue;
          ePts.push({ px:pt[0], py:pt[1], e });
        }
        const lod = classifyLOD(ePts, Math.max(28, 40/zoom));
        for (let i = 0; i < ePts.length; i++) {
          const { px, py, e } = ePts[i];
          const { c, fn } = catMeta(e.categoryId);
          const { mode } = lod[i];
          if (mode === 'full')         fn(octx, px, py, 11, c);
          else if (mode === 'compact') fn(octx, px, py, 7, c);
          else                         fn(octx, px, py, 4, c);
          pushHit(px, py, mode==='full'?9:6, 'event', e);
        }
      }

      // Lightning strikes — quick bright flashes that fade over ~3 s.
      // Rendered on the overlay (which redraws every frame) so the fade
      // animation reads correctly. No hit regions — strikes are too
      // short-lived to click usefully.
      if (layers.lightning && typeof window.getLightningStrikes === 'function') {
        const strikes = window.getLightningStrikes();
        const now = Date.now();
        const TTL = 3000;
        for (let i = 0; i < strikes.length; i++) {
          const s = strikes[i];
          const age = (now - s.t) / TTL;
          if (age < 0 || age >= 1) continue;
          if (!visibleOn(projection, s.lon, s.lat)) continue;
          const pt = projection([s.lon, s.lat]);
          if (!pt) continue;
          const alpha = Math.max(0, 1 - age);
          // Core flash
          octx.fillStyle = `rgba(254, 240, 138, ${(alpha * 0.95).toFixed(3)})`;
          octx.beginPath();
          octx.arc(pt[0], pt[1], 1.5, 0, Math.PI * 2);
          octx.fill();
          // Halo (expands + fades slightly faster than core)
          const haloR = 3 + age * 9;
          const haloAlpha = Math.max(0, (1 - age) * 0.55);
          const g = octx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], haloR);
          g.addColorStop(0, `rgba(254, 240, 138, ${haloAlpha.toFixed(3)})`);
          g.addColorStop(1, 'rgba(254, 240, 138, 0)');
          octx.fillStyle = g;
          octx.beginPath();
          octx.arc(pt[0], pt[1], haloR, 0, Math.PI * 2);
          octx.fill();
        }
      }

      // NASA FIRMS thermal hotspots — individual fire pixels. LOD-decimated
      // because 15-40k points would dogpile at low zoom; spatial binning
      // collapses dense clusters to a single hot dot while preserving the
      // "fire-line" shape at higher zoom.
      if (layers.fires && firesRef.current && firesRef.current.length) {
        const pts = [];
        for (const f of firesRef.current) {
          if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
          if (!visibleOn(projection, f.lon, f.lat)) continue;
          const pt = projection([f.lon, f.lat]); if (!pt) continue;
          pts.push({ px: pt[0], py: pt[1], f });
        }
        // Smaller cell than events — we WANT the fire-line shape to read.
        const lod = classifyLOD(pts, Math.max(10, 18 / zoom));
        for (let i = 0; i < pts.length; i++) {
          const { px, py, f } = pts[i];
          const { mode } = lod[i];
          // Confidence 0..2 → low/nominal/high. Higher = hotter colour + brighter.
          const hot = f.conf >= 2;
          const col = hot ? 'rgba(251, 146, 60, 0.95)' : 'rgba(239, 68, 68, 0.80)';
          const r = mode === 'full' ? 2.2 : mode === 'compact' ? 1.6 : 1.1;
          octx.fillStyle = col;
          octx.beginPath();
          octx.arc(px, py, r, 0, Math.PI * 2);
          octx.fill();
          // Full-mode high-confidence fires get a soft halo glow.
          if (mode === 'full' && hot) {
            const g = octx.createRadialGradient(px, py, 0, px, py, 6);
            g.addColorStop(0,   'rgba(254, 215, 170, 0.5)');
            g.addColorStop(1,   'rgba(254, 215, 170, 0)');
            octx.fillStyle = g;
            octx.beginPath();
            octx.arc(px, py, 6, 0, Math.PI * 2);
            octx.fill();
          }
          // Push a hit only for high-confidence / full detections so the
          // dossier doesn't pop on every glancing mouse pass over a fire
          // complex with hundreds of pixels.
          if (mode === 'full') {
            pushHit(px, py, 3, 'fire', f);
          }
        }
      }

      // Plane glyph — clean aviation-tracker silhouette, designed at 10px
      // nose-to-tail. Shared between flight rendering below.
      const planeFill   = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,30,0.88)';
      const planeStroke = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
      const drawPlane = (cx, cy, hdg, scale) => {
        octx.save();
        octx.translate(cx, cy);
        octx.rotate(((hdg||0)) * Math.PI/180);
        octx.scale(scale, scale);
        octx.beginPath();
        octx.moveTo(0, -5);
        octx.lineTo(0.6, -1.5);
        octx.lineTo(5.5, 1.2);
        octx.lineTo(5.5, 1.8);
        octx.lineTo(0.6, 0.8);
        octx.lineTo(0.6, 3.2);
        octx.lineTo(2.2, 4.2);
        octx.lineTo(2.2, 4.6);
        octx.lineTo(0, 4.1);
        octx.lineTo(-2.2, 4.6);
        octx.lineTo(-2.2, 4.2);
        octx.lineTo(-0.6, 3.2);
        octx.lineTo(-0.6, 0.8);
        octx.lineTo(-5.5, 1.8);
        octx.lineTo(-5.5, 1.2);
        octx.lineTo(-0.6, -1.5);
        octx.closePath();
        octx.fillStyle = planeFill;
        octx.fill();
        octx.strokeStyle = planeStroke;
        octx.lineWidth = 0.5 / scale;
        octx.stroke();
        octx.restore();
      };

      // Flights — spatial decimation. One real plane per screen bin, skip the
      // rest. Bin size scales with zoom; at low zoom we want *fewer, smaller*
      // planes so European airspace doesn't turn into an opaque dogpile, and
      // at high zoom we want many individual aircraft visible.
      //
      //   zoom  ≤ 1     → 26px bin, 0.55 scale   (world view: hints, not mass)
      //   zoom  1 – 2   → ramp down to 14px, 0.75 scale
      //   zoom  2 – 4   → 11-ish px, 0.9 scale
      //   zoom  ≥ 4     → 9px, 1.0 scale         (approach view: real icons)
      if (layers.flights && data.flights) {
        const flightCell =
          zoom <= 1   ? 26 :
          zoom <= 2   ? 26 - (zoom - 1) * 12 :         // 26 → 14
          zoom <= 4   ? 14 - (zoom - 2) * 1.5 :        // 14 → 11
                         Math.max(9, 14 / zoom);
        const scale =
          zoom <= 1   ? 0.55 :
          zoom <= 2   ? 0.55 + (zoom - 1) * 0.2 :      // 0.55 → 0.75
          zoom <= 3   ? 0.75 + (zoom - 2) * 0.15 :     // 0.75 → 0.9
                         Math.min(1.0, 0.9 + (zoom - 3) * 0.05);
        // Prefer higher-altitude aircraft per bin. Sorted list is kept in a
        // ref and refreshed only when data.flights changes (see useEffect).
        const sorted = sortedFlightsRef.current.length ? sortedFlightsRef.current : data.flights;
        const seenFlight = new Set();
        const rendered = [];
        const fState = flightStateRef.current;
        const seenIds = new Set();
        const EASE_POS = 0.18;
        const EASE_HDG = 0.12;
        const DR_MAX_AGE_S = 120;   // stop extrapolating after 2 min stale

        for (const f of sorted) {
          seenIds.add(f.id);

          // --- Smoothing state ---
          let st = fState.get(f.id);
          if (!st) {
            // First time seeing this flight — snap display to reported pos.
            st = {
              anchorLat: f.lat, anchorLon: f.lon,
              anchorHdg: f.hdg || 0, anchorVel: f.vel || 0,
              anchorT:   tickNow,
              lastTs:    f._ts || 0,
              displayLat: f.lat, displayLon: f.lon,
              displayHdg: f.hdg || 0,
            };
            fState.set(f.id, st);
          } else if ((f._ts || 0) > st.lastTs) {
            // Fresh server update — re-anchor and let the display ease toward it.
            st.anchorLat = f.lat;
            st.anchorLon = f.lon;
            st.anchorHdg = (typeof f.hdg === 'number') ? f.hdg : st.anchorHdg;
            st.anchorVel = (typeof f.vel === 'number') ? f.vel : st.anchorVel;
            st.anchorT   = tickNow;
            st.lastTs    = f._ts;
          }

          // Dead-reckon from anchor forward by elapsed time × velocity.
          const dtSec = Math.min(DR_MAX_AGE_S, (tickNow - st.anchorT) / 1000);
          let predLat = st.anchorLat;
          let predLon = st.anchorLon;
          if (st.anchorVel > 0 && dtSec > 0) {
            const km = st.anchorVel * 1.852 / 3600 * dtSec;   // knots → km
            const hdgRad = (st.anchorHdg || 0) * Math.PI / 180;
            const latRad = st.anchorLat * Math.PI / 180;
            predLat += (km * Math.cos(hdgRad)) / 111;
            predLon += (km * Math.sin(hdgRad)) / (111 * Math.max(0.1, Math.cos(latRad)));
          }

          // Ease display toward the prediction. Exponential smoothing is
          // cheap and naturally damps jitter; big jumps (e.g. after a long
          // stall) are pulled in over ~6-8 frames.
          st.displayLat += (predLat - st.displayLat) * EASE_POS;
          st.displayLon += (predLon - st.displayLon) * EASE_POS;

          // Heading: shortest-angular-path lerp so a 359°→1° turn goes the
          // short way, not a 358° spin.
          const targetHdg = (typeof f.hdg === 'number') ? f.hdg : st.anchorHdg;
          let dh = targetHdg - st.displayHdg;
          while (dh > 180)  dh -= 360;
          while (dh < -180) dh += 360;
          st.displayHdg += dh * EASE_HDG;

          // --- Visibility + spatial decimation use the eased position ---
          if (!visibleOn(projection, st.displayLon, st.displayLat)) continue;
          const pt = projection([st.displayLon, st.displayLat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.floor(px / flightCell) << 16) | (Math.floor(py / flightCell) & 0xffff);
          if (seenFlight.has(k)) continue;
          seenFlight.add(k);
          // Trail history records the EASED position too — otherwise the
          // tail and the icon would drift apart as DR predicts forward.
          pushTrail(flightHistRef.current, f.id, st.displayLon, st.displayLat);
          rendered.push({ f, px, py, hdg: st.displayHdg });
        }

        // Prune state for flights that left the snapshot (landed, stale,
        // out of range). Keeps the map bounded without GC pressure.
        for (const hex of fState.keys()) {
          if (!seenIds.has(hex)) fState.delete(hex);
        }
        // Trails first so markers sit on top. Prefer the server-seeded `track`
        // array — it carries up to 10 past positions even on first render, so
        // newcomers don't have to wait for local history to accumulate. Fall
        // back to the client-side pushTrail history if the server didn't send
        // one (older deployments or transient gaps).
        const trailCol = isDark ? 'rgba(255,255,255,0)' : 'rgba(30,30,40,0)';
        for (const { f } of rendered) {
          const hist = (f.track && f.track.length >= 2) ? f.track : flightHistRef.current.get(f.id);
          drawTrail(hist, trailCol);
        }
        // Now the plane icons + hit regions. Use the EASED heading from
        // the smoother state so turns animate instead of snapping.
        for (const { f, px, py, hdg } of rendered) {
          drawPlane(px, py, hdg, scale);
          pushHit(px, py, Math.max(7, flightCell * 0.45), 'flight', f);
        }
      }

      // Ships — same spatial decimation as flights. One vessel per bin, no
      // tiles, no count labels. Colour tells you the type at a glance.
      if (layers.ships && data.ships?.length) {
        const shipColor = {
          cargo:     '#22d3ee',
          tanker:    '#f59e0b',
          passenger: '#a78bfa',
          fishing:   '#34d399',
          highspeed: '#f472b6',
          service:   '#94a3b8',
          sail:      '#60a5fa',
          other:     isDark ? 'rgba(148,163,184,0.9)' : 'rgba(71,85,105,0.9)',
        };
        // Stroke is the hull's contrast edge against the BACKGROUND. Previously
        // we had it matching the background colour which made the icon effectively
        // unbordered — especially painful in light mode where pale-cyan cargo
        // ships washed out against the pale ocean fill.
        const shipStroke = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.55)';
        // "Service" vessels use slate-grey which vanishes on the light-mode
        // ocean tint — patch the palette entry for light mode only.
        const lightServiceOverride = isDark ? null : 'rgba(51,65,85,0.95)';
        if (lightServiceOverride) shipColor.service = lightServiceOverride;
        const shipCell = Math.max(7, 11 / zoom);
        const seenShip = new Set();
        const shipScale = zoom >= 2 ? 1.0 : zoom >= 1.2 ? 0.85 : 0.7;
        const rendered = [];
        const sState = shipStateRef.current;
        const seenShipIds = new Set();
        for (const s of data.ships) {
          if (!s.mmsi) continue;
          seenShipIds.add(s.mmsi);
          // Declared sog (knots) + cog (deg) → °/sec velocity vector.
          // A ship at 20 kn = 37 km/h = 0.33°/h lat ≈ 9.3e-5 °/s.
          const sog = typeof s.sog === 'number' ? s.sog : 0;
          const cogRad = ((typeof s.cog === 'number' ? s.cog : 0)) * Math.PI / 180;
          const kmPerSec = sog * 1.852 / 3600;
          const latRad = s.lat * Math.PI / 180;
          const velLat = (kmPerSec * Math.cos(cogRad)) / 111;
          const velLon = (kmPerSec * Math.sin(cogRad)) / (111 * Math.max(0.1, Math.cos(latRad)));

          let st = sState.get(s.mmsi);
          if (!st) {
            st = { aLat:s.lat, aLon:s.lon, aT:tickNow, vLat:velLat, vLon:velLon,
                   dLat:s.lat, dLon:s.lon, dHdg: (s.heading != null && s.heading < 360) ? s.heading : (s.cog || 0),
                   lastKey: s.lat + ',' + s.lon };
            sState.set(s.mmsi, st);
          }
          advanceEased(st, s.lat, s.lon, tickNow, velLat, velLon, 0.20);
          // Heading: reported `heading` preferred (if valid), else cog. Ease
          // via shortest-angular-path so a 359°→1° turn goes the short way.
          const targetHdg = (s.heading != null && s.heading < 360) ? s.heading : (s.cog != null ? s.cog : st.dHdg);
          let dh = targetHdg - st.dHdg;
          while (dh > 180) dh -= 360; while (dh < -180) dh += 360;
          st.dHdg += dh * 0.12;

          if (!visibleOn(projection, st.dLon, st.dLat)) continue;
          const pt = projection([st.dLon, st.dLat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.floor(px / shipCell) << 16) | (Math.floor(py / shipCell) & 0xffff);
          if (seenShip.has(k)) continue;
          seenShip.add(k);
          // Trail uses eased position so the tail stays attached to the hull.
          pushTrail(shipHistRef.current, s.mmsi, st.dLon, st.dLat);
          rendered.push({ s, px, py, hdg: st.dHdg });
        }
        // Prune stale ship state.
        for (const id of sState.keys()) {
          if (!seenShipIds.has(id)) sState.delete(id);
        }
        // Trail colour matches the vessel category — the tail stays tonally
        // consistent with the hull icon, so the motion reads at a glance.
        for (const { s } of rendered) {
          const col = shipColor[s.category] || shipColor.other;
          // Convert hex `#rrggbb` → `rgba(r,g,b,0)` placeholder for the helper.
          let base = col;
          if (col.startsWith('#')) {
            const r = parseInt(col.slice(1,3),16), g=parseInt(col.slice(3,5),16), b=parseInt(col.slice(5,7),16);
            base = `rgba(${r},${g},${b},0)`;
          }
          // Server-seeded track preferred; falls back to client accumulation.
          const hist = (s.track && s.track.length >= 2) ? s.track : shipHistRef.current.get(s.mmsi);
          drawTrail(hist, base);
        }
        for (const { s, px, py, hdg } of rendered) {
          const col = shipColor[s.category] || shipColor.other;
          iconShip(octx, px, py, hdg, shipScale, col, shipStroke);
          pushHit(px, py, Math.max(5, shipCell * 0.45), 'ship', s);
        }
      }

      // Satellites — render all (GEO + LEO/MEO) as individual icons. The old
      // "GEO belt as arc annotation" was removed at user request. GEO sats
      // still render, just as regular sat icons like their lower-orbit kin.
      if (layers.sats && data.sats) {
        const otherSats = data.sats;
        const satState = satStateRef.current;
        const seenSatIds = new Set();

        // Smooth positions FIRST using propagator-derived velLat/velLon,
        // then project. The propagator runs every 2 s globally; without
        // smoothing the icons would teleport ~14 km between updates.
        const sPts = [];
        for (const s of otherSats) {
          const id = s.norad || s.name;
          if (!id) continue;
          seenSatIds.add(id);
          let st = satState.get(id);
          if (!st) {
            st = { aLat:s.lat, aLon:s.lon, aT:tickNow, vLat: s.velLat || 0, vLon: s.velLon || 0,
                   dLat:s.lat, dLon:s.lon, lastKey: s.lat + ',' + s.lon };
            satState.set(id, st);
          }
          // Declared velocity from satellite.js — stable predictions.
          advanceEased(st, s.lat, s.lon, tickNow, s.velLat, s.velLon, 0.28);
          const pt = projectAtAltitude(projection, st.dLon, st.dLat, s.alt || 0);
          if (!pt) continue;
          sPts.push({ px: pt[0], py: pt[1], s, dLon: st.dLon, dLat: st.dLat });
        }
        // Prune stale state.
        for (const id of satState.keys()) {
          if (!seenSatIds.has(id)) satState.delete(id);
        }
        const lod = classifyLOD(sPts, Math.max(14, 24/zoom));
        const satCol = isDark ? 'rgba(217,70,239,0.9)' : 'rgba(168,85,247,0.95)';
        const satDim = isDark ? 'rgba(217,70,239,0.55)' : 'rgba(168,85,247,0.65)';
        // Satellite trails — full-mode sats only, to keep orbit arcs crisp
        // without trailing every dim dot. Altitude-aware so the polyline sits
        // at orbit height like the icon itself.
        for (let i = 0; i < sPts.length; i++) {
          const { s, dLon, dLat } = sPts[i];
          if (lod[i].mode !== 'full') continue;
          const id = s.norad || s.name;
          // Trail uses eased position so the orbit arc stays attached
          // to the moving icon instead of sampling the 2 s snapshots.
          pushTrail(satHistRef.current, id, dLon, dLat);
          drawTrail(satHistRef.current.get(id), 'rgba(217,70,239,0)', s.alt || 0);
        }
        for (let i = 0; i < sPts.length; i++) {
          const { px, py, s } = sPts[i];
          const { mode } = lod[i];
          if (mode === 'full') {
            iconSat(octx, px, py, 7, satCol);
            pushHit(px, py, 6, 'sat', s);
          } else if (mode === 'compact') {
            iconSat(octx, px, py, 4, satCol);
            pushHit(px, py, 5, 'sat', s);
          } else {
            iconSat(octx, px, py, 2.5, satDim);
            pushHit(px, py, 4, 'sat', s);
          }
        }
      }

      // Tsunamis — wave glyph (rare, no LOD needed)
      if (layers.tsunamis && data.tsunamis) {
        for (const t of data.tsunamis) {
          if (!visibleOn(projection, t.lon, t.lat)) continue;
          const pt = projection([t.lon, t.lat]); if (!pt) continue;
          iconTsunami(octx, pt[0], pt[1], 12, '#22d3ee');
          pushHit(pt[0], pt[1], 9, 'tsunami', t);
        }
      }

      // ISS — silhouette + pulse. The wheretheiss.at feed gives position
      // at ~1 Hz with scalar velocity (km/h) but no heading, so we infer
      // both from position delta via advanceEased (null declared vel).
      if (layers.iss && data.iss) {
        let st = issStateRef.current;
        if (!st) {
          st = { aLat:data.iss.lat, aLon:data.iss.lon, aT:tickNow,
                 vLat:0, vLon:0, dLat:data.iss.lat, dLon:data.iss.lon,
                 lastKey: data.iss.lat + ',' + data.iss.lon };
          issStateRef.current = st;
        }
        advanceEased(st, data.iss.lat, data.iss.lon, tickNow, null, null, 0.28);

        const issHist = issHistRef.current;
        const last = issHist[issHist.length - 1];
        if (!last || Math.abs(last.lon - st.dLon) >= TRAIL_MIN_DLL || Math.abs(last.lat - st.dLat) >= TRAIL_MIN_DLL) {
          issHist.push({ lon: st.dLon, lat: st.dLat, t: nowMs });
          if (issHist.length > TRAIL_MAX) issHist.shift();
        }
        if (visibleOn(projection, st.dLon, st.dLat)) {
          const pt = projection([st.dLon, st.dLat]);
          if (pt) {
            drawTrail(issHist, 'rgba(244,63,94,0)');
            const pulse = 0.5 + 0.5*Math.sin(now/400);
            octx.beginPath(); octx.arc(pt[0], pt[1], 11 + pulse*3, 0, Math.PI*2);
            octx.strokeStyle = `rgba(244,63,94,${0.4 + pulse*0.3})`;
            octx.lineWidth = 1; octx.stroke();
            iconISS(octx, pt[0], pt[1], 16, '#f43f5e');
            octx.font = '500 10px Geist Mono, monospace';
            octx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,30,0.9)';
            octx.fillText('ISS', pt[0]+14, pt[1]+3);
            pushHit(pt[0], pt[1], 16, 'iss', data.iss);
          }
        }
      }

      // Focus reticle — prefer the live-tracked position (updated each
      // frame for flights/ships/ISS) and fall back to the stored dblclick
      // coords for stationary targets like cities and quakes.
      // Flight route (great-circle from dep → arr). Drawn as a dashed line
      // so the live plane icon overlaid from the main flight loop reads as
      // "here on the planned path" rather than competing with a solid
      // track. Segments are discretised via d3.geoInterpolate so the line
      // curves correctly on the orthographic projection; segments straddling
      // the horizon are elided by the visibleOn check.
      if (focusTarget?.trackLayer === 'flight' && flightRouteRef.current?.dep && flightRouteRef.current?.arr) {
        const route = flightRouteRef.current;
        const depLL = [route.dep.lon, route.dep.lat];
        const arrLL = [route.arr.lon, route.arr.lat];
        const interp = d3.geoInterpolate(depLL, arrLL);
        const segments = 120;
        octx.save();
        octx.setLineDash([5, 4]);
        octx.strokeStyle = 'rgba(125, 211, 252, 0.55)';
        octx.lineWidth = 1.3;
        let pen = null;   // last screen point we drew to ('pen up' when off-globe)
        for (let i = 0; i <= segments; i++) {
          const t = i / segments;
          const [lon, lat] = interp(t);
          if (!visibleOn(projection, lon, lat)) { pen = null; continue; }
          const pt = projection([lon, lat]);
          if (!pt) { pen = null; continue; }
          if (pen) {
            octx.beginPath();
            octx.moveTo(pen[0], pen[1]);
            octx.lineTo(pt[0], pt[1]);
            octx.stroke();
          }
          pen = pt;
        }
        octx.setLineDash([]);
        // Airport markers: small filled dot + IATA/ICAO label offset above.
        octx.font = 'bold 10px "Geist Mono", ui-monospace, monospace';
        octx.textAlign = 'center';
        octx.textBaseline = 'alphabetic';
        for (const a of [route.dep, route.arr]) {
          if (!visibleOn(projection, a.lon, a.lat)) continue;
          const pt = projection([a.lon, a.lat]);
          if (!pt) continue;
          octx.fillStyle = 'rgba(125, 211, 252, 0.95)';
          octx.beginPath();
          octx.arc(pt[0], pt[1], 3, 0, Math.PI * 2);
          octx.fill();
          // Label background for readability
          const label = a.iata || a.icao;
          const tw = octx.measureText(label).width;
          octx.fillStyle = isDark ? 'rgba(10,10,15,0.7)' : 'rgba(255,255,255,0.8)';
          octx.fillRect(pt[0] - tw/2 - 3, pt[1] - 18, tw + 6, 13);
          octx.fillStyle = 'rgba(125, 211, 252, 1)';
          octx.fillText(label, pt[0], pt[1] - 8);
        }
        octx.restore();
      }

      // Ship destination line — when a ship is focused and its declared
      // AIS destination resolves to a known port in src/ports.jsx, draw
      // a faint great-circle from the ship's live position to the port.
      // Uses d3.geoInterpolate for proper curvature on the orthographic
      // projection.
      if (focusTarget?.trackLayer === 'ship' && focusTarget.trackId
          && data?.ships && typeof window.resolvePort === 'function') {
        const ship = data.ships.find(s => s.mmsi === focusTarget.trackId);
        if (ship && ship.dest && typeof ship.lon === 'number' && typeof ship.lat === 'number') {
          const port = window.resolvePort(ship.dest);
          if (port) {
            const from = [ship.lon, ship.lat];
            const to   = [port.lon, port.lat];
            const interp = d3.geoInterpolate(from, to);
            octx.save();
            octx.setLineDash([3, 4]);
            octx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
            octx.lineWidth = 1.1;
            let pen = null;
            const segs = 80;
            for (let i = 0; i <= segs; i++) {
              const [lon, lat] = interp(i / segs);
              if (!visibleOn(projection, lon, lat)) { pen = null; continue; }
              const pt = projection([lon, lat]);
              if (!pt) { pen = null; continue; }
              if (pen) {
                octx.beginPath();
                octx.moveTo(pen[0], pen[1]);
                octx.lineTo(pt[0], pt[1]);
                octx.stroke();
              }
              pen = pt;
            }
            octx.setLineDash([]);
            // Port marker with label
            if (visibleOn(projection, port.lon, port.lat)) {
              const pp = projection([port.lon, port.lat]);
              if (pp) {
                octx.fillStyle = 'rgba(125, 211, 252, 0.95)';
                octx.beginPath();
                octx.arc(pp[0], pp[1], 3, 0, Math.PI * 2);
                octx.fill();
                octx.font = 'bold 10px "Geist Mono", ui-monospace, monospace';
                octx.textAlign = 'center';
                const tw = octx.measureText(port.name).width;
                octx.fillStyle = isDark ? 'rgba(10,10,15,0.7)' : 'rgba(255,255,255,0.8)';
                octx.fillRect(pp[0] - tw/2 - 3, pp[1] - 18, tw + 6, 13);
                octx.fillStyle = 'rgba(125, 211, 252, 1)';
                octx.fillText(port.name, pp[0], pp[1] - 8);
              }
            }
            octx.restore();
          }
        }
      }

      // Ship historical track — up to 30 days of accumulated positions for
      // the currently-focused ship, drawn as a polyline with age-based
      // alpha fade (older segments more transparent). We draw segments
      // only where BOTH endpoints are visible on the current hemisphere;
      // a great-circle split across the horizon would need densification
      // to render cleanly, and the ~3-minute sample rate is dense enough
      // that straight chords between visible samples read fine.
      if (focusTarget?.trackLayer === 'ship' && shipHistoryRef.current?.positions?.length >= 2) {
        const pos = shipHistoryRef.current.positions;
        const now = Date.now();
        const maxAge = 30 * 24 * 3600 * 1000;
        octx.lineWidth = 1.3;
        for (let i = 0; i < pos.length - 1; i++) {
          const a = pos[i], b = pos[i + 1];
          if (!visibleOn(projection, a.lon, a.lat)) continue;
          if (!visibleOn(projection, b.lon, b.lat)) continue;
          const pa = projection([a.lon, a.lat]);
          const pb = projection([b.lon, b.lat]);
          if (!pa || !pb) continue;
          // Age the FROM point: the older the starting position, the more
          // faded the outgoing segment.
          const age = (now - a.t) / maxAge;
          const alpha = Math.max(0.12, 0.85 * (1 - age));
          octx.strokeStyle = `rgba(34, 211, 238, ${alpha.toFixed(3)})`;
          octx.beginPath();
          octx.moveTo(pa[0], pa[1]);
          octx.lineTo(pb[0], pb[1]);
          octx.stroke();
        }
        // Small dots at each recorded position so you can see where AIS
        // pings actually happened (vs. the interpolated line segments).
        octx.fillStyle = 'rgba(34, 211, 238, 0.75)';
        for (const p of pos) {
          if (!visibleOn(projection, p.lon, p.lat)) continue;
          const pt = projection([p.lon, p.lat]);
          if (!pt) continue;
          octx.beginPath();
          octx.arc(pt[0], pt[1], 1, 0, Math.PI * 2);
          octx.fill();
        }
      }

      const reticleCoords = focusLiveCoordsRef.current || focusTarget?.coords;
      if (reticleCoords && visibleOn(projection, reticleCoords[0], reticleCoords[1])) {
        const pt = projection(reticleCoords);
        if (pt) {
          // Minimal crosshair: four short cardinal ticks with an empty
          // centre so the tracked marker is never obscured. The inner
          // offset matches the largest marker size (~6 px) so small
          // targets (quakes, events) still sit cleanly inside the gap.
          octx.strokeStyle = '#f43f5e';
          octx.lineWidth   = 1.2;
          const inner = 8, outer = 14;
          octx.beginPath();
          octx.moveTo(pt[0] - outer, pt[1]); octx.lineTo(pt[0] - inner, pt[1]);
          octx.moveTo(pt[0] + inner, pt[1]); octx.lineTo(pt[0] + outer, pt[1]);
          octx.moveTo(pt[0], pt[1] - outer); octx.lineTo(pt[0], pt[1] - inner);
          octx.moveTo(pt[0], pt[1] + inner); octx.lineTo(pt[0], pt[1] + outer);
          octx.stroke();
        }
      }

      // Hover
      if (hoverRef.current !== hover) setHover(hoverRef.current);

      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme, data, projection, layers, nowCursor, animationIntensity, focusTarget, hover]);

  return (
    <div ref={wrapRef} className="grabbable select-none" style={{ position:'relative', width, height, touchAction:'none' }}>
      <canvas ref={baseRef} style={{ position:'absolute', inset:0, pointerEvents:'none' }} />
      <canvas ref={windRef} style={{ position:'absolute', inset:0, pointerEvents:'none' }} />
      <canvas ref={overRef} style={{ position:'absolute', inset:0, pointerEvents:'none' }} />
      {hover && (
        <div className="pointer-events-none absolute glass rounded-xl px-2.5 py-1.5 text-[11px] font-mono"
             style={{ left: hover.sx+14, top: hover.sy+14 }}>
          {hover._layer === 'iss' && <span>ISS · ZARYA — {Math.round(hover.alt)} km</span>}
          {hover._layer === 'sat' && <span>{hover.name} — {Math.round(hover.alt)} km</span>}
          {hover._layer === 'flight' && <span>{hover.callsign || hover.reg} · FL{Math.round((hover.alt||0)/100)}</span>}
          {hover._layer === 'ship' && (() => {
            // Show a coloured dot + category label so the user can read the
            // hull colour's meaning in-context — the legend in Layers is
            // good for reference but nobody remembers it mid-scroll.
            const shipCategoryColor = {
              cargo:'#22d3ee', tanker:'#f59e0b', passenger:'#a78bfa',
              fishing:'#34d399', highspeed:'#f472b6', service:'#94a3b8',
              sail:'#60a5fa', other:'#94a3b8',
            };
            const cat = hover.category || 'other';
            const col = shipCategoryColor[cat] || shipCategoryColor.other;
            const label = cat[0].toUpperCase() + cat.slice(1);
            return <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: col }}/>
              <span>{label} · {hover.name || hover.mmsi} · {hover.sog != null ? Math.round(hover.sog) + ' kn' : 'underway'}</span>
            </span>;
          })()}
          {hover._layer === 'quake' && <span>M{hover.mag?.toFixed(1)} · {hover.place}</span>}
          {hover._layer === 'event' && <span>{hover.category} · {hover.title}</span>}
          {hover._layer === 'fire' && (
            <span>Active fire · {hover.bright != null ? `${hover.bright} K` : 'thermal hotspot'}{hover.frp != null ? ` · FRP ${hover.frp}` : ''}</span>
          )}
          {hover._layer === 'tsunami' && <span>Tsunami · {hover.location || hover.country} {hover.year || ''}</span>}
          {hover._layer === 'city' && <span>{hover.name}{hover.country ? ` · ${hover.country}` : ''}</span>}
          {hover._layer === 'cluster' && <span>{hover.count} {hover.layer}{hover.count>1?'s':''} — click to zoom</span>}
          {hover._layer !== 'cluster' && (() => {
            // Live feeds (flights, sats, iss): show "live"; time-stamped
            // observations (quakes, events, ships, tsunamis): show "X ago".
            const live = ['flight','sat','iss'].includes(hover._layer);
            const ts = hover.time;
            if (live) return <span className="ml-2 opacity-55">· live</span>;
            if (!ts) return null;
            const s = (Date.now() - ts) / 1000;
            const ago = s < 60 ? `${Math.floor(s)}s ago`
                      : s < 3600 ? `${Math.floor(s/60)}m ago`
                      : s < 86400 ? `${Math.floor(s/3600)}h ago`
                      : `${Math.floor(s/86400)}d ago`;
            return <span className="ml-2 opacity-55">· {ago}</span>;
          })()}
        </div>
      )}
    </div>
  );
}

window.Globe = Globe;
