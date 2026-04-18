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
  width, height, data, nowCursor, onPickMarker, focusTarget,
  theme, animationIntensity = 0.7, layers, autoRotate = true,
  onInteract, zoomOutSignal = 0,
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
  // Base canvas redraw throttle. During idle auto-rotate we'd otherwise be
  // reparsing country / state / river / lake features 60×/sec; cap to ~30fps.
  const lastBaseRedrawMsRef = useRef(0);
  const countriesRef = useRef(null);        // internal country borders (mesh) — drawing only
  const countryFeaturesRef = useRef(null);  // NE admin_0 features — hit-test (has names)
  const statesRef = useRef(null);           // NE admin_1 state/province lines (zoom ≥ 2.5)
  const riversRef = useRef(null);           // Natural Earth rivers 50m
  const lakesRef = useRef(null);            // Natural Earth lakes 50m
  const citiesRef = useRef(null);           // Natural Earth populated places 50m

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
      .on('start', (ev) => {
        dragging = true;
        markInteraction();
        lastMove = performance.now();
        lastMx = ev.x; lastMy = ev.y;
        vx = 0; vy = 0;
        // snap targets to current so animation doesn't fight
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

    // Double click — zoom in to point
    const onDbl = (e) => {
      markInteraction();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
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

    // Touch pinch zoom — anchored at the midpoint between the two fingers so
    // the zoom feels like it's happening where the user is pinching, not at
    // the centre of the canvas.
    let pinchLastDist = 0;
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        markInteraction();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchLastDist = Math.hypot(dx, dy);
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        markInteraction();
        const rect = el.getBoundingClientRect();
        const x1 = e.touches[0].clientX, y1 = e.touches[0].clientY;
        const x2 = e.touches[1].clientX, y2 = e.touches[1].clientY;
        const dx = x1 - x2, dy = y1 - y2;
        const d = Math.hypot(dx, dy);
        if (pinchLastDist > 0) {
          const midX = (x1 + x2) / 2 - rect.left;
          const midY = (y1 + y2) / 2 - rect.top;
          zoomToward(midX, midY, d / pinchLastDist);
        }
        pinchLastDist = d;
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      sel.on('.drag', null);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('click', onClick);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [width, height, projection, onPickMarker]);

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
        if (tickNow - lastBaseRedrawMsRef.current > 33) {
          dirtyBase.current = true;
          lastBaseRedrawMsRef.current = tickNow;
        }
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

      // Draw base (only when dirty) — uses current zoom for LOD decisions below.
      if (dirtyBase.current) {
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
        for (const f of sorted) {
          if (!visibleOn(projection, f.lon, f.lat)) continue;
          const pt = projection([f.lon, f.lat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.floor(px / flightCell) << 16) | (Math.floor(py / flightCell) & 0xffff);
          if (seenFlight.has(k)) continue;
          seenFlight.add(k);
          // Record current position into this flight's trail.
          pushTrail(flightHistRef.current, f.id, f.lon, f.lat);
          rendered.push({ f, px, py });
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
        // Now the plane icons + hit regions.
        for (const { f, px, py } of rendered) {
          drawPlane(px, py, f.hdg, scale);
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
        for (const s of data.ships) {
          if (!visibleOn(projection, s.lon, s.lat)) continue;
          const pt = projection([s.lon, s.lat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.floor(px / shipCell) << 16) | (Math.floor(py / shipCell) & 0xffff);
          if (seenShip.has(k)) continue;
          seenShip.add(k);
          pushTrail(shipHistRef.current, s.mmsi, s.lon, s.lat);
          rendered.push({ s, px, py });
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
        for (const { s, px, py } of rendered) {
          const col = shipColor[s.category] || shipColor.other;
          const hdg = (s.heading != null && s.heading < 360) ? s.heading : (s.cog || 0);
          iconShip(octx, px, py, hdg, shipScale, col, shipStroke);
          pushHit(px, py, Math.max(5, shipCell * 0.45), 'ship', s);
        }
      }

      // Satellites — render as a swarm of dots; GEO belt drawn as single arc annotation
      if (layers.sats && data.sats) {
        // Split into GEO (high alt, near-equatorial) vs LEO/MEO
        const geoSats = [], otherSats = [];
        for (const s of data.sats) {
          if ((s.alt || 0) > 30000 && Math.abs(s.lat) < 12) geoSats.push(s);
          else otherSats.push(s);
        }

        // GEO belt: draw as a continuous translucent ring at altitude, with a single label.
        // Only break it into individual dots when heavily zoomed in.
        if (geoSats.length) {
          if (zoom < 2.2) {
            // Resample the 181-point belt only when rotation or scale has moved
            // enough that the cached geometry is visibly stale. Threshold of 0.25°
            // lon + 0.25° lat + 0.5px scale keeps the belt pixel-accurate during
            // slow auto-rotate while skipping ~180 projection calls per frame
            // during static viewing.
            const cache = geoBeltCacheRef.current;
            const rLon = rotRef.current[0], rLat = rotRef.current[1], sc = scaleRef.current;
            const stale = cache.belt === null
              || Math.abs((cache.rotLon ?? 0) - rLon) > 0.25
              || Math.abs((cache.rotLat ?? 0) - rLat) > 0.25
              || Math.abs((cache.scale ?? 0) - sc) > 0.5;
            let belt;
            if (stale) {
              const sample = 180;
              belt = [];
              for (let i = 0; i <= sample; i++) {
                const lon = -180 + (360 * i / sample);
                const pt = projectAtAltitude(projection, lon, 0, 35786);
                if (pt && visibleOn(projection, lon, 0)) belt.push(pt);
                else belt.push(null);
              }
              geoBeltCacheRef.current = { belt, rotLon: rLon, rotLat: rLat, scale: sc };
            } else {
              belt = cache.belt;
            }
            octx.beginPath();
            let started = false;
            for (const p of belt) {
              if (!p) { started = false; continue; }
              if (!started) { octx.moveTo(p[0], p[1]); started = true; }
              else octx.lineTo(p[0], p[1]);
            }
            octx.strokeStyle = isDark ? 'rgba(217,70,239,0.28)' : 'rgba(217,70,239,0.35)';
            octx.lineWidth = 1;
            octx.setLineDash([2, 3]);
            octx.stroke();
            octx.setLineDash([]);

            // Small label near the visible right edge of the belt
            let labelPt = null;
            for (let i = belt.length - 1; i >= 0; i--) { if (belt[i]) { labelPt = belt[i]; break; } }
            if (labelPt) {
              octx.font = '500 9px Geist Mono, monospace';
              octx.fillStyle = isDark ? 'rgba(217,70,239,0.75)' : 'rgba(168,85,247,0.8)';
              octx.fillText(`GEO belt · ${geoSats.length}`, labelPt[0] + 6, labelPt[1] + 3);
            }
            // Hit area: thin strip along the belt — use midpoint for a single cluster hit
            const mid = belt[Math.floor(belt.length/2)];
            if (mid) pushHit(mid[0], mid[1], 6, 'geo-belt', { kind:'cluster', layer:'sat', items: geoSats, count: geoSats.length, lon: 0, lat: 0, isGeo: true });
          } else {
            // Zoomed in — GEO sats as small sat icons
            for (const s of geoSats) {
              const pt = projectAtAltitude(projection, s.lon, s.lat, s.alt || 0);
              if (!pt) continue;
              iconSat(octx, pt[0], pt[1], 6, 'rgba(217,70,239,0.9)');
              pushHit(pt[0], pt[1], 7, 'sat', s);
            }
          }
        }

        // Other sats (LEO/MEO): LOD — full sat icon when sparse, dot when dense.
        const sPts = [];
        for (const s of otherSats) {
          const pt = projectAtAltitude(projection, s.lon, s.lat, s.alt || 0);
          if (!pt) continue;
          sPts.push({ px: pt[0], py: pt[1], s });
        }
        const lod = classifyLOD(sPts, Math.max(14, 24/zoom));
        const satCol = isDark ? 'rgba(217,70,239,0.9)' : 'rgba(168,85,247,0.95)';
        const satDim = isDark ? 'rgba(217,70,239,0.55)' : 'rgba(168,85,247,0.65)';
        // Satellite trails — full-mode sats only, to keep orbit arcs crisp
        // without trailing every dim dot. Altitude-aware so the polyline sits
        // at orbit height like the icon itself.
        for (let i = 0; i < sPts.length; i++) {
          const { s } = sPts[i];
          if (lod[i].mode !== 'full') continue;
          const id = s.norad || s.name;
          pushTrail(satHistRef.current, id, s.lon, s.lat);
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

      // ISS — silhouette + pulse
      if (layers.iss && data.iss) {
        // Push history whether or not the ISS is currently visible so the
        // trail is ready the moment it rotates into view.
        const issHist = issHistRef.current;
        const last = issHist[issHist.length - 1];
        if (!last || Math.abs(last.lon - data.iss.lon) >= TRAIL_MIN_DLL || Math.abs(last.lat - data.iss.lat) >= TRAIL_MIN_DLL) {
          issHist.push({ lon: data.iss.lon, lat: data.iss.lat, t: nowMs });
          if (issHist.length > TRAIL_MAX) issHist.shift();
        }
        if (visibleOn(projection, data.iss.lon, data.iss.lat)) {
          const pt = projection([data.iss.lon, data.iss.lat]);
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

      // Focus reticle
      if (focusTarget?.coords && visibleOn(projection, focusTarget.coords[0], focusTarget.coords[1])) {
        const pt = projection(focusTarget.coords);
        if (pt) {
          const r = 34;
          octx.strokeStyle = '#f43f5e'; octx.lineWidth = 1.2;
          octx.beginPath(); octx.arc(pt[0], pt[1], r, 0, Math.PI*2); octx.stroke();
          const dash = (now/40) % 30;
          octx.save();
          octx.setLineDash([6,5]); octx.lineDashOffset = -dash;
          octx.beginPath(); octx.arc(pt[0], pt[1], r+6, 0, Math.PI*2); octx.stroke();
          octx.restore();
          octx.beginPath();
          octx.moveTo(pt[0]-r-12, pt[1]); octx.lineTo(pt[0]-r-4, pt[1]);
          octx.moveTo(pt[0]+r+4, pt[1]); octx.lineTo(pt[0]+r+12, pt[1]);
          octx.moveTo(pt[0], pt[1]-r-12); octx.lineTo(pt[0], pt[1]-r-4);
          octx.moveTo(pt[0], pt[1]+r+4); octx.lineTo(pt[0], pt[1]+r+12);
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
      <canvas ref={baseRef} style={{ position:'absolute', inset:0 }} />
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
