# Critical Infrastructure Layer — Design

**Status:** Approved (brainstorm); Phase 1 shipped (#90); Phase 2 in planning
**Date:** 2026-04-20
**Scope:** UI refactor + 6 new data layers + migration
**Author:** Lachlan + Claude

## Design revision 2026-04-20 (post-Phase-1)

After Phase 1 shipped, the chevron-expand/collapse affordance was dropped in favour of the established app-wide pattern used by Flights and Ships sub-filters: **sub-options appear automatically when the parent layer's checkbox is on**, and disappear when it's off. There is no separate expand/collapse control.

Rationale: consistency with existing layer UX beats the additional vertical-space control the chevron was introduced to provide. The 10-item future sub-panel remains manageable when gated by the parent checkbox alone (users only expand a sub-panel by enabling the feature they want to see on the globe).

Sections 6.2 and 6.3 below describe the original chevron design; they are superseded by this revision. The revised behaviour is: the sub-panel renders as an indented block below the parent row **iff `layers.infrastructure === true`**. Phase 2 Task 0 removes the chevron UI + state hook from the Phase 1 code.

## 1. Summary

Introduce a single top-level `Critical Infrastructure` toggle in the LayersPopover that gates a nested panel of 10 sub-layers. Four of these sub-layers already exist and are being relocated from the flat top-level list (Power plants, Nuclear reactors, Submarine cables, Data centers). Six are new (Oil refineries, LNG terminals, Oil/gas pipelines, Semiconductor fabs, Major dams, Major ports).

The parent toggle is a master gate: parent OFF hides all sub-layers regardless of their individual state; parent ON lets each sub-checkbox render its own layer independently.

## 2. Goals

- Consolidate all fixed-location infrastructure beneath one top-level entry to reduce visual clutter in the LayersPopover (top-level rows: 20 → 17).
- Ship six new sub-layers covering the "fuel + materials" half of the infrastructure story, which is currently absent.
- Establish a reusable parent-toggle-with-sub-options pattern (the flights/ships sub-filter pattern is the closest precedent but has only 4–8 sub-items; this design scales to 10).
- Preserve existing users' layer preferences across the refactor.

## 3. Non-goals

- No per-facility status, availability, or operational telemetry. Locations and static metadata only. Rationale: no public data source offers consistent per-facility status across commercial colocation, refineries, fabs, dams, or ports.
- No steel / cement / aluminum plants, mines, or other heavy-industry categories beyond the six listed.
- No replacement of the existing `src/ports.jsx` lookup table. That module resolves AIS `Destination` strings on ship detail cards via `window.resolvePort`; it stays unchanged and independent.
- No changes to flights, ships, satellites, seismic, aurora, natural-events, lightning, fires, news, wind, ocean currents, cyclones, outages, or day/night layers.
- No pipeline flow direction, capacity, or fluid-type overlays beyond a static color per pipeline type.

## 4. Current state

### 4.1 Existing layer state model

`src/app2.jsx:1132` defines the layer default object as a flat map. The four affected keys currently live at the top level: `plants`, `reactors`, `cables`, `datacenters`. They all default to `false`.

### 4.2 Existing LayersPopover

`src/app2.jsx:321-342` defines 20 top-level entries as a flat `items` array of `[key, label, glyphKind, color]` tuples. Each entry renders as a checkbox row. Flights and Ships rows render additional sub-filter UI (`app2.jsx:400-444`) when their parent is toggled on. Those sub-filters are narrowing controls within a single data layer, not separate layers.

### 4.3 Existing infrastructure APIs

- `api/power-plants.js` — WRI Global Power Plant Database, ≥100 MW filter, 24h cache, ~10k features.
- `api/cables.js` — TeleGeography submarine cables, 6h cache, ~550 linestrings.
- `api/datacenters.js` — PeeringDB + curated hyperscaler regions, 24h cache, ~4,650 points.
- Nuclear reactors layer exists (key `reactors`). Its API route file is to be identified during plan phase (likely `api/reactors.js` or folded into `api/power-plants.js` via a type filter); the answer does not affect this design's shape.

All follow the same pattern: Node runtime, module-scoped cache, trimmed JSON response, SSE or standard fetch from client.

## 5. Sub-layer roster

Ten sub-layers, grouped into five visual sections (divider lines only, no headers):

### 5.1 Energy

| # | Sub-layer | Source | Filter | Est. features |
|---|---|---|---|---|
| 1 | Power plants | WRI GPPD (existing) | ≥100 MW | ~10,000 |
| 2 | Nuclear reactors | existing feed | — | ~440 |
| 3 | Oil refineries *(new)* | Global Energy Monitor Oil & Gas Plant Tracker, CC BY 4.0 | — | ~700 |
| 4 | LNG terminals *(new)* | GEM Global Gas Infrastructure Tracker | import + export terminals | ~200 |
| 5 | Oil/gas pipelines *(new)* | GEM Oil Pipeline Tracker + Gas Pipeline Tracker | segment length ≥ 50 km | ~2,500 |

### 5.2 Connectivity

| # | Sub-layer | Source | Filter | Est. features |
|---|---|---|---|---|
| 6 | Submarine cables | TeleGeography (existing) | — | ~550 |
| 7 | Data centers | PeeringDB + hyperscalers (existing) | — | ~4,650 |

### 5.3 Industrial

| # | Sub-layer | Source | Filter | Est. features |
|---|---|---|---|---|
| 8 | Semiconductor fabs *(new)* | Hand-curated JSON from SEMI + Wikipedia lists | major fabs only | ~100 |

### 5.4 Water

| # | Sub-layer | Source | Filter | Est. features |
|---|---|---|---|---|
| 9 | Major dams *(new)* | GRanD v1.3 (academic, CC BY) | reservoir volume > 1 km³ | ~1,500 |

### 5.5 Transport

| # | Sub-layer | Source | Filter | Est. features |
|---|---|---|---|---|
| 10 | Major ports *(new)* | NGA World Port Index (US public domain) | Harbor Size ∈ {Large, Very Large} | ~500 |

**Total new features across 6 new sub-layers:** ~5,500.

Pipelines is the only linestring sub-layer; all others are points.

## 6. UI design

### 6.1 Top-level LayersPopover

- The 4 existing infrastructure rows are removed from `src/app2.jsx:321-342` and replaced by a single new row: `['infrastructure', 'Critical Infrastructure', 'infra', '#94a3b8']`.
- New row is positioned at the index Power plants currently occupies (preserves muscle memory).
- Net effect: top-level list shrinks from 20 rows to 17.

### 6.2 Parent row layout

`[checkbox] [glyph] [label] ................. [chevron-button]`

- **Checkbox** = master gate. Toggling it does not change any sub-state.
- **Chevron button** = expand/collapse the sub-panel. Independent of the checkbox. Click stops propagation so it doesn't also toggle the checkbox.
- The chevron is visible regardless of checkbox state so users can inspect sub-options without enabling the layer.

### 6.3 Sub-panel (expanded)

- Rendered inline below the parent row (matching the visual idiom of flights/ships sub-filters at `app2.jsx:400-416`).
- Indentation: `pl-6 pr-2` to match existing sub-filter indent.
- Each sub-row: `[checkbox] [glyph] [label]`.
- Visual groups (Energy / Connectivity / Industrial / Water / Transport) separated by a thin divider (`border-t border-white/5` or equivalent Tailwind class). No group header text.
- Sub-panel default state: **collapsed**. User must click the chevron to see sub-options.

### 6.4 Default states

- `infrastructure`: `false`
- The 4 existing sub-keys (`plants`, `reactors`, `cables`, `datacenters`) retain their current `false` defaults.
- The 6 new sub-keys (`refineries`, `lng`, `pipelines`, `fabs`, `dams`, `ports`) default to `false`.
- Net effect: on a fresh install, the parent toggle is off and no infrastructure is visible until the user explicitly enables both the parent and one or more sub-items.

### 6.5 Migration rule for existing users

On the first app load running Phase 1 code, if persisted layer state from a pre-Phase-1 version contains any of `{plants, reactors, cables, datacenters} === true`, set `infrastructure = true` automatically. The migration is gated by a schema-version tag in persisted state so it runs exactly once per browser.

Implementation: a version-tagged migration step inside the layer-state hydration path. If no pre-Phase-1 persistence exists (new user or cleared state), the migration is skipped and defaults apply.

### 6.6 Parent-state propagation

The rendering condition for any infrastructure sub-layer becomes:

```js
if (layers.infrastructure && layers.plants && data.plants) { /* render */ }
```

No other code in `globe2.jsx` needs restructuring beyond adding the `layers.infrastructure &&` conjunct to each of the 10 sub-layer guards.

## 7. Server architecture

### 7.1 Shared GEM loader

New helper at `api/_gem-loader.js`, called by refineries, LNG, and pipelines routes. Responsibilities:

- Fetch GEM tracker CSV/XLSX from the configured upstream URL.
- Parse rows (GEM datasets are well-formed CSV; the existing RFC-4180 parser in `api/power-plants.js` can be extracted into a shared util at `api/_csv.js`).
- Trim to the per-dataset projection function supplied by the caller.
- Cache in module scope, keyed by dataset id, with a 7-day TTL.
- Return parsed + trimmed array to caller.

### 7.2 Per-sub-layer routes

| Route | Source of truth | Cache TTL |
|---|---|---|
| `api/refineries.js` | `_gem-loader` → GEM Oil & Gas Plant Tracker | 7 days |
| `api/lng-terminals.js` | `_gem-loader` → GEM Gas Infrastructure Tracker | 7 days |
| `api/pipelines.js` | `_gem-loader` → GEM Oil + Gas Pipeline Trackers | 7 days |
| `api/fabs.js` | `src/data/fabs.json` (hand-curated, committed) | N/A — static |
| `api/dams.js` | `src/data/dams-major.json` (pre-processed GRanD subset, committed) | N/A — static |
| `api/ports-major.js` | `src/data/ports-major.json` (pre-processed WPI subset, committed) | N/A — static |

Routes that serve committed static JSON still run through a Node handler (for CORS parity and future substitution) but skip upstream fetching entirely.

### 7.3 Response shape

Uniform across all new routes, matching existing infra route conventions:

```jsonc
{
  "generatedAt": "<ISO-8601>",
  "count": <integer>,
  "features": [
    { "id": "...", "name": "...", "lat": <number>, "lon": <number>, /* per-layer extras */ }
  ]
}
```

For pipelines, each feature replaces `lat`/`lon` with a `geometry` object containing a GeoJSON LineString, mirroring the `api/cables.js` response shape.

### 7.4 Data acquisition and pre-processing

- **GEM datasets** (refineries, LNG, pipelines): fetched live by server from GEM's public CSV URLs. No preprocessing checked in.
- **Fabs**: hand-curated JSON committed at `src/data/fabs.json`. Schema: `[{id, name, operator, node_nm, lat, lon, country, wafer_size_mm?}]`. Initial list sourced from SEMI and Wikipedia "List of semiconductor fabrication plants"; manually verified for lat/lon accuracy.
- **Dams**: one-off pre-processing script `scripts/build-dams.mjs` that downloads GRanD v1.3 GeoJSON, filters to `CAP_MCM > 1000` (1 km³ = 1000 Mm³), projects to `[id, name, river, country, lat, lon, cap_km3, height_m, year]`, writes `src/data/dams-major.json`. Script committed and runnable; output JSON also committed so production doesn't depend on the script.
- **Ports**: one-off pre-processing script `scripts/build-ports-major.mjs` that downloads WPI (NGA Pub 150) CSV, filters to `Harbor Size ∈ {L, V}`, projects to `[id, name, country, lat, lon, harbor_type, harbor_size]`, writes `src/data/ports-major.json`. Same commit-the-output policy as dams.

## 8. Client architecture

### 8.1 New modules

Six new files in `src/`:

- `src/refineries.jsx`
- `src/lng-terminals.jsx`
- `src/pipelines.jsx`
- `src/fabs.jsx`
- `src/dams.jsx`
- `src/ports-major.jsx`

Each mirrors the structure of `src/datacenters.jsx` / `src/ocean-currents.jsx`: a fetcher function + a rendering helper called from `globe2.jsx`.

### 8.2 Rendering

- All point sub-layers follow the existing power-plants rendering pattern: projection check, zoom-based LOD (full render above zoom 1.2, dim below), click hit-test, hover tooltip, detail card on click.
- Pipelines follow the submarine-cables rendering pattern for linestrings: D3 path generation through the current projection, stroke styling, no fill.
- Color assignments avoid collisions with the existing 15-color layer palette. Proposed hex values:
  - Refineries: `#a16207` (rust brown)
  - LNG terminals: `#93c5fd` (ice blue)
  - Pipelines: `#d97706` (pipeline amber)
  - Fabs: `#a78bfa` (silicon purple)
  - Dams: `#3b82f6` (dam blue)
  - Ports: `#10b981` (sea green)

Final colors are tunable during Phase 2/3 implementation.

### 8.3 New glyph kinds

Six new `kind` values added to `GlyphSVG`: `refinery`, `lng`, `pipeline`, `fab`, `dam`, `port`, plus one more for the parent row: `infra`.

### 8.4 Detail card contents

Each sub-layer's click-detail card follows the layout established in `app2.jsx:774-790` (data centers). Fields per layer:

- Refineries: name, operator, capacity (bpd), country, position, GEM source link.
- LNG terminals: name, operator, type (import/export), capacity (mtpa), country, position, GEM source link.
- Pipelines: name, operator, fluid type (oil/gas), length (km), start/end country, GEM source link.
- Fabs: name, operator, process node (nm), wafer size (mm), country, position, Wikipedia link.
- Dams: name, river, country, capacity (km³), height (m), year completed, position, Wikipedia link.
- Ports: name, country, harbor size, harbor type, position, Wikipedia link.

## 9. PR phasing

### Phase 1 — UI refactor (no new data)

- Add `infrastructure` key to layer defaults.
- Add new `Critical Infrastructure` top-level entry to LayersPopover items.
- Remove `plants`, `reactors`, `cables`, `datacenters` from top-level items.
- Implement expand/collapse chevron + sub-panel rendering.
- Add `layers.infrastructure &&` conjunct to each of the 4 existing sub-layer render guards in `globe2.jsx`.
- Implement one-shot migration rule.
- Add `infra` glyph to `GlyphSVG`.

Expected diff: ~400 lines. Reviewable in one sitting.

### Phase 2 — Three point-data sub-layers

- `api/_gem-loader.js` helper.
- `api/_csv.js` extracted from existing `api/power-plants.js`.
- `api/refineries.js`, `api/lng-terminals.js`.
- `api/fabs.js` + `src/data/fabs.json` (curated).
- `src/refineries.jsx`, `src/lng-terminals.jsx`, `src/fabs.jsx`.
- Three new glyph kinds: `refinery`, `lng`, `fab`.
- Three new render blocks in `globe2.jsx`.
- Three new `layers.infrastructure && layers.X` sub-toggles.

Expected diff: ~600 lines + static JSON for fabs.

### Phase 3 — Dams, ports, pipelines

- `scripts/build-dams.mjs` + `src/data/dams-major.json`.
- `scripts/build-ports-major.mjs` + `src/data/ports-major.json`.
- `api/dams.js`, `api/ports-major.js`, `api/pipelines.js`.
- `src/dams.jsx`, `src/ports-major.jsx`, `src/pipelines.jsx`.
- Three new glyph kinds: `dam`, `port`, `pipeline`.
- Three new render blocks in `globe2.jsx` (pipelines reuses cables linestring code).

Expected diff: ~700 lines + static JSON for dams and ports.

## 10. Testing

No formal test suite exists in the repo. Validation is by manual visual inspection of the dev server + production deploy.

Phase-by-phase manual checklist:

- **Phase 1:** parent toggle gates all 4 existing infra layers correctly; chevron expands/collapses without side effects; migration fires exactly once for users with pre-existing `plants=true` (or similar); popover doesn't exceed viewport height.
- **Phase 2:** each of the three new sub-layers fetches and renders within 2s; hit-test and detail card work; no z-fighting with existing layers; icons are visually distinct at small size.
- **Phase 3:** same as Phase 2 plus pipelines render as smooth linestrings across the dateline; dam/port pre-processing scripts produce the same output on re-run (deterministic).

## 11. Open questions (non-blocking)

- Exact GEM tracker CSV URLs (they version their downloads; may need per-tracker pinning).
- Whether `Harbor Size` is the right WPI filter field versus `Overall Size` or `Channel Depth`; to be validated against the raw CSV.
- Whether nuclear reactors currently lives in its own API file (`api/reactors.js`?) or is folded into power-plants — plan phase needs to confirm exact file to adjust the parent-gate conjunct.
- Icon design — final SVGs for 7 new glyph kinds are implementation-time detail.

These do not affect the design's shape; they are resolved during plan writing or implementation.

## 12. Rollback plan

Each phase is an independent PR. If Phase 1's UX is rejected after deploy, revert the single PR — the 4 existing infra layers return to their top-level positions unchanged. Phase 2 and Phase 3 can each be reverted independently without touching the other two.
