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

// Lightning bolt (⚡). Six-point zigzag drawn as a filled path — recognisable
// even at 6-8 px. `size` is the bolt's full height; width is ~0.6 × size.
// Caller is responsible for fillStyle/strokeStyle; this just traces the path
// so the caller can stroke-then-fill for a dark halo against bright skies
// (strike cores are nearly-white yellow on a mostly-black ocean, but a
// daytime terminator can push behind cities where contrast drops).
function iconBolt(ctx, cx, cy, size) {
  const h = size * 0.5;   // half-height
  const w = size * 0.3;   // half-width → total width 0.6 × size
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.4,  cy - h);          // top outer corner
  ctx.lineTo(cx - w,        cy + h * 0.15);   // slanted down-left to waist
  ctx.lineTo(cx - w * 0.2,  cy + h * 0.15);   // notch back right (inner waist)
  ctx.lineTo(cx - w * 0.4,  cy + h);          // tail tip (bottom-left)
  ctx.lineTo(cx + w,        cy - h * 0.15);   // slanted up-right (right edge)
  ctx.lineTo(cx + w * 0.2,  cy - h * 0.15);   // notch back left (inner top)
  ctx.closePath();
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

// ISO radiation trefoil — three 60° wedges at 120° intervals with a
// center dot. Used for nuclear reactors.
function iconRadiation(ctx, cx, cy, size, color) {
  const r = size * 0.55;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * (2 * Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a - Math.PI / 7, a + Math.PI / 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.1, r * 0.26), 0, Math.PI * 2);
  ctx.fill();
}

// ── Infrastructure sub-layer icons ────────────────────────────────
// Each draws a small iconic silhouette rather than a generic dot so
// the map reads as "kind of thing" not "anonymous point". Sized 6–10
// screen pixels, fill+stroke combination for clarity at small scales.

// Fab — a square die with 8 pins (2 per side). Reads as "packaged IC".
function iconFab(ctx, cx, cy, size, color) {
  const r = size * 0.42;
  ctx.fillStyle = color + 'bb';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
  ctx.beginPath();
  const pin = r * 0.45;
  for (const off of [-r * 0.45, r * 0.45]) {
    ctx.moveTo(cx - r, cy + off); ctx.lineTo(cx - r - pin, cy + off);
    ctx.moveTo(cx + r, cy + off); ctx.lineTo(cx + r + pin, cy + off);
    ctx.moveTo(cx + off, cy - r); ctx.lineTo(cx + off, cy - r - pin);
    ctx.moveTo(cx + off, cy + r); ctx.lineTo(cx + off, cy + r + pin);
  }
  ctx.stroke();
}

// Refinery — a vertical fractionation column with two stage lines and
// a small flare stack on top.
function iconRefinery(ctx, cx, cy, size, color) {
  const h = size * 1.1;
  const w = size * 0.55;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h * 0.15); ctx.lineTo(cx + w / 2, cy - h * 0.15);
  ctx.moveTo(cx - w / 2, cy + h * 0.15); ctx.lineTo(cx + w / 2, cy + h * 0.15);
  ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx, cy - h / 2 - size * 0.28);
  ctx.stroke();
}

// LNG terminal — a spherical cryogenic tank with an equator line and
// a small vent stub on top. Distinct from generic circles.
function iconLng(ctx, cx, cy, size, color) {
  const r = size * 0.5;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r - size * 0.22);
  ctx.stroke();
}

// Gas processing — cluster of three small spherical tanks with vent
// stubs. Reads as "industrial gas facility" not "single round thing".
function iconGasProcessing(ctx, cx, cy, size, color) {
  const r = size * 0.28;
  ctx.fillStyle = color + 'bb';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.7;
  for (const dx of [-r * 1.5, 0, r * 1.5]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + r * 0.1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  for (const dx of [-r * 1.5, 0, r * 1.5]) {
    ctx.moveTo(cx + dx, cy - r * 0.9); ctx.lineTo(cx + dx, cy - r * 1.5);
  }
  ctx.stroke();
}

// Dam — a trapezoidal wall (slightly tapered) with a stylized water
// ripple above it. Reads as "dam wall holding back water".
function iconDam(ctx, cx, cy, size, color) {
  const w = size * 1.15;
  const h = size * 0.45;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.42, cy - h / 2);
  ctx.lineTo(cx + w * 0.42, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Water ripple above the crown
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.42, cy - h / 2 - size * 0.18);
  ctx.quadraticCurveTo(cx - w * 0.15, cy - h / 2 - size * 0.38, cx, cy - h / 2 - size * 0.18);
  ctx.quadraticCurveTo(cx + w * 0.15, cy - h / 2 - size * 0.02, cx + w * 0.42, cy - h / 2 - size * 0.18);
  ctx.stroke();
}

// Smelter / mill — low factory building + tall chimney with a wisp
// of smoke. Reads as "heavy industrial" even at 6–7 px.
function iconSmelter(ctx, cx, cy, size, color) {
  const w = size * 1.2, h = size * 0.95;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  // Low building (left)
  const bw = w * 0.58, bh = h * 0.55;
  ctx.fillRect(cx - w / 2, cy + h / 2 - bh, bw, bh);
  ctx.strokeRect(cx - w / 2, cy + h / 2 - bh, bw, bh);
  // Tall chimney (right)
  const chW = w * 0.22, chH = h * 0.9;
  ctx.fillRect(cx + w / 2 - chW, cy + h / 2 - chH, chW, chH);
  ctx.strokeRect(cx + w / 2 - chW, cy + h / 2 - chH, chW, chH);
  // Smoke plume curl
  ctx.beginPath();
  ctx.moveTo(cx + w / 2 - chW / 2, cy + h / 2 - chH);
  ctx.quadraticCurveTo(cx + w / 2 + size * 0.15, cy + h / 2 - chH - size * 0.25, cx + w / 2 - chW / 4, cy + h / 2 - chH - size * 0.5);
  ctx.stroke();
}

// Mine — inverted triangle with a horizontal rim and faint inner lines,
// reading as "open pit / shaft opening".
function iconMine(ctx, cx, cy, size, color) {
  const w = size * 1.25, h = size * 1.0;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2);
  ctx.lineTo(cx, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Inner "pit" V
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.3, cy - h / 2);
  ctx.lineTo(cx, cy + h * 0.15);
  ctx.lineTo(cx + w * 0.3, cy - h / 2);
  ctx.stroke();
  ctx.restore();
}

// Cement plant — cylindrical silo with a rounded/conical top. Common
// cement-plant silhouette; distinct from refinery column (rectangular).
function iconCement(ctx, cx, cy, size, color) {
  const w = size * 0.75, h = size * 1.1;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy - h * 0.25);
  ctx.quadraticCurveTo(cx, cy - h / 2 - size * 0.1, cx + w / 2, cy - h * 0.25);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Banding line
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx + w / 2, cy);
  ctx.stroke();
}

// Military — shield silhouette with a small inner cross. Reads as
// "military installation" at 7–8 px, visually distinct from industrial
// icons and from city stars.
function iconMilitary(ctx, cx, cy, size, color) {
  const w = size * 0.9;
  const h = size * 1.05;
  ctx.fillStyle = color + 'aa';
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy + h * 0.1);
  ctx.quadraticCurveTo(cx + w / 3, cy + h / 2, cx, cy + h / 2);
  ctx.quadraticCurveTo(cx - w / 3, cy + h / 2, cx - w / 2, cy + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.2);
  ctx.lineTo(cx, cy + h * 0.15);
  ctx.moveTo(cx - w * 0.25, cy - h * 0.05);
  ctx.lineTo(cx + w * 0.25, cy - h * 0.05);
  ctx.stroke();
}

// Port — classic anchor silhouette (ring + shaft + cross bar + flukes).
function iconPort(ctx, cx, cy, size, color) {
  const r = size * 0.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.0;
  // Top ring
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.75, Math.max(1.1, r * 0.26), 0, Math.PI * 2);
  ctx.stroke();
  // Vertical shaft
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.49);
  ctx.lineTo(cx, cy + r * 0.85);
  ctx.stroke();
  // Cross bar
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.55, cy - r * 0.18);
  ctx.lineTo(cx + r * 0.55, cy - r * 0.18);
  ctx.stroke();
  // Lower arc (flukes)
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.2, r * 0.8, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
}

// City — 5-point star, universal cartographic convention for populated
// places. Inner/outer ratio 0.5 makes the star read as "fuller" (less
// spidery) at small sizes. fillStyle/strokeStyle are set once for all
// cities in the frame; this helper only builds the path + paints.
function iconCity(ctx, cx, cy, size) {
  const outer = size;
  const inner = size * 0.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Small power-plant glyph: circle outline + bolt inside. Cheap enough to
// draw thousands per frame for the WRI fleet layer.
function iconPlant(ctx, cx, cy, size, color) {
  const r = size * 0.48;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.20, cy - r * 0.55);
  ctx.lineTo(cx - r * 0.28, cy + r * 0.08);
  ctx.lineTo(cx - r * 0.02, cy + r * 0.08);
  ctx.lineTo(cx - r * 0.20, cy + r * 0.55);
  ctx.lineTo(cx + r * 0.28, cy - r * 0.08);
  ctx.lineTo(cx + r * 0.02, cy - r * 0.08);
  ctx.closePath();
  ctx.fill();
}

// News hotspot — filled core with a concentric pulse ring. Reads as a
// "ping" and distinguishes news dots from outages / plant dots.
function iconNews(ctx, cx, cy, size, color) {
  const r = size * 0.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.0, r * 0.32), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// Internet outage — filled core plus a broken signal-wave arc, so the
