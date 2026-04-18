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
  theme, animationIntensity = 0.7, layers,
}) {
  const wrapRef = useRef(null);
  const baseRef = useRef(null);   // land (cached, redraws on rotation)
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

  // Load topo once
  useEffect(() => {
    (async () => {
      try {
        const t = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
        landRef.current = topojson.feature(t, t.objects.land);
        const graticule = d3.geoGraticule().step([15,15]);
        gridRef.current = graticule();
        dirtyBase.current = true;
      } catch (e) { console.warn('topojson load fail', e); }
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
    // Velocity tracking for inertia
    let vx = 0, vy = 0, lastMove = 0, lastMx = 0, lastMy = 0;
    let dragging = false;

    const drag = d3.drag()
      .on('start', (ev) => {
        dragging = true;
        lastMove = performance.now();
        lastMx = ev.x; lastMy = ev.y;
        vx = 0; vy = 0;
        // snap targets to current so animation doesn't fight
        targetRotRef.current = [...rotRef.current];
      })
      .on('drag', (ev) => {
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

    // Wheel — zoom with accumulated target, smoothed in raf
    const onWheel = (e) => {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = Math.pow(1.0015, delta);
      const min = Math.min(width, height) / 3.5;
      const max = Math.min(width, height) * 12;
      targetScaleRef.current = Math.max(min, Math.min(max, targetScaleRef.current * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Double click — zoom in to point
    const onDbl = (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      projection.rotate(rotRef.current).scale(scaleRef.current);
      const inv = projection.invert([mx, my]);
      if (!inv) return;
      targetRotRef.current = [-inv[0], -inv[1], 0];
      targetScaleRef.current = Math.min(scaleRef.current * 2.5, Math.min(width, height) * 12);
    };
    el.addEventListener('dblclick', onDbl);

    // Click — hit test markers
    const onClick = (e) => {
      // If user was dragging, skip
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      projection.rotate(rotRef.current).scale(scaleRef.current);
      const pick = hitTest(mx, my);
      if (!pick) return;
      if (pick._layer === 'cluster') {
        // Zoom into cluster center
        targetRotRef.current = [-pick.lon, -pick.lat, 0];
        targetScaleRef.current = Math.min(scaleRef.current * 2.2, Math.min(width, height) * 12);
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

    // Touch pinch zoom
    let pinchStartDist = 0, pinchStartScale = scaleRef.current;
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartScale = scaleRef.current;
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.hypot(dx, dy);
        const min = Math.min(width, height) / 3.5;
        const max = Math.min(width, height) * 12;
        targetScaleRef.current = Math.max(min, Math.min(max, pinchStartScale * (d/pinchStartDist)));
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

  function hitTest(mx, my) {
    // Iterate in reverse draw order (last drawn = topmost)
    const regions = hitRegionsRef.current;
    let best = null, bestD = Infinity;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      const dx = r.x - mx, dy = r.y - my;
      const d2 = dx*dx + dy*dy;
      const hitR = r.radius || 8;
      if (d2 < hitR*hitR && d2 < bestD) { bestD = d2; best = r; }
    }
    return best?.payload || null;
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
    const base = baseRef.current, over = overRef.current;
    if (!base || !over) return;
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    base.width = width*dpr; base.height = height*dpr;
    over.width = width*dpr; over.height = height*dpr;
    base.style.width = width+'px'; base.style.height = height+'px';
    over.style.width = width+'px'; over.style.height = height+'px';
    const bctx = base.getContext('2d'); bctx.scale(dpr, dpr);
    const octx = over.getContext('2d'); octx.scale(dpr, dpr);
    dirtyBase.current = true;

    const tick = () => {
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

      // Draw base (only when dirty)
      if (dirtyBase.current) {
        bctx.clearRect(0,0,width,height);
        const path = d3.geoPath(projection, bctx);
        const isDark = theme === 'dark';
        // Ocean disk
        bctx.beginPath(); path({type:'Sphere'});
        bctx.fillStyle = isDark ? 'rgba(20,25,40,0.35)' : 'rgba(240,245,255,0.55)';
        bctx.fill();
        // Graticule
        if (gridRef.current) {
          bctx.beginPath(); path(gridRef.current);
          bctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.08)';
          bctx.lineWidth = 0.5; bctx.stroke();
        }
        // Land — wireframe
        if (landRef.current) {
          bctx.beginPath(); path(landRef.current);
          bctx.strokeStyle = isDark ? 'rgba(244,63,94,0.55)' : 'rgba(244,63,94,0.75)';
          bctx.lineWidth = 0.9; bctx.stroke();
        }
        // Sphere edge
        bctx.beginPath(); path({type:'Sphere'});
        bctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)';
        bctx.lineWidth = 1; bctx.stroke();
        dirtyBase.current = false;
      }

      // Overlay (dynamic)
      octx.clearRect(0,0,width,height);
      hitRegionsRef.current = [];
      const pushHit = (x, y, radius, layer, payload) => {
        hitRegionsRef.current.push({ x, y, radius, payload: { ...payload, _layer: layer } });
      };
      const now = performance.now();
      const isDark = theme === 'dark';

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

      // Earthquakes — M2.5+ only (filtered upstream). Render scaled by magnitude:
      //   M5+   → full pulsing crosshair with label
      //   M4-5  → full crosshair, no label
      //   M3-4  → compact crosshair
      //   M<3   → tiny dim dot (background context)
      // No scary cluster halos.
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
            // Significant — pulse + epicenter + label
            const phase = ((now/1000) + (q.id?.charCodeAt(0) || 0))%1.8/1.8;
            const sz = 16 + (mag - 5) * 2.2;
            octx.beginPath();
            octx.arc(px, py, sz*0.7 + phase*18*animationIntensity, 0, Math.PI*2);
            octx.strokeStyle = `rgba(244,63,94,${0.5*(1-phase)*(1-age*0.6)})`;
            octx.lineWidth = 1.2; octx.stroke();
            iconQuake(octx, px, py, sz, col, isDark);
            // Magnitude label
            octx.font = '600 11px Geist Mono, monospace';
            octx.fillStyle = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,30,0.92)';
            octx.fillText(`M${mag.toFixed(1)}`, px + sz*0.8 + 3, py + 4);
            pushHit(px, py, sz, 'quake', q);
          } else if (mag >= 4) {
            iconQuake(octx, px, py, 13, col, isDark);
            pushHit(px, py, 11, 'quake', q);
          } else if (mag >= 3) {
            iconQuake(octx, px, py, 10, col, isDark);
            pushHit(px, py, 9, 'quake', q);
          } else {
            // M2.5-3 — still clearly an epicenter
            iconQuake(octx, px, py, 8, isDark ? 'rgba(251,146,60,0.7)' : 'rgba(217,119,6,0.75)', isDark);
            pushHit(px, py, 7, 'quake', q);
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

      // Flights — LOD with density heatmap for saturated regions.
      //  1/cell           → full plane icon
      //  2-8/cell         → small plane icons (cap drawn at ~3 to avoid blob)
      //  >8/cell          → a single translucent density tile (no per-plane dots)
      if (layers.flights && data.flights) {
        const fPts = [];
        for (const f of data.flights) {
          if (!visibleOn(projection, f.lon, f.lat)) continue;
          const pt = projection([f.lon, f.lat]); if (!pt) continue;
          fPts.push({ px: pt[0], py: pt[1], f });
        }
        const cellPx = Math.max(22, 34/zoom);
        // Bucket into cells
        const cells = new Map();
        for (const p of fPts) {
          const kx = Math.floor(p.px/cellPx), ky = Math.floor(p.py/cellPx);
          const key = kx+':'+ky;
          let b = cells.get(key);
          if (!b) { b = { kx, ky, items: [], sx:0, sy:0 }; cells.set(key, b); }
          b.items.push(p);
          b.sx += p.px; b.sy += p.py;
        }
        const planeFill   = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,30,0.88)';
        const planeStroke = isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
        // Clean aviation-tracker plane: long fuselage, swept wings, small tail.
        // Designed at 10px nose-to-tail so "scale=1" means ~10px plane.
        // Oriented nose-up (towards -y) so heading maps directly to rotation.
        const drawPlane = (cx, cy, hdg, scale) => {
          octx.save();
          octx.translate(cx, cy);
          octx.rotate(((hdg||0)) * Math.PI/180);
          octx.scale(scale, scale);
          octx.beginPath();
          // Nose
          octx.moveTo(0, -5);
          // Upper right fuselage → right wing tip
          octx.lineTo(0.6, -1.5);
          octx.lineTo(5.5, 1.2);
          octx.lineTo(5.5, 1.8);
          octx.lineTo(0.6, 0.8);
          // Fuselage down to right tail
          octx.lineTo(0.6, 3.2);
          octx.lineTo(2.2, 4.2);
          octx.lineTo(2.2, 4.6);
          octx.lineTo(0, 4.1);
          // Mirror left side
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
        for (const cell of cells.values()) {
          const n = cell.items.length;
          const cx = cell.sx / n, cy = cell.sy / n;
          if (n === 1) {
            const { px, py, f } = cell.items[0];
            drawPlane(px, py, f.hdg, 1);
            pushHit(px, py, 10, 'flight', f);
          } else if (n <= 8) {
            // Draw up to 3 small planes to hint there are multiple aircraft
            const sample = cell.items.slice(0, 3);
            for (const { px, py, f } of sample) {
              drawPlane(px, py, f.hdg, 0.55);
              pushHit(px, py, 6, 'flight', f);
            }
            // Remainder still hit-testable at cell center
            if (cell.items.length > sample.length) {
              pushHit(cx, cy, cellPx*0.5, 'cluster', {
                kind:'cluster', layer:'flight',
                items: cell.items.map(x=>x.f),
                count: n, lon: cell.items[0].f.lon, lat: cell.items[0].f.lat,
              });
            }
          } else {
            // Density tile — translucent rounded square, opacity scales with density
            const alpha = Math.min(0.38, 0.08 + Math.log10(n) * 0.12);
            const size = cellPx * 0.85;
            const r = 3;
            const x = cx - size/2, y = cy - size/2;
            octx.beginPath();
            octx.moveTo(x+r, y);
            octx.lineTo(x+size-r, y); octx.quadraticCurveTo(x+size, y, x+size, y+r);
            octx.lineTo(x+size, y+size-r); octx.quadraticCurveTo(x+size, y+size, x+size-r, y+size);
            octx.lineTo(x+r, y+size); octx.quadraticCurveTo(x, y+size, x, y+size-r);
            octx.lineTo(x, y+r); octx.quadraticCurveTo(x, y, x+r, y);
            octx.closePath();
            octx.fillStyle = `rgba(125,211,252,${alpha})`;
            octx.fill();
            // Faint outline to ground it
            octx.strokeStyle = `rgba(125,211,252,${Math.min(0.5, alpha + 0.15)})`;
            octx.lineWidth = 0.6;
            octx.stroke();
            // One small plane silhouette in the center for type identification
            const avgHdg = cell.items.reduce((s,p)=>s + (p.f.hdg||0), 0) / n;
            drawPlane(cx, cy, avgHdg, 0.6);
            pushHit(cx, cy, size/2, 'cluster', {
              kind:'cluster', layer:'flight',
              items: cell.items.map(x=>x.f),
              count: n, lon: cell.items[0].f.lon, lat: cell.items[0].f.lat,
            });
          }
        }
      }

      // Ships — AIS feed. Category → color. Elongated hull icon points to heading.
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
        const shipStroke = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)';
        // LOD: bin into ~14px cells, draw up to 2 icons per cell, density tile beyond
        const cell = 14;
        const bins = new Map();
        for (const s of data.ships) {
          if (!visibleOn(projection, s.lon, s.lat)) continue;
          const pt = projection([s.lon, s.lat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.round(px/cell)<<12) ^ Math.round(py/cell);
          let b = bins.get(k);
          if (!b) { b = { items: [], sx:0, sy:0 }; bins.set(k, b); }
          b.items.push({ px, py, s });
          b.sx += px; b.sy += py;
        }
        for (const b of bins.values()) {
          const n = b.items.length;
          if (n === 1) {
            const { px, py, s } = b.items[0];
            const col = shipColor[s.category] || shipColor.other;
            const hdg = (s.heading != null && s.heading < 360) ? s.heading : (s.cog || 0);
            iconShip(octx, px, py, hdg, 1, col, shipStroke);
            pushHit(px, py, 7, 'ship', s);
          } else if (n <= 6) {
            for (const { px, py, s } of b.items.slice(0, 3)) {
              const col = shipColor[s.category] || shipColor.other;
              const hdg = (s.heading != null && s.heading < 360) ? s.heading : (s.cog || 0);
              iconShip(octx, px, py, hdg, 0.7, col, shipStroke);
              pushHit(px, py, 5, 'ship', s);
            }
          } else {
            // Density tile for crowded shipping lanes
            const cx = b.sx/n, cy = b.sy/n;
            octx.fillStyle = isDark ? 'rgba(34,211,238,0.22)' : 'rgba(14,116,144,0.22)';
            octx.fillRect(cx-cell/2, cy-cell/2, cell, cell);
            octx.strokeStyle = isDark ? 'rgba(34,211,238,0.6)' : 'rgba(14,116,144,0.6)';
            octx.lineWidth = 0.6;
            octx.strokeRect(cx-cell/2+0.5, cy-cell/2+0.5, cell-1, cell-1);
            // count label
            octx.font = '600 9px Geist Mono, monospace';
            octx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,30,0.85)';
            octx.fillText(String(n), cx + cell/2 + 2, cy + 3);
            pushHit(cx, cy, cell/2, 'cluster', {
              kind:'cluster', layer:'ship',
              items: b.items.map(x=>x.s),
              count: n, lon: b.items[0].s.lon, lat: b.items[0].s.lat,
            });
          }
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
            // Draw belt as a thin arc using sampled longitudes at lat=0, alt=~35786
            const sample = 180;
            const belt = [];
            for (let i = 0; i <= sample; i++) {
              const lon = -180 + (360 * i / sample);
              const pt = projectAtAltitude(projection, lon, 0, 35786);
              if (pt && visibleOn(projection, lon, 0)) belt.push(pt);
              else belt.push(null);
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
        if (visibleOn(projection, data.iss.lon, data.iss.lat)) {
          const pt = projection([data.iss.lon, data.iss.lat]);
          if (pt) {
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

      // Wiki flashes
      if (layers.wiki && data.wikiFlashes) {
        for (const w of data.wikiFlashes) {
          const pt = projection([w.lon, w.lat]); if (!pt) continue;
          if (!visibleOn(projection, w.lon, w.lat)) continue;
          const age = Math.max(0, (now - w.t)/1400);
          if (age > 1) continue;
          octx.beginPath(); octx.arc(pt[0], pt[1], Math.max(0, 2 + age*14), 0, Math.PI*2);
          octx.strokeStyle = `rgba(96,165,250,${0.7*(1-age)})`; octx.lineWidth = 1;
          octx.stroke();
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
      <canvas ref={overRef} style={{ position:'absolute', inset:0, pointerEvents:'none' }} />
      {hover && (
        <div className="pointer-events-none absolute glass rounded-xl px-2.5 py-1.5 text-[11px] font-mono"
             style={{ left: hover.sx+14, top: hover.sy+14 }}>
          {hover._layer === 'iss' && <span>ISS · ZARYA — {Math.round(hover.alt)} km</span>}
          {hover._layer === 'sat' && <span>{hover.name} — {Math.round(hover.alt)} km</span>}
          {hover._layer === 'flight' && <span>{hover.callsign || hover.reg} · FL{Math.round((hover.alt||0)/100)}</span>}
          {hover._layer === 'ship' && <span>{hover.name || hover.mmsi} · {hover.sog != null ? Math.round(hover.sog) + ' kn' : 'underway'}</span>}
          {hover._layer === 'quake' && <span>M{hover.mag?.toFixed(1)} · {hover.place}</span>}
          {hover._layer === 'event' && <span>{hover.category} · {hover.title}</span>}
          {hover._layer === 'tsunami' && <span>Tsunami · {hover.location || hover.country} {hover.year || ''}</span>}
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