// glyph reads as "interrupted connectivity" rather than a plain dot.
function iconOutage(ctx, cx, cy, size, color) {
  const r = size * 0.48;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.3, r * 0.34), 0, Math.PI * 2);
  ctx.fill();
  // Two opposing broken arcs — gap on each side reads as signal interruption.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, -Math.PI * 0.35, Math.PI * 0.35);
  ctx.moveTo(cx - r * 0.78, cy);
  ctx.arc(cx, cy, r * 0.78, Math.PI - Math.PI * 0.35, Math.PI + Math.PI * 0.35);
  ctx.stroke();
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
  dcFilters,
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
  const hoverAppliedRef = useRef(null); // mirrors the last value pushed into React state so the tick-loop compare avoids tearing down the RAF on every mousemove
  const [hover, setHover] = useState(null);
  const landRef = useRef(null);      // active land feature (swapped by zoom band)
  const landLowRef  = useRef(null);  // 110m  ~100 KB  — globe / default view
  const landMidRef  = useRef(null);  // 50m   ~700 KB  — close-in view
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
  // Ocean currents — same data shape as wind (5° u/v grid in m/s) so the
  // same particle advection engine drives them. Separate pool + view
  // tracker so pan-smear detection doesn't share state with wind.
  const oceanGridRef = useRef(null);
  const oceanParticlesRef = useRef([]);
  const oceanViewRef = useRef(null);
  const OCEAN_PARTICLE_COUNT = 1400;
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
  // Previous frame's flight-cell ownership — cellKey → flight.id.
  // Powers hysteresis in the spatial-decimation render loop: a flight
  // that owned a cell last frame keeps it if it's still mapping to
  // that cell this frame, regardless of the altitude tiebreak. Without
  // this, a lower-altitude plane gets kicked out of its cell whenever
  // a higher-altitude neighbour briefly drifts across the grid line
  // into that cell — the classic "blinks in and out" flicker.
  const flightCellOwnerRef = useRef(new Map());
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
  // Latest-value refs for props that churn every tick (SSE snapshots,
  // time cursor, focus target). Reading these inside the frame loop
  // instead of closing over the prop values means we can keep them
  // OUT of the main useEffect's dep array — so the RAF / event
  // handler setup doesn't tear down and rebuild every time flights
  // update (several times per second) or the clock ticks. Synced
  // via a tiny dedicated effect below. This is the single biggest
  // perf win on the globe render path.
  const dataRef        = useRef(data);
  const nowCursorRef   = useRef(nowCursor);
  const focusTargetRef = useRef(focusTarget);
  // autoRotate has never been in the main frame-loop useEffect's dep
  // array. Before PR #104 that was harmless because `data` churning in
  // the deps forced a remount several times a second, incidentally
  // recapturing the latest autoRotate closure. Moving `data` out of
  // those deps killed that incidental recapture — leaving tick() stuck
  // seeing `autoRotate = true` forever, so the auto-rotate branch kept
  // overwriting targetRotRef every frame. That made panning and
  // zoom-out feel broken (the drag target got clobbered; the wheel's
  // call to stopAutoRotate had no effect on the rendered state).
  // Mirroring it via a ref fixes it without adding a remount trigger.
  const autoRotateRef  = useRef(autoRotate);
  // Same class as autoRotate — dcFilters is used inside the frame loop
  // to filter datacenter dots, toggled from the UI. Not frequent, but
  // it was never in the main effect's dep array either, so its closure
  // capture was stale any time the effect didn't happen to remount.
  const dcFiltersRef   = useRef(dcFilters);
  // True while the user is actively dragging or touch-panning. The
  // frame loop's focus-tracking block reads this so a drag can actually
  // move the camera instead of being snapped back every frame — without
  // this, a slight drag while tracking would visibly "fight" with the
  // tick loop and feel broken. Dropped to false on drag end so tracking
  // resumes naturally for small drags that didn't cross the cancel
  // threshold.
  const draggingRef    = useRef(false);
  // Base canvas redraw throttle. During idle auto-rotate we'd otherwise be
  // reparsing country / state / river / lake features 60×/sec; cap to ~30fps.
  const lastBaseRedrawMsRef = useRef(0);
  const countriesRef = useRef(null);        // internal country borders (mesh) — drawing only
  const countryFeaturesRef = useRef(null);  // NE admin_0 features — hit-test (has names)
  const countryCentroidsRef = useRef(null); // iso2 → [lon,lat] centroid, lazily built from countryFeaturesRef
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

  // Keep the latest-value refs in sync with their props. Touching the
  // base dirty flag on data/nowCursor change ensures we repaint with
  // the new values even without a full effect remount.
  useEffect(() => { dataRef.current = data;           dirtyBase.current = true; }, [data]);
  useEffect(() => { nowCursorRef.current = nowCursor; dirtyBase.current = true; }, [nowCursor]);
  useEffect(() => { focusTargetRef.current = focusTarget; }, [focusTarget]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { dcFiltersRef.current = dcFilters; dirtyBase.current = true; }, [dcFilters]);

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

  // Ocean currents — same subscribe pattern, different grid ref (see
  // src/ocean-currents.jsx).
  useEffect(() => {
    if (typeof window.subscribeOceanCurrents !== 'function') return;
    return window.subscribeOceanCurrents((g) => { oceanGridRef.current = g; });
  }, []);

  // Cables live on the basemap canvas — invalidate when the cable data
  // arrives or the toggle flips, otherwise the basemap wouldn't redraw
  // until the user happens to pan.
  useEffect(() => {
    dirtyBase.current = true;
  }, [data?.cables, layers?.cables]);

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

  // Data centers — PeeringDB colos + hyperscaler cloud regions. Dataset
  // is static (~4700 points); one-shot subscription is enough.
  const datacentersRef = useRef([]);
  useEffect(() => {
    if (typeof window.subscribeDatacenters !== 'function') return;
    return window.subscribeDatacenters((list) => { datacentersRef.current = list || []; });
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
    if (focusTarget?.trackLayer !== 'flight' || !focusTarget.callsign) {
      flightRouteRef.current = null;
      return;
    }
    if (typeof window.getFlightRoute !== 'function') return;
    const reqCall = focusTarget.callsign;
    let cancelled = false;
    window.getFlightRoute(reqCall).then((route) => {
      if (cancelled || focusTarget?.callsign !== reqCall) return;
      flightRouteRef.current = route || null;
      // Force one redraw so the great-circle appears immediately even
      // if nothing else is currently dirtying the base canvas (e.g. the
      // user clicked a flight without panning or zooming).
      dirtyBase.current = true;
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
        // Lifetimes 8-30 s at 60 fps. Longer than before — short
        // lifetimes meant ~150-500 particles respawning per frame at
        // random locations, which read as visible sparkle/flicker.
        // Doubled so the respawn signal blends into the steady flow.
        age: Math.random() * 600,
        maxAge: 480 + Math.floor(Math.random() * 1300),
        prevX: null, prevY: null,
      };
    }
    windParticlesRef.current = pool;
  }, [width, height]);

  // Ocean particle pool. Narrower lat range (±80°) since the grid is
  // bounded there and currents beyond are meaningless for the viz.
  useEffect(() => {
    const pool = new Array(OCEAN_PARTICLE_COUNT);
    for (let i = 0; i < OCEAN_PARTICLE_COUNT; i++) {
      pool[i] = {
        lon: Math.random() * 360 - 180,
        lat: (Math.random() - 0.5) * 160,
        // Even longer than wind — currents move slowly so longer streamers
        // emphasise the gyre patterns rather than flickering them away.
        age: Math.random() * 900,
        maxAge: 720 + Math.floor(Math.random() * 1800),
        prevX: null, prevY: null,
      };
    }
    oceanParticlesRef.current = pool;
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
      // Land base — load all three resolutions in parallel and pick per
      // zoom in the draw loop. 10m has the island detail we want, but it's
      // ~3 MB of coastline polygons — re-projecting the whole thing through
      // orthographic on every basemap tick was what made auto-rotate lag
      // and fps collapse. 110m is ~100 KB with <200 country polygons, so
      // auto-rotate / globe-scale redraws stay cheap.
      //
      // 110m loads first (smallest) so the globe paints immediately;
      // finer resolutions drop in and trigger progressively crisper
      // redraws as they arrive.
      gridRef.current = d3.geoGraticule().step([15,15])();
      try {
        const t110 = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
        landLowRef.current  = topojson.feature(t110, t110.objects.land);
        landRef.current = landLowRef.current;
        dirtyBase.current = true;
      } catch (e) { console.warn('land-110m fail', e); }
      // Fire off 50m in the background so the close-in tier arrives as
      // fast as the network allows without blocking the initial paint.
      // (10m was tried previously but thousands of extra polygons per
      // frame pushed base-redraw time over budget at the tier transition
      // — interactions stalled and the camera snap-snapped on queued
      // wheel events. The 50m tier is visually sufficient for all
      // realistic zooms and renders cheaply.)
      d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json').then(t50 => {
        landMidRef.current = topojson.feature(t50, t50.objects.land);
        dirtyBase.current = true;
      }).catch(e => console.warn('land-50m fail', e));

      // Countries — drawing uses topojson mesh (efficient dashed borders).
      // Also expose full country polygons on window for other components
      // (e.g. app2.jsx military-bases country filter) to do point-in-polygon.
      try {
        const c = await d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
        countriesRef.current = topojson.mesh(c, c.objects.countries, (a, b) => a !== b);
        // Feature collection with per-country Polygon/MultiPolygon geometries.
        // Computed bboxes cached alongside for fast point-in-polygon prefilter.
        const fc = topojson.feature(c, c.objects.countries);
        const feats = fc.features.map(f => ({ ...f, _bbox: d3.geoBounds(f) }));
        window.countryPolygonFeatures = feats;
        window.dispatchEvent(new CustomEvent('ge-countries-ready'));
        dirtyBase.current = true;
      } catch (e) { console.warn('countries topo fail', e); }

      // Hit-test dataset — Natural Earth 50m has names and lake holes, so
      // clicks inside lakes resolve to the lake (not the surrounding country)
      // AND clicks on small islands (Guam, Malta, Caymans, …) resolve to the
      // correct country instead of falling through to ocean as they did at
      // 110m where those islands don't exist as features.
      try {
        const hc = await d3.json('https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/50m/cultural/ne_50m_admin_0_countries_lakes.json');
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
    // Drag-as-cancel-tracking threshold. A tiny drag (accidental mouse
    // jitter, intentional small shift) shouldn't nuke focus-tracking —
    // the user asked specifically to have tracking persist unless they
    // *meant* to pan. `onUserPan` is only called once the cursor has
    // moved this many pixels since start, and only once per drag.
    const PAN_CANCEL_PX = 20;
    let dragStartX = 0, dragStartY = 0, pannedFar = false;

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
        draggingRef.current = true;
        markInteraction();
        dragStartX = ev.x; dragStartY = ev.y; pannedFar = false;
        // Don't clear focus here any more — see PAN_CANCEL_PX logic in
        // the `drag` event below. A mousedown alone with no movement
        // shouldn't kill tracking.
        lastMove = performance.now();
        lastMx = ev.x; lastMy = ev.y;
        vx = 0; vy = 0;
        targetRotRef.current = [...rotRef.current];
      })
      .on('drag', (ev) => {
        markInteraction();
        // If the cursor has moved beyond the cancel threshold since
        // drag start, this is a deliberate pan — clear any active
        // focus/tracking so the user regains free camera control. Only
        // fires once per drag to avoid spamming setFocusTarget.
        if (!pannedFar) {
          const d = Math.hypot(ev.x - dragStartX, ev.y - dragStartY);
          if (d > PAN_CANCEL_PX) {
            pannedFar = true;
            onUserPan?.();
          }
        }
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
        draggingRef.current = false;
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
        // Don't cancel focus-tracking on touchstart any more — only
        // after the touch has moved beyond PAN_CANCEL_PX (see
        // onTouchMove). A stationary finger on a tracked marker
        // shouldn't eject the lock-on.
        const t = e.touches[0];
        pan = {
          id: t.identifier,
          startX: t.clientX, startY: t.clientY,
          x: t.clientX, y: t.clientY,
          lastT: performance.now(),
          vx: 0, vy: 0,
          pannedFar: false,
        };
        draggingRef.current = true;
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
        // Same deliberate-pan threshold as mouse drag. Past 20px from
        // start we consider the pan intentional and cancel focus.
        if (!pan.pannedFar) {
          const d = Math.hypot(t.clientX - pan.startX, t.clientY - pan.startY);
          if (d > 20) {
            pan.pannedFar = true;
            onUserPan?.();
          }
        }
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
          draggingRef.current = false;
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
          pannedFar: false,
        };
        draggingRef.current = true;
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

  // Hemisphere visibility test, hot-pathed because it's called O(entities)
  // per frame across every layer. Old implementation did proj([lon,lat]),
  // proj.rotate(), and d3.geoDistance(...) on every call — a dozen trig
  // ops and two function hops each.
  //
  // Rotation is stable within a frame, so we cache the center-of-globe
  // unit vector keyed on the rotation tuple, then the per-call cost
  // collapses to two cos/sin + three muls + a dot-product compare
  // (point is on the front hemisphere iff point·center > 0).
  function visibleOn(proj, lon, lat) {
    const rot = proj.rotate();
    if (visibleOn._rotX !== rot[0] || visibleOn._rotY !== rot[1]) {
      visibleOn._rotX = rot[0];
      visibleOn._rotY = rot[1];
      const cLonR = -rot[0] * Math.PI / 180;
      const cLatR = -rot[1] * Math.PI / 180;
      const cCosLat = Math.cos(cLatR);
      visibleOn._cx = cCosLat * Math.cos(cLonR);
      visibleOn._cy = cCosLat * Math.sin(cLonR);
      visibleOn._cz = Math.sin(cLatR);
    }
    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const cL = Math.cos(latR);
    return (cL * Math.cos(lonR) * visibleOn._cx
          + cL * Math.sin(lonR) * visibleOn._cy
          + Math.sin(latR) * visibleOn._cz) > 0;
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

    // "Recently moved" detector — used to pick the cheap 110m land tier
    // during any kind of view change (auto-rotate, drag, pinch, inertial
    // scroll, focus-target tween) so the 10m dataset only kicks in when
    // the view is actually still. 200 ms quiet is enough to know the
    // user has stopped interacting.
    //
    // Seed lastRot/lastScale from the *actual* current ref values, not
    // from zeros. This effect tears down and re-runs whenever any of its
    // many deps change (including `data`, which ticks on every SSE
    // snapshot — several times per second). Re-initialising to [0,0,0]
    // meant the first frame of every new effect instance saw
    //   rotRef.current[0] !== 0 → "motion detected"
    // even though nothing had moved. That bumped lastMoveTs, flipped
    // recentlyMoved=true for 200 ms, and dropped the land tier back to
    // 110m. With data re-triggering the effect every ~1–2 s the base
    // flickered between 110m and 10m continuously. Seeding from the
    // current ref values makes the first frame a no-op, and the detector
    // only fires on genuine subsequent changes.
    let lastRot = [rotRef.current[0], rotRef.current[1], rotRef.current[2]],
        lastScale = scaleRef.current,
        lastMoveTs = 0;

    const tick = () => {
      // Pick up the latest values of frequently-changing props without
      // relying on them being in the enclosing useEffect's dep array.
      // See the comment where `dataRef` / `nowCursorRef` / `focusTargetRef`
      // are declared for the why. These locals shadow the props of the
      // same name so the rest of the (very long) tick body continues to
      // read `data.foo`, `nowCursor`, `focusTarget` with no further
      // changes.
      const data        = dataRef.current;
      const nowCursor   = nowCursorRef.current;
      const focusTarget = focusTargetRef.current;
      const autoRotate  = autoRotateRef.current;
      const dcFilters   = dcFiltersRef.current;

      const tickNow = performance.now();
      const frameDt = lastFrameMsRef.current ? (tickNow - lastFrameMsRef.current) / 1000 : 0;
      lastFrameMsRef.current = tickNow;

      const rNow = rotRef.current, sNow = scaleRef.current;
      if (rNow[0] !== lastRot[0] || rNow[1] !== lastRot[1] || sNow !== lastScale) {
        lastRot = [rNow[0], rNow[1], rNow[2]];
        lastScale = sNow;
        lastMoveTs = tickNow;
      }
      const recentlyMoved = tickNow - lastMoveTs < 200;

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
      // Skip focus-tracking while the user is actively dragging/panning
      // — we don't want to fight their input every frame. Tracking will
      // resume on the next tick after drag end if focus wasn't cleared
      // by the pan-cancel threshold.
      if (focusTarget?.trackId && data && !draggingRef.current) {
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

      // Draw base on every dirty frame.
      //
      // History: we previously throttled this (22 ms uniform; or 66 ms
      // during auto-rotate). Both throttles produced visible flicker —
      // the basemap's coastlines and country borders sat at one
      // rotation while overlay layers (ships, flights, particles)
      // continued advancing at 60 fps. The rotational mismatch reads
      // as a strobe across the globe even at 1-2 frames of lag.
      //
      // The basemap LOD (#61, #64) already drops to 110m during any
      // view motion (<200 polygons, ~100 KB), so per-frame redraws
      // are cheap enough to remove the throttle entirely. Keeping
      // basemap and overlays frame-locked is the only way to
      // eliminate the strobe.
      //
      // 16 ms cap (≈60 fps) clamps the redraw rate on 120 Hz
      // monitors where RAF would otherwise fire 120×/s — basemap
      // doesn't need to redraw faster than the eye can integrate,
      // and the doubled work was perceived as jank.
      const BASE_REDRAW_MIN_MS = 16;
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

        // Submarine communications cables (TeleGeography). Painted on the
        // basemap canvas — hundreds of polylines with tens of thousands of
        // coords combined; re-projecting them every overlay frame was a
        // real tax. On the basemap they only cost on view change (now
        // properly LOD-throttled during auto-rotate too).
        if (layers.infrastructure && layers.cables && Array.isArray(data.cables) && data.cables.length) {
          bctx.save();
          bctx.lineWidth = 0.7;
          // Group by TeleGeography's per-route color — ~20 hues across
          // 700+ cables, so ~20 state changes instead of 700.
          const byColor = new Map();
          for (const c of data.cables) {
            const arr = byColor.get(c.color) || [];
            arr.push(c.geometry);
            byColor.set(c.color, arr);
          }
          for (const [col, geoms] of byColor) {
            bctx.strokeStyle = col + (isDark ? '88' : 'aa');
            bctx.beginPath();
            for (const g of geoms) path(g);
            bctx.stroke();
          }
          bctx.restore();
        }

        // Land — wireframe outline (the signature look). Two tiers only,
        // picked purely by zoomB (no motion dependency — swapping tiers
        // mid-interaction read as a visible "reload" and was the source
        // of the earlier flicker complaint):
        //   • zoomB < 5   →  110m   (~100 KB, ~175 polys)   globe view
        //   • zoomB ≥ 5   →  50m    (~550 KB, ~1400 polys)  close-in
        //
        // The 10m tier was tried previously. At the transition zoom, a
        // big slice of the sphere was still on-screen, so ~2000 visible
        // polygons per frame — combined with cables + country mesh +
        // state lines + rivers + cities on the same dirty-frame path —
        // pushed base redraw past 16 ms, saturating the event loop,
        // queueing wheel events, and producing bursty camera snaps
        // (\"random spinning\") plus unresponsive drag. Dropped it
        // entirely; 50m reads well at every practical zoom.
        //
        // Tiers fall back gracefully while 50m is still streaming.
        const landTier =
          zoomB < 5 ? (landLowRef.current || landMidRef.current)
                    : (landMidRef.current || landLowRef.current);
        if (landTier) {
          landRef.current = landTier;
          bctx.beginPath(); path(landTier);
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
          bctx.fillStyle = isDark ? 'rgba(253,224,71,1)' : 'rgba(180,83,9,1)';
          bctx.strokeStyle = isDark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.95)';
          bctx.lineWidth = 1.1;
          bctx.font = `500 ${zoomB >= 3 ? 10 : 9}px Geist Mono, monospace`;
          bctx.textBaseline = 'middle';
          for (const f of citiesRef.current.features) {
            const p = f.properties || {};
            const sr = p.scalerank ?? p.SCALERANK ?? 99;
            if (sr > rankCap) continue;
            const [lon, lat] = f.geometry.coordinates;
            if (!visibleOn(projection, lon, lat)) continue;
            const pt = projection([lon, lat]); if (!pt) continue;
            // Star size scales with rank. Generously sized because a
            // 5-point star at small radii has significant negative
            // space between the points — a "r=5" star has roughly the
            // visual weight of a "r=3" filled circle.
            const starR = sr <= 1 ? 5.5 : sr <= 3 ? 4.2 : 3.2;
            iconCity(bctx, pt[0], pt[1], starR);
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
                bctx.fillText(name, pt[0] + starR + 3, pt[1]);
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

      // Wind + ocean particle flow share one dedicated canvas with a
      // per-frame fade-clear so moving particles leave short-lived trails.
      //
      // Fade alpha is TIME-based (scaled by frameDt), not frame-based.
      // On 60 Hz the fade matches the old constant; on 120 Hz the per-
      // frame alpha is halved so trails fade at the same wall-clock
      // rate. Without this, 120 Hz monitors decayed trails twice as
      // fast and the resulting half-length trails read as flicker.
      //
      // Per-particle teleport detection lives in each draw loop: if a
      // particle's screen jump > TELEPORT_PX (lon-180 wrap or sudden
      // user pan) we skip the connecting line for that frame but still
      // update prev so the next frame paints a clean stroke.
      const isDarkW = theme === 'dark';
      const TELEPORT_PX = 30;
      const flowsOn = layers.wind || layers.oceanCurrents;
      const fadeDt = Math.min(0.1, frameDt || 0.0167);
      if (flowsOn) {
        // ~1.7 s half-life on the trail fade. Frame-rate independent.
        const fadeAlpha = Math.min(0.08, (isDarkW ? 1.8 : 2.7) * fadeDt);
        wctx.save();
        wctx.globalCompositeOperation = 'destination-out';
        wctx.fillStyle = `rgba(0,0,0,${fadeAlpha.toFixed(3)})`;
        wctx.fillRect(0, 0, width, height);
        wctx.restore();
      } else if (wctx) {
        // Both off — clear once so no leftover trails persist.
        wctx.clearRect(0, 0, width, height);
      }

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

        // Map m/s → HSL colour. Warm-only palette so wind never visually
        // collides with the cool ocean current layer: pale gold for calm,
        // through orange to deep red at hurricane speeds. (Old palette
        // started in blue — indistinguishable from ocean at low speeds.)
        const windColor = (speed, alpha) => {
          const t = Math.min(speed / 28, 1);
          const hue = 50 - t * 50;          // 50 gold → 0 red
          const sat = 75 + t * 20;
          const light = 65 - t * 15;        // brighter at low speeds, darker punch at high
          return `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha})`;
        };

        // Particle advance. SQRT compression on speed so 1 m/s still shows
        // visible motion and 25 m/s isn't a blur. Direction vector is
        // preserved; only the magnitude is remapped.
        //
        //   effective motion = direction × sqrt(speed + 0.5) × SCALE × dt
        //
        // SCALE_PER_SEC of 0.25 puts a 10 m/s wind at ~0.8°/s. Real
        // wind at that speed is 0.0001°/s on Earth — we're 8000× faster
        // than reality but still noticeably calmer than the old 0.7
        // (which was 23000× real). Major weather patterns now drift at
        // a pace closer to time-lapse video than to whirlwind.
        const SCALE_PER_SEC = 0.25;
        // Clamp dt at frame-stall boundaries so a dropped-frame pause
        // doesn't launch every particle 5° in one step.
        const windDt = Math.min(0.1, frameDt || 0.0167);
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
          const step = visMag * SCALE_PER_SEC * windDt;
          p.lat += dirY * step;
          p.lon += (dirX * step) / cosLat;
          if (p.lon > 180) p.lon -= 360;
          if (p.lon < -180) p.lon += 360;

          // Only draw when on the visible hemisphere.
          if (!visibleOn(projection, p.lon, p.lat)) { p.prevX = null; p.prevY = null; continue; }
          const pt = projection([p.lon, p.lat]);
          if (!pt) continue;
          // Per-particle teleport guard — lon-180 wrap or a sudden
          // user drag puts prev → current >TELEPORT_PX apart; drawing
          // that line would smear a streak across the canvas. Skip
          // the line, but keep prev updated so the next frame paints
          // a fresh correctly-anchored stroke.
          //
          // Auto-rotate's tiny 0.067°/frame motion stays well under
          // the threshold, so particles render normally during the
          // default idle state.
          if (p.prevX != null && p.prevY != null) {
            const dx = pt[0] - p.prevX, dy = pt[1] - p.prevY;
            if (dx*dx + dy*dy < TELEPORT_PX*TELEPORT_PX) {
              wctx.beginPath();
              wctx.moveTo(p.prevX, p.prevY);
              wctx.lineTo(pt[0], pt[1]);
              wctx.strokeStyle = windColor(speed, 0.9);
              wctx.lineWidth = 1.3;
              wctx.stroke();
            }
          }
          p.prevX = pt[0]; p.prevY = pt[1];
        }
      }

      // Ocean currents — mirror of the wind particle engine, sharing the
      // same fade-clear canvas so wind-over-land and currents-over-sea
      // render side by side naturally. Slower effective motion (currents
      // rarely exceed 2 m/s vs wind's 30+ m/s) but longer streamers.
      if (layers.oceanCurrents && oceanGridRef.current) {
        const g = oceanGridRef.current;
        const { latMin, lonMin, latStep, lonStep, nLat, nLon, u, v } = g;
        const sampleCur = (lon, lat) => {
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
          const uu = (1-fx)*(1-fy)*u[i00] + fx*(1-fy)*u[i10] + (1-fx)*fy*u[i01] + fx*fy*u[i11];
          const vv = (1-fx)*(1-fy)*v[i00] + fx*(1-fy)*v[i10] + (1-fx)*fy*v[i01] + fx*fy*v[i11];
          return [uu, vv];
        };

        // Deep-water palette: currents never get "warm". Pushed deeper
        // and brighter than before to stay clearly distinct from the
        // gold/red wind palette: deep blue for calm, electric cyan for
        // jets like the Gulf Stream and Kuroshio.
        const currentColor = (speed, alpha) => {
          const t = Math.min(speed / 1.6, 1); // cap near Kuroshio peak (~1.5 m/s)
          const hue = 200 - t * 20;           // 200 deep cyan-blue → 180 cyan
          const sat = 85;                     // saturated all the way through
          const light = 40 + t * 25;          // dim depth-blue → bright cyan
          return `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${alpha})`;
        };

        // Ocean speed reduced to 1.5 — currents are physically ~20× slower
        // than wind, so wind 0.25 with sqrt-compression vs ocean 1.5 with
        // raw speed puts a 1 m/s Kuroshio jet at 1.5°/s and a 0.3 m/s
        // typical current at 0.45°/s. Slow enough that the gyre patterns
        // read as the slow drifts they actually are.
        const OCEAN_SCALE_PER_SEC = 1.5;
        const oceanDt = Math.min(0.1, frameDt || 0.0167);
        const particles = oceanParticlesRef.current;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.age++;
          if (p.age > p.maxAge || p.lat > 82 || p.lat < -82) {
            p.lon = Math.random() * 360 - 180;
            p.lat = (Math.random() - 0.5) * 160;
            p.age = 0;
            p.prevX = null; p.prevY = null;
            continue;
          }
          const w = sampleCur(p.lon, p.lat);
          if (!w) continue;
          const [uu, vv] = w;
          const speed = Math.hypot(uu, vv);
          // Stagnant particles hold position but still age normally —
          // previous version added +20 age and skipped the draw, which
          // left dangling trail endpoints when a flow stalled briefly.
          // Now: just don't advance, but render at last position so the
          // visual trail stays continuous.
          if (speed < 0.02) {
            if (!visibleOn(projection, p.lon, p.lat)) { p.prevX = null; p.prevY = null; continue; }
            const pt = projection([p.lon, p.lat]);
            if (pt) { p.prevX = pt[0]; p.prevY = pt[1]; }
            continue;
          }
          const dirX = uu / speed, dirY = vv / speed;
          const latRad = p.lat * Math.PI / 180;
          const cosLat = Math.max(0.05, Math.cos(latRad));
          const step = speed * OCEAN_SCALE_PER_SEC * oceanDt;
          p.lat += dirY * step;
          p.lon += (dirX * step) / cosLat;
          if (p.lon > 180) p.lon -= 360;
          if (p.lon < -180) p.lon += 360;
          if (!visibleOn(projection, p.lon, p.lat)) { p.prevX = null; p.prevY = null; continue; }
          const pt = projection([p.lon, p.lat]);
          if (!pt) continue;
          // Per-particle teleport guard — see wind block above.
          if (p.prevX != null && p.prevY != null) {
            const dx = pt[0] - p.prevX, dy = pt[1] - p.prevY;
            if (dx*dx + dy*dy < TELEPORT_PX*TELEPORT_PX) {
              wctx.beginPath();
              wctx.moveTo(p.prevX, p.prevY);
              wctx.lineTo(pt[0], pt[1]);
              wctx.strokeStyle = currentColor(speed, 0.8);
              wctx.lineWidth = 1.1;
              wctx.stroke();
            }
          }
          p.prevX = pt[0]; p.prevY = pt[1];
        }
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
            // Significant — gentle expanding ring once every ~3.6 s
            // (was 1.8 s — too fast, multiple M5+ quakes pulsing out
            // of phase added to overall flicker). Lower max alpha too.
            const phase = ((now/1000) + (q.id?.charCodeAt(0) || 0))%3.6/3.6;
            const sz = 9 + (mag - 5) * 1.4;
            octx.beginPath();
            octx.arc(px, py, sz*0.7 + phase*8*animationIntensity, 0, Math.PI*2);
            octx.strokeStyle = `rgba(244,63,94,${0.30*(1-phase)*(1-age*0.6)})`;
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
        // EONET category ids are camelCase (`severeStorms`, `wildfires`,
        // `seaLakeIce`, etc.), so the match has to be case-insensitive.
        // Previous lowercase `includes` silently missed every storm and
        // fell through to the generic purple event icon.
        const catMeta = (cid) => {
          const c = (cid || '').toLowerCase();
          if (c.includes('wildfire'))                     return { c:'#ef4444', fn:iconFire };
          if (c.includes('volcano'))                      return { c:'#f97316', fn:iconVolcano };
          if (c.includes('storm') || c.includes('cyclone')) return { c:'#38bdf8', fn:iconStorm };
          if (c.includes('ice') || c.includes('snow'))    return { c:'#a5f3fc', fn:iconIce };
          return { c:'#a78bfa', fn:iconEvent };
        };
        const isStormCat = (cid) => {
          const c = (cid || '').toLowerCase();
          return c.includes('storm') || c.includes('cyclone');
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

      // Active tropical cyclones (NHC CurrentStorms + forecast cone + track).
      // Atlantic / Eastern Pacific / Central Pacific basins only. Drawn on the
      // overlay so forecast geometry repaints with zoom changes without a
      // basemap invalidation. Cone fills first (so it sits under the track
      // polyline and the storm glyph), then track, then spiral marker.
      if (layers.cyclones !== false && Array.isArray(data.cyclones) && data.cyclones.length) {
        // Color ramp keyed to intensity in knots (Saffir-Simpson for
        // hurricanes; below-cat-1 buckets follow NHC classification).
        const cycloneColor = (kt) => {
          if (!isFinite(kt) || kt < 34) return '#38bdf8';  // TD / Low: cyan
          if (kt < 64)  return '#facc15';                   // TS / STS: yellow
          if (kt < 83)  return '#fb923c';                   // Cat 1: orange
          if (kt < 96)  return '#f97316';                   // Cat 2: deep orange
          if (kt < 113) return '#ef4444';                   // Cat 3: red
          if (kt < 137) return '#dc2626';                   // Cat 4: crimson
          return '#ec4899';                                 // Cat 5: magenta
        };
        const opath = d3.geoPath(projection, octx);
        for (const cy of data.cyclones) {
          const col = cycloneColor(cy.intensityKt);

          // Forecast cone — filled at very low alpha with a dashed outline so
          // the uncertainty envelope reads distinctly from the track itself.
          if (cy.cone) {
            octx.save();
            octx.fillStyle = col + '22';  // ~13% alpha
            octx.strokeStyle = col + 'aa';
            octx.lineWidth = 0.8;
            octx.setLineDash([3, 3]);
            octx.beginPath();
            opath(cy.cone);
            octx.fill();
            octx.stroke();
            octx.restore();
          }

          // Forecast track — solid polyline in storm color.
          if (cy.track) {
            octx.save();
            octx.strokeStyle = col;
            octx.lineWidth = 1.3;
            octx.beginPath();
            opath(cy.track);
            octx.stroke();
            octx.restore();
          }

          // Current position marker — scale spiral with intensity so a Cat 5
          // visibly dominates a tropical depression on the same map.
          if (visibleOn(projection, cy.lon, cy.lat)) {
            const pt = projection([cy.lon, cy.lat]); if (!pt) continue;
            const size = 10 + Math.min(12, Math.max(0, (cy.intensityKt || 0) - 30) * 0.15);
            iconStorm(octx, pt[0], pt[1], size, col);
            // Name label at zoom ≥ 1.6 (below that the globe is too small to
            // carry readable text for multiple simultaneous storms).
            if (zoom >= 1.6) {
              const label = cy.name + (cy.classification ? ` · ${cy.classification}` : '');
              octx.font = '10px Geist Mono, ui-monospace';
              octx.textBaseline = 'middle';
              octx.textAlign = 'left';
              const tw = octx.measureText(label).width;
              const lx = pt[0] + size * 0.8, ly = pt[1] + 0.5;
              octx.fillStyle = isDark ? 'rgba(10,10,15,0.7)' : 'rgba(255,255,255,0.8)';
              octx.fillRect(lx - 2, ly - 7, tw + 4, 13);
              octx.fillStyle = col;
              octx.fillText(label, lx, ly);
            }
            pushHit(pt[0], pt[1], Math.max(10, size * 0.8), 'cyclone', cy);
          }
        }
      }

      // Nuclear reactors (GeoNuclearData). Color by operational status,
      // size subtly scaled with net MWe. Always-visible (no LOD cluster)
      // because the global fleet is only ~800 reactors.
      if (layers.infrastructure && layers.reactors && Array.isArray(data.reactors) && data.reactors.length) {
        const statusColor = (s) => {
          s = (s || '').toLowerCase();
          if (s.includes('operational')) return '#22c55e';       // green
          if (s.includes('construction')) return '#eab308';      // yellow
          if (s.includes('planned')) return '#38bdf8';           // sky blue
          if (s.includes('cancelled') || s.includes('suspended')) return '#94a3b8'; // slate
          if (s.includes('shutdown') || s.includes('decommiss')) return '#71717a'; // zinc
          return '#a78bfa';
        };
        octx.save();
        for (const rx of data.reactors) {
          if (!visibleOn(projection, rx.lon, rx.lat)) continue;
          const pt = projection([rx.lon, rx.lat]); if (!pt) continue;
          // Size scales subtly with net MWe so a 1400 MW reactor reads as
          // slightly larger than a 300 MW research unit.
          const sz = 7 + Math.min(4, (rx.capacity || 0) / 700);
          iconRadiation(octx, pt[0], pt[1], sz, statusColor(rx.status));
          pushHit(pt[0], pt[1], Math.max(6, sz * 0.6), 'reactor', rx);
        }
        octx.restore();
      }

      // Global power-plant fleet (WRI GPPD, pre-filtered to ≥100 MW).
      // ~10 k plants globally, so we LOD-cluster at low zoom: at zoom <3
      // we thin-render to one point per ~0.5° cell; at zoom ≥3 we draw
      // everything in view. Color by primary fuel.
      if (layers.infrastructure && layers.plants && Array.isArray(data.plants) && data.plants.length) {
        const fuelColor = (f) => {
          f = (f || '').toLowerCase();
          if (f === 'coal')                              return '#525252';  // zinc
          if (f === 'gas')                               return '#f59e0b';  // amber
          if (f === 'oil' || f === 'petcoke')            return '#78350f';  // brown
          if (f === 'nuclear')                           return '#22c55e';  // green (matches reactor ops)
          if (f === 'hydro')                             return '#0ea5e9';  // sky
          if (f === 'wind')                              return '#a3e635';  // lime
          if (f === 'solar')                             return '#facc15';  // yellow
          if (f === 'biomass' || f === 'waste')          return '#65a30d';  // olive
          if (f === 'geothermal')                        return '#f472b6';  // pink
          if (f === 'wave and tidal' || f === 'storage') return '#38bdf8';  // cyan
          return '#a78bfa';                                                 // purple fallback
        };
        // LOD: bucket cell size shrinks with zoom. One visible plant per
        // cell — the highest-capacity one wins so the map always shows
        // the most significant installation in a given region.
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.6 : 1.5;
        const cell = new Map();
        for (const p of data.plants) {
          if (!visibleOn(projection, p.lon, p.lat)) continue;
          if (cellDeg === 0) {
            cell.set(p.id, p);
            continue;
          }
          const key = Math.round(p.lon / cellDeg) + '|' + Math.round(p.lat / cellDeg);
          const prev = cell.get(key);
          if (!prev || p.capacity > prev.capacity) cell.set(key, p);
        }
        octx.save();
        // At low zoom the LOD cluster keeps visible count ≤ ~180, so we
        // can afford the full bolt-in-circle icon. At zoom ≥ 3 we're
        // showing every individual plant in the viewport (could be
        // thousands) so the dense dot is the readable choice.
        const useIcon = zoom < 3;
        for (const p of cell.values()) {
          const pt = projection([p.lon, p.lat]); if (!pt) continue;
          const col = fuelColor(p.fuel);
          if (useIcon) {
            const sz = 6 + Math.min(3, p.capacity / 1200);
            iconPlant(octx, pt[0], pt[1], sz, col);
            pushHit(pt[0], pt[1], Math.max(5, sz * 0.55), 'plant', p);
          } else {
            const r = 1.4 + Math.min(2.8, p.capacity / 1400);
            octx.fillStyle = col + 'cc';
            octx.beginPath();
            octx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
            octx.fill();
            pushHit(pt[0], pt[1], Math.max(5, r + 1.5), 'plant', p);
          }
        }
        octx.restore();
      }

      // Semiconductor fabs (curated list, ~40 entries). Iconic chip
      // silhouette (square die with pins) via iconFab. No LOD needed
      // at this dataset size.
      if (layers.infrastructure && layers.fabs && Array.isArray(data.fabs) && data.fabs.length) {
        for (const f of data.fabs) {
          if (!visibleOn(projection, f.lon, f.lat)) continue;
          const pt = projection([f.lon, f.lat]); if (!pt) continue;
          iconFab(octx, pt[0], pt[1], 8, '#a78bfa');
          pushHit(pt[0], pt[1], 8, 'fab', f);
        }
      }

      // Smelters & mills (OSM Overpass, ~250 entries). Metal smelters
      // (steel, aluminium, copper) and sugar refineries / mills — the
      // non-oil half of `industrial=refinery`. LOD cell-dedup at low
      // zoom for readability.
      if (layers.infrastructure && layers.smelters && Array.isArray(data.smelters) && data.smelters.length) {
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.6 : 1.4;
        const cell = new Map();
        for (const s of data.smelters) {
          if (!visibleOn(projection, s.lon, s.lat)) continue;
          if (cellDeg === 0) { cell.set(s.id, s); continue; }
          const key = Math.round(s.lon / cellDeg) + '|' + Math.round(s.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, s);
        }
        for (const s of cell.values()) {
          const pt = projection([s.lon, s.lat]); if (!pt) continue;
          iconSmelter(octx, pt[0], pt[1], 7, '#94a3b8');
          pushHit(pt[0], pt[1], 8, 'smelter', s);
        }
      }

      // Cement plants (OSM Overpass, ~465 entries). Silo icon. LOD
      // cell-dedup at low zoom.
      if (layers.infrastructure && layers.cement && Array.isArray(data.cement) && data.cement.length) {
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.6 : 1.4;
        const cell = new Map();
        for (const c of data.cement) {
          if (!visibleOn(projection, c.lon, c.lat)) continue;
          if (cellDeg === 0) { cell.set(c.id, c); continue; }
          const key = Math.round(c.lon / cellDeg) + '|' + Math.round(c.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, c);
        }
        for (const c of cell.values()) {
          const pt = projection([c.lon, c.lat]); if (!pt) continue;
          iconCement(octx, pt[0], pt[1], 7, '#d4d4d8');
          pushHit(pt[0], pt[1], 8, 'cement', c);
        }
      }

      // Mines (OSM Overpass, ~3,000 named mines globally). Inverted-
      // triangle "open pit" icon. Aggressive LOD cell-dedup at low
      // zoom — mining regions (Andes, Western Australia, Congo Belt)
      // would otherwise obliterate the map.
      if (layers.infrastructure && layers.mines && Array.isArray(data.mines) && data.mines.length) {
        const cellDeg = zoom >= 4 ? 0 : zoom >= 3 ? 0.3 : zoom >= 2 ? 0.8 : 2.0;
        const cell = new Map();
        for (const m of data.mines) {
          if (!visibleOn(projection, m.lon, m.lat)) continue;
          if (cellDeg === 0) { cell.set(m.id, m); continue; }
          const key = Math.round(m.lon / cellDeg) + '|' + Math.round(m.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, m);
        }
        for (const m of cell.values()) {
          const pt = projection([m.lon, m.lat]); if (!pt) continue;
          iconMine(octx, pt[0], pt[1], 7, '#78716c');
          pushHit(pt[0], pt[1], 8, 'mine', m);
        }
      }

      // Oil refineries (OSM Overpass, ~600 entries globally). Iconic
      // fractionation-column silhouette via iconRefinery. LOD via
      // cell-dedup at low zoom keeps dense regions (Gulf Coast,
      // Middle East, ARA cluster) readable.
      if (layers.infrastructure && layers.refineries && Array.isArray(data.refineries) && data.refineries.length) {
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.4 : 1.0;
        const cell = new Map();
        for (const r of data.refineries) {
          if (!visibleOn(projection, r.lon, r.lat)) continue;
          if (cellDeg === 0) { cell.set(r.id, r); continue; }
          const key = Math.round(r.lon / cellDeg) + '|' + Math.round(r.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, r);
        }
        for (const r of cell.values()) {
          const pt = projection([r.lon, r.lat]); if (!pt) continue;
          iconRefinery(octx, pt[0], pt[1], 7, '#a16207');
          pushHit(pt[0], pt[1], 8, 'refinery', r);
        }
      }

      // LNG terminals (curated list, ~35 entries). Iconic spherical
      // cryogenic tank via iconLng.
      if (layers.infrastructure && layers.lng && Array.isArray(data.lng) && data.lng.length) {
        for (const t of data.lng) {
          if (!visibleOn(projection, t.lon, t.lat)) continue;
          const pt = projection([t.lon, t.lat]); if (!pt) continue;
          iconLng(octx, pt[0], pt[1], 7, '#60a5fa');
          pushHit(pt[0], pt[1], 8, 'lng', t);
        }
      }

      // Gas processing (curated list, ~20 entries). Iconic cluster of
      // spherical tanks via iconGasProcessing. Distinct from LNG both
      // in shape (cluster vs. single sphere) and color (teal vs. blue).
      if (layers.infrastructure && layers.gasproc && Array.isArray(data.gasproc) && data.gasproc.length) {
        for (const g of data.gasproc) {
          if (!visibleOn(projection, g.lon, g.lat)) continue;
          const pt = projection([g.lon, g.lat]); if (!pt) continue;
          iconGasProcessing(octx, pt[0], pt[1], 8, '#0e7490');
          pushHit(pt[0], pt[1], 8, 'gasproc', g);
        }
      }

      // Major dams (OSM Overpass, ~200 entries). Iconic wall-with-
      // water silhouette via iconDam. LOD cell-dedup at low zoom
      // keeps dense river regions (Himalayas, Alps) readable.
      if (layers.infrastructure && layers.dams && Array.isArray(data.dams) && data.dams.length) {
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.6 : 1.5;
        const cell = new Map();
        for (const d of data.dams) {
          if (!visibleOn(projection, d.lon, d.lat)) continue;
          if (cellDeg === 0) { cell.set(d.id, d); continue; }
          const key = Math.round(d.lon / cellDeg) + '|' + Math.round(d.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, d);
        }
        for (const d of cell.values()) {
          const pt = projection([d.lon, d.lat]); if (!pt) continue;
          iconDam(octx, pt[0], pt[1], 7, '#3b82f6');
          pushHit(pt[0], pt[1], 8, 'dam', d);
        }
      }

      // Major ports (curated, ~50 entries). Classic anchor silhouette
      // via iconPort.
      if (layers.infrastructure && layers.ports && Array.isArray(data.ports) && data.ports.length) {
        for (const p of data.ports) {
          if (!visibleOn(projection, p.lon, p.lat)) continue;
          const pt = projection([p.lon, p.lat]); if (!pt) continue;
          iconPort(octx, pt[0], pt[1], 8, '#10b981');
          pushHit(pt[0], pt[1], 8, 'port', p);
        }
      }

      // Oil & gas pipelines (curated, ~20 entries with multi-waypoint
      // paths). Polylines through each path's waypoints — oil amber,
      // gas purple. Straight-line segments between projected points
      // approximate great circles acceptably for the overview story;
      // segments that cross the back of the globe break cleanly when
      // `visibleOn` rejects a point.
      //
      // Hit targets: register at every waypoint AND sample ~4 interior
      // points per segment so clicking anywhere along the line opens
      // the detail card (not just the endpoint).
      if (layers.infrastructure && layers.pipelines && Array.isArray(data.pipelines) && data.pipelines.length) {
        octx.save();
        octx.lineWidth = 1.4;
        octx.lineCap = 'round';
        octx.lineJoin = 'round';
        const SEG_SAMPLES = 4; // interior hit samples per segment
        for (const pl of data.pipelines) {
          if (!Array.isArray(pl.path) || pl.path.length < 2) continue;
          octx.strokeStyle = pl.type === 'gas' ? '#8b5cf6dd' : '#d97706dd';
          let started = false;
          let prevPt = null;
          for (const [lon, lat] of pl.path) {
            if (!visibleOn(projection, lon, lat)) {
              if (started) octx.stroke();
              started = false; prevPt = null; continue;
            }
            const pt = projection([lon, lat]);
            if (!pt) {
              if (started) octx.stroke();
              started = false; prevPt = null; continue;
            }
            if (!started) {
              octx.beginPath();
              octx.moveTo(pt[0], pt[1]);
              started = true;
            } else {
              octx.lineTo(pt[0], pt[1]);
            }
            // Waypoint hit target.
            pushHit(pt[0], pt[1], 8, 'pipeline', pl);
            // Interior hit samples between prevPt and pt — evenly
            // spaced in screen space, which for short/medium pipeline
            // segments is close enough to evenly-spaced-along-route.
            if (prevPt) {
              for (let s = 1; s <= SEG_SAMPLES; s++) {
                const t = s / (SEG_SAMPLES + 1);
                const mx = prevPt[0] + (pt[0] - prevPt[0]) * t;
                const my = prevPt[1] + (pt[1] - prevPt[1]) * t;
                pushHit(mx, my, 8, 'pipeline', pl);
              }
            }
            prevPt = pt;
          }
          if (started) octx.stroke();
        }
        octx.restore();
      }

      // Military bases (OSM Overpass, ~7k named installations globally
      // across base / airfield / naval_base / barracks tags). Top-level
      // layer — not gated on layers.infrastructure because installations
      // aren't civilian infrastructure. Aggressive LOD cell-dedup at low
      // zoom because dense NATO regions (Germany, UK, US East Coast)
      // would otherwise blob.
      if (layers.military && Array.isArray(data.military) && data.military.length) {
        const cellDeg = zoom >= 4 ? 0 : zoom >= 3 ? 0.3 : zoom >= 2 ? 0.8 : 2.0;
        const cell = new Map();
        for (const m of data.military) {
          if (!visibleOn(projection, m.lon, m.lat)) continue;
          if (cellDeg === 0) { cell.set(m.id, m); continue; }
          const key = Math.round(m.lon / cellDeg) + '|' + Math.round(m.lat / cellDeg);
          if (!cell.has(key)) cell.set(key, m);
        }
        for (const m of cell.values()) {
          const pt = projection([m.lon, m.lat]); if (!pt) continue;
          iconMilitary(octx, pt[0], pt[1], 7, '#65a30d');
          pushHit(pt[0], pt[1], 8, 'military', m);
        }
      }

      // GDELT news hotspots. Each event is a single geocoded news
      // article cluster, colored by CAMEO QuadClass (1=verbal coop
      // green, 2=material coop sky, 3=verbal conflict amber, 4=material
      // conflict red) and sized by article mentions. LOD-thins with a
      // 0.4°–1.2° cell depending on zoom so dense conflict regions
      // don't stack into solid blobs.
      if (layers.news && Array.isArray(data.news) && data.news.length) {
        const quadColor = (q) =>
          q === 1 ? '#22c55e' :   // verbal cooperation — green
          q === 2 ? '#0ea5e9' :   // material cooperation — sky
          q === 3 ? '#f59e0b' :   // verbal conflict — amber
          q === 4 ? '#ef4444' :   // material conflict — red
                    '#a78bfa';    // unknown — purple
        const cellDeg = zoom >= 3 ? 0 : zoom >= 2 ? 0.5 : 1.2;
        const cell = new Map();
        for (const n of data.news) {
          if (!visibleOn(projection, n.lon, n.lat)) continue;
          if (cellDeg === 0) {
            cell.set(n.id, n);
            continue;
          }
          const key = Math.round(n.lon / cellDeg) + '|' + Math.round(n.lat / cellDeg) + '|' + n.quad;
          const prev = cell.get(key);
          // Keep the record with the most mentions in each cell — closest
          // proxy to "most-covered story in this area".
          if (!prev || (n.mentions || 1) > (prev.mentions || 1)) cell.set(key, n);
        }
        octx.save();
        // Pulse-ring icon at low zoom where visible count is bounded by
        // the cell LOD (~200 max); plain dot at zoom ≥ 3 where every
        // geocoded event is shown and the count can spike into the
        // thousands.
        const newsIcon = zoom < 3;
        for (const n of cell.values()) {
          const pt = projection([n.lon, n.lat]); if (!pt) continue;
          const col = quadColor(n.quad);
          // Alpha tracks |tone| so polarised stories pop and neutral
          // noise fades.
          const alpha = Math.min(0.9, 0.35 + Math.min(1, Math.abs(n.tone || 0) / 6) * 0.5);
          const hex = col + Math.round(alpha * 255).toString(16).padStart(2, '0');
          if (newsIcon) {
            const sz = 5 + Math.min(4, Math.log10(1 + (n.mentions || 1)) * 1.6);
            iconNews(octx, pt[0], pt[1], sz, hex);
            pushHit(pt[0], pt[1], Math.max(5, sz * 0.55), 'news', n);
          } else {
            const r = 1.2 + Math.min(3.2, Math.log10(1 + (n.mentions || 1)));
            octx.fillStyle = hex;
            octx.beginPath();
            octx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
            octx.fill();
            pushHit(pt[0], pt[1], Math.max(5, r + 1.5), 'news', n);
          }
        }
        octx.restore();
      }

      // Internet outages (Cloudflare Radar). Pulsing ring at the outage
      // country's polygon centroid (from Natural Earth, already loaded for
      // hit-testing). Ongoing outages pulse brighter; resolved ones render
      // as a dim static ring. Multiple outages in the same country stack
      // horizontally so each remains clickable.
      if (layers.outages !== false && Array.isArray(data.outages) && data.outages.length) {
        // Build ISO2 → centroid map lazily. Natural Earth's polygon
        // features give us a centroid that respects the real country
        // shape (matters for elongated or multi-part countries like USA,
        // Russia, Indonesia).
        if (!countryCentroidsRef.current && countryFeaturesRef.current) {
          const m = new Map();
          for (const f of countryFeaturesRef.current) {
            const p = f.properties || {};
            const code = p.ISO_A2 || p.iso_a2;
            if (!code || code === '-99') continue;
            try {
              const c = d3.geoCentroid(f);
              if (isFinite(c[0]) && isFinite(c[1])) m.set(code.toUpperCase(), c);
            } catch {}
          }
          countryCentroidsRef.current = m;
        }
        const centroids = countryCentroidsRef.current;
        if (centroids) {
          // Group outages by anchor so we can fan them out when a country
          // has several simultaneous incidents (Sudan, Yemen etc. often
          // carry 3-5 ongoing).
          const byAnchor = new Map();
          for (const o of data.outages) {
            const code = (o.anchor || '').toUpperCase();
            if (!code) continue;
            const c = centroids.get(code);
            if (!c) continue;
            if (!visibleOn(projection, c[0], c[1])) continue;
            const arr = byAnchor.get(code) || [];
            arr.push(o);
            byAnchor.set(code, arr);
          }
          // Slower, gentler pulse than before. Old period (~3.7 s, alpha
          // 0..0.55) felt twitchy on a globe with multiple ongoing
          // outages all blinking out of phase.
          const pulse = (Math.sin(now / 1200) + 1) * 0.5; // 0..1, ~7.5 s period
          for (const [code, list] of byAnchor) {
            const c = centroids.get(code);
            const pt = projection([c[0], c[1]]);
            if (!pt) continue;
            // Fan multiple outages around the centroid so they remain
            // individually clickable.
            const span = Math.min(24, list.length * 10);
            for (let i = 0; i < list.length; i++) {
              const o = list[i];
              const off = list.length === 1 ? 0 : (i / (list.length - 1) - 0.5) * span;
              const px = pt[0] + off, py = pt[1];
              // Cause-specific hue. Cloudflare Radar's cause enum has grown
              // over time; we match each observed value explicitly so new
              // causes don't silently fall through to the "government
              // shutdown" red. Also match CABLE / CABLE_CUT interchangeably
              // since the feed has used both spellings over different
              // advisories.
              const cause = (o.cause || '').toUpperCase();
              const causeColor =
                cause === 'WEATHER'                     ? '#f59e0b' :   // amber
                cause === 'POWER_OUTAGE'                ? '#fb923c' :   // orange
                cause === 'CABLE' || cause === 'CABLE_CUT' ? '#a78bfa' : // violet
                cause === 'TECHNICAL_PROBLEM'           ? '#94a3b8' :   // slate
                cause === 'MILITARY_ACTION'             ? '#be123c' :   // dark red
                cause === 'CYBERATTACK'                 ? '#d946ef' :   // fuchsia
                cause === 'UNKNOWN' || cause === ''     ? '#64748b' :   // muted slate
                cause === 'GOVERNMENT_DIRECTED'         ? '#ef4444' :   // red
                /* default */                            '#ef4444';
              // Broken-signal glyph — reads as "interrupted connectivity"
              // rather than a plain dot, while keeping the cause color.
              iconOutage(octx, px, py, 10, causeColor);
              // Pulsing halo — ongoing incidents only. Resolved incidents
              // still render as the static icon so historical context
              // reads clearly when scrubbing the feed.
              if (o.ongoing) {
                // Smaller radius range, lower max alpha than before so
                // the halo reads as a soft breathing ring rather than a
                // strobe.
                const r = 4 + pulse * 4;
                const a = (1 - pulse) * 0.35;
                octx.strokeStyle = causeColor + Math.round(a * 255).toString(16).padStart(2, '0');
                octx.lineWidth = 1.0;
                octx.beginPath();
                octx.arc(px, py, r, 0, Math.PI * 2);
                octx.stroke();
              }
              pushHit(px, py, 7, 'outage', o);
            }
          }
        }
      }

      // Lightning strikes — quick bright flashes that fade over ~3 s.
      // Rendered on the overlay (which redraws every frame) so the fade
      // animation reads correctly. Hit regions are registered for every
      // strike still in its TTL window — strikes are short-lived but a
      // 3 s dwell at a fixed screen position is long enough to hover, and
      // without a hit region the bolt glyph is visually ambiguous with
      // generic "yellow dots" on the globe.
      if (layers.lightning && typeof window.getLightningStrikes === 'function') {
        const strikes = window.getLightningStrikes();
        const nowL = Date.now();
        const TTL = 3000;
        const BOLT_SIZE = 9; // px — readable but doesn't dominate city marks
        for (let i = 0; i < strikes.length; i++) {
          const s = strikes[i];
          const age = (nowL - s.t) / TTL;
          if (age < 0 || age >= 1) continue;
          if (!visibleOn(projection, s.lon, s.lat)) continue;
          const pt = projection([s.lon, s.lat]);
          if (!pt) continue;
          const alpha = Math.max(0, 1 - age);
          // Expanding halo — the "flash" of the strike. Two concentric
          // fills: a soft wide ring + a brighter inner ring give the
          // glow a sense of depth without an actual gradient fill.
          const haloR = 3 + age * 9;
          const haloAlpha = Math.max(0, (1 - age) * 0.55);
          octx.fillStyle = `rgba(254, 240, 138, ${(haloAlpha * 0.4).toFixed(3)})`;
          octx.beginPath();
          octx.arc(pt[0], pt[1], haloR, 0, Math.PI * 2);
          octx.fill();
          octx.fillStyle = `rgba(254, 240, 138, ${haloAlpha.toFixed(3)})`;
          octx.beginPath();
          octx.arc(pt[0], pt[1], haloR * 0.5, 0, Math.PI * 2);
          octx.fill();
          // Bolt glyph — stroke-then-fill on a single path so the dark
          // outline hugs the filled yellow. Gives the strike a legible
          // "lightning" shape instead of reading as a generic glow dot.
          iconBolt(octx, pt[0], pt[1], BOLT_SIZE);
          octx.strokeStyle = `rgba(15, 23, 42, ${(alpha * 0.7).toFixed(3)})`;
          octx.lineWidth = 0.8;
          octx.stroke();
          octx.fillStyle = `rgba(254, 240, 138, ${alpha.toFixed(3)})`;
          octx.fill();
          // Hit region. Payload carries `time` (not `t`) so the shared
          // "X ago" suffix at the bottom of the tooltip resolves; raw
          // lat/lon are kept for display.
          pushHit(pt[0], pt[1], Math.max(7, BOLT_SIZE), 'lightning',
                  { lat: s.lat, lon: s.lon, pol: s.pol || 0, time: s.t });
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
          if (mode === 'full' && hot) {
            // Soft halo + proper flame glyph for the significant detections
            // — these are the ones that read as "something's burning",
            // not just a density pixel in the cluster dot-cloud.
            octx.fillStyle = 'rgba(254, 215, 170, 0.18)';
            octx.beginPath();
            octx.arc(px, py, 6, 0, Math.PI * 2);
            octx.fill();
            iconFire(octx, px, py, 7, col);
          } else {
            // Dense cluster / lower-confidence: tiny dot so fire-line
            // patterns still read at regional zoom.
            const r = mode === 'full' ? 2.2 : mode === 'compact' ? 1.6 : 1.1;
            octx.fillStyle = col;
            octx.beginPath();
            octx.arc(px, py, r, 0, Math.PI * 2);
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

      // Data centers — PeeringDB colos + hyperscaler regions. Small square
      // markers so they read as "infrastructure" vs. point-event dots.
      // LOD-decimated because PeeringDB alone is ~4500 points; dense
      // metros (London, NYC, Frankfurt, Singapore) would otherwise merge
      // into solid blobs at world zoom.
      if (layers.infrastructure && layers.datacenters && datacentersRef.current && datacentersRef.current.length) {
        const dcColor = (src) => src === 'hyperscaler'
          ? 'rgba(186, 230, 253, 0.95)'   // cool light blue — cloud regions
          : 'rgba(94, 234, 212, 0.85)';    // teal — PeeringDB colos
        const dcPts = [];
        for (const d of datacentersRef.current) {
          if (typeof d.lat !== 'number' || typeof d.lon !== 'number') continue;
          // Operator filter — skip when this company is toggled off.
          // dcFilters may be undefined during first render; default to
          // "show everything" in that case.
          if (dcFilters && d.operator && dcFilters[d.operator] === false) continue;
          if (!visibleOn(projection, d.lon, d.lat)) continue;
          const pt = projection([d.lon, d.lat]); if (!pt) continue;
          dcPts.push({ px: pt[0], py: pt[1], d });
        }
        // Cell sizing tuned so hyperscaler region dots stay visible at
        // any zoom while PeeringDB's dense metros collapse at low zoom.
        const lod = classifyLOD(dcPts, Math.max(14, 22 / zoom));
        // Draw hyperscaler on top of PeeringDB: two-pass render, PeeringDB
        // first so cloud-region pins land on top of overlapping colos.
        for (let pass = 0; pass < 2; pass++) {
          const wantHyper = pass === 1;
          for (let i = 0; i < dcPts.length; i++) {
            const { px, py, d } = dcPts[i];
            const isHyper = d.source === 'hyperscaler';
            if (isHyper !== wantHyper) continue;
            const { mode } = lod[i];
            const col = dcColor(d.source);
            octx.fillStyle = col;
            const size = mode === 'full' ? (isHyper ? 4 : 2.5)
                       : mode === 'compact' ? 2
                       : 1.3;
            // Squares for hyperscaler (cloud regions are infra nodes),
            // circles for PeeringDB (colo facilities) — small visual
            // distinction without needing a legend.
            if (isHyper) {
              octx.fillRect(px - size/2, py - size/2, size, size);
            } else {
              octx.beginPath();
              octx.arc(px, py, size / 2, 0, Math.PI * 2);
              octx.fill();
            }
            // Only full-LOD items get hit regions — otherwise hovering
            // through a dense metro pops dossier every pixel.
            if (mode === 'full') {
              pushHit(px, py, Math.max(size, 4), 'datacenter', d);
            }
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
        const rendered = [];
        const fState = flightStateRef.current;
        const seenIds = new Set();
        const EASE_POS = 0.18;
        const EASE_HDG = 0.12;
        const DR_MAX_AGE_S = 120;   // stop extrapolating after 2 min stale

        // PASS 1: advance smoothing state for every flight and collect
        // visible candidates. Each candidate carries its computed cell
        // key so the claim passes below can do cheap lookups only.
        const candidates = [];
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

          // Early visibility cull before the dead-reckoning + ease math.
          // Skip the ~12 ops/flight for aircraft behind the horizon. Check
          // both the raw ADS-B position AND the eased display position so
          // flights rotating into view from either direction aren't missed.
          if (!visibleOn(projection, f.lon, f.lat) &&
              !visibleOn(projection, st.displayLon, st.displayLat)) continue;

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

          // --- Visibility + project with the eased position ---
          if (!visibleOn(projection, st.displayLon, st.displayLat)) continue;
          const pt = projection([st.displayLon, st.displayLat]); if (!pt) continue;
          const [px, py] = pt;
          const k = (Math.floor(px / flightCell) << 16) | (Math.floor(py / flightCell) & 0xffff);
          candidates.push({ f, st, px, py, hdg: st.displayHdg, cellKey: k });
        }

        // PASS 2a: incumbents keep their cells. If a flight owned this
        // cell last frame AND it's still the one mapping to that cell
        // now, reclaim it before any altitude-sort competition. Stops
        // a lower-altitude neighbour from being kicked out whenever a
        // higher-altitude flight briefly drifts across the grid line
        // into its cell — the "blinks in and out" flicker.
        const prevCellOwner = flightCellOwnerRef.current;
        const newCellOwner  = new Map();
        const claimed       = new Set();   // flight.id → added to `rendered`
        for (const c of candidates) {
          if (prevCellOwner.get(c.cellKey) === c.f.id && !newCellOwner.has(c.cellKey)) {
            newCellOwner.set(c.cellKey, c.f.id);
            claimed.add(c.f.id);
            pushTrail(flightHistRef.current, c.f.id, c.st.displayLon, c.st.displayLat);
            rendered.push({ f: c.f, px: c.px, py: c.py, hdg: c.hdg });
          }
        }
        // PASS 2b: fill still-unclaimed cells in altitude order.
        // `candidates` preserves the sort from `sorted`, so the first
        // candidate hitting a free cell wins it.
        for (const c of candidates) {
          if (claimed.has(c.f.id)) continue;
          if (newCellOwner.has(c.cellKey)) continue;
          newCellOwner.set(c.cellKey, c.f.id);
          pushTrail(flightHistRef.current, c.f.id, c.st.displayLon, c.st.displayLat);
          rendered.push({ f: c.f, px: c.px, py: c.py, hdg: c.hdg });
        }
        flightCellOwnerRef.current = newCellOwner;

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
            // Slow + gentle pulse. Old period was 400 ms (2.5 Hz strobe)
            // with a 27 % radius swing and 75 % alpha swing — on an
            // always-visible marker that read as constant flicker.
            // Now 3.2 s period, 15 % radius / 30 % alpha swing — reads
            // as a calm breathing ring.
            const pulse = 0.5 + 0.5*Math.sin(now/1600);
            octx.beginPath(); octx.arc(pt[0], pt[1], 11 + pulse*1.5, 0, Math.PI*2);
            octx.strokeStyle = `rgba(244,63,94,${0.30 + pulse*0.15})`;
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

      // Hover — compare the live ref to the last value we pushed into React
      // state. Using React state in the dep list here caused the entire RAF
      // loop to tear down and re-create on every mousemove, which was the
      // single biggest perf regression after the layer additions. Ref-to-ref
      // compare keeps the loop stable, and setHover still fires only when
      // the hover actually changes so the tooltip component doesn't churn.
      if (hoverRef.current !== hoverAppliedRef.current) {
        hoverAppliedRef.current = hoverRef.current;
        setHover(hoverRef.current);
      }

      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // `data`, `nowCursor`, and `focusTarget` intentionally omitted —
    // they're read via refs inside tick() so their high update rate
    // (SSE snapshots, 1 Hz clock, user selection) doesn't tear down
    // the entire frame loop and re-attach the pointer/wheel handlers
    // several times a second. That churn was the dominant cost during
    // zoom-in interactions.
  }, [width, height, theme, projection, layers, animationIntensity]);

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
          {hover._layer === 'cyclone' && (
            <span>{hover.classification ? `${hover.classification} ` : ''}{hover.name}{hover.intensityKt ? ` · ${Math.round(hover.intensityKt)} kt` : ''}{hover.pressureMb ? ` · ${Math.round(hover.pressureMb)} mb` : ''}</span>
          )}
          {hover._layer === 'outage' && (
            <span>{hover.ongoing ? 'Ongoing · ' : 'Resolved · '}{hover.locations?.[0]?.name || 'Outage'}{hover.cause ? ` · ${hover.cause.replace(/_/g, ' ').toLowerCase()}` : ''}</span>
          )}
          {hover._layer === 'reactor' && (
            <span>{hover.name}{hover.capacity ? ` · ${Math.round(hover.capacity)} MWe` : ''}{hover.status ? ` · ${hover.status.toLowerCase()}` : ''}</span>
          )}
          {hover._layer === 'plant' && (
            <span>{hover.name}{hover.capacity ? ` · ${Math.round(hover.capacity)} MW` : ''}{hover.fuel ? ` · ${hover.fuel.toLowerCase()}` : ''}</span>
          )}
          {hover._layer === 'fab' && (
            <span>{hover.operator} · {hover.name}{hover.node_nm ? ` · ${hover.node_nm} nm` : ''}</span>
          )}
          {hover._layer === 'refinery' && (
            <span>{hover.name}{hover.operator ? ` · ${hover.operator}` : ''}{hover.capacity_bpd ? ` · ${Math.round(hover.capacity_bpd).toLocaleString()} bpd` : ''}</span>
          )}
          {hover._layer === 'lng' && (
            <span>{hover.name}{hover.type ? ` · ${hover.type}` : ''}{hover.capacity_mtpa ? ` · ${hover.capacity_mtpa} mtpa` : ''}</span>
          )}
          {hover._layer === 'gasproc' && (
            <span>{hover.name}{hover.operator ? ` · ${hover.operator}` : ''}{hover.country ? ` · ${hover.country}` : ''}</span>
          )}
          {hover._layer === 'smelter' && (
            <span>{hover.name}{hover.kind ? ` · ${hover.kind}` : ''}{hover.operator ? ` · ${hover.operator}` : ''}</span>
          )}
          {hover._layer === 'mine' && (
            <span>{hover.name}{hover.resource ? ` · ${hover.resource}` : ''}{hover.operator ? ` · ${hover.operator}` : ''}</span>
          )}
          {hover._layer === 'cement' && (
            <span>{hover.name}{hover.operator ? ` · ${hover.operator}` : ''}{hover.country ? ` · ${hover.country}` : ''}</span>
          )}
          {hover._layer === 'military' && (
            <span>{hover.name}{hover.kind ? ` · ${hover.kind}` : ''}{hover.country ? ` · ${hover.country}` : ''}</span>
          )}
          {hover._layer === 'dam' && (
            <span>{hover.name}{hover.dam_type ? ` · ${hover.dam_type.replace(/_/g, ' ')}` : ''}{hover.height_m ? ` · ${hover.height_m} m` : ''}</span>
          )}
          {hover._layer === 'port' && (
            <span>{hover.name}{hover.cargo_type ? ` · ${hover.cargo_type}` : ''}{hover.teu_millions ? ` · ${hover.teu_millions}M TEU` : ''}</span>
          )}
          {hover._layer === 'pipeline' && (
            <span>{hover.name}{hover.type ? ` · ${hover.type}` : ''}{hover.length_km ? ` · ${Math.round(hover.length_km).toLocaleString()} km` : ''}</span>
          )}
          {hover._layer === 'news' && (
            <span>
              {hover.summary || ((hover.place || 'Unlocated') + ' · ' + (hover.eventName || 'Event'))}
              {' · '}
              {(hover.mentions || 1)}× mentions · tone {hover.tone?.toFixed?.(1) || '0.0'}
            </span>
          )}
          {hover._layer === 'fire' && (
            <span>Active fire · {hover.bright != null ? `${hover.bright} K` : 'thermal hotspot'}{hover.frp != null ? ` · FRP ${hover.frp}` : ''}</span>
          )}
          {hover._layer === 'datacenter' && (
            <span>{hover.operator ? `${hover.operator.toUpperCase()} · ` : ''}{hover.name}{hover.city ? ` · ${hover.city}` : ''}</span>
          )}
          {hover._layer === 'lightning' && (() => {
            // Blitzortung encodes strike polarity as a signed number:
            // positive = CG+ (rarer, higher peak current), negative = CG−
            // (the common cloud-to-ground form), 0 = polarity unresolved.
            const pol = hover.pol > 0 ? '+CG' : hover.pol < 0 ? '−CG' : 'polarity unknown';
            const coords = `${hover.lat?.toFixed(2)}, ${hover.lon?.toFixed(2)}`;
            return <span>Lightning strike · {pol} · {coords}</span>;
          })()}
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
