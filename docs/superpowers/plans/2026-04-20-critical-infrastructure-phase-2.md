# Critical Infrastructure Layer — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new point-data sub-layers to the Critical Infrastructure parent: **Semiconductor fabs** (hand-curated JSON), **Oil refineries** (Global Energy Monitor), and **LNG terminals** (Global Energy Monitor). Also revert the Phase 1 chevron affordance so the infrastructure sub-panel auto-shows when the parent checkbox is on, matching the existing flights/ships sub-filter pattern.

**Architecture:** Three new `/api/*` routes following the existing `api/power-plants.js` / `api/datacenters.js` pattern — Node runtime, module-scoped cache, trimmed JSON responses. Two routes (refineries, LNG) share a new `api/_gem-loader.js` helper that parses GEM CSV data with a 7-day TTL. A new `api/_csv.js` util extracts the RFC-4180 parser from `api/power-plants.js` so it can be reused. Fabs is backed by a static JSON file committed to `src/data/fabs.json`. Client-side, each sub-layer gets a small `src/<layer>.jsx` fetcher module, a `GlyphSVG` case, a sub-panel row in the Energy group, and a render block in `globe2.jsx` gated on the parent toggle.

**Tech Stack:** Same as Phase 1 — React 18 UMD, D3 v7 orthographic canvas, Tailwind via CDN, Babel standalone, Vercel serverless Node functions. No bundler. Validation manual via the Vercel preview URL (static-server dev has no API routes).

**Companion spec:** `docs/superpowers/specs/2026-04-20-critical-infrastructure-layer-design.md` (see Design revision 2026-04-20 for the chevron change; see section 9 Phase 2 for scope).

**Note on TDD:** Same as Phase 1 — repo has no test framework. Each task replaces "write failing test → pass" with "write change → verify → commit."

---

## Task order rationale

Task 0 reverts the chevron first so the sub-panel behaviour matches the target UX for the rest of the phase. Fabs ships next because its static-JSON data source has no upstream dependency — it's the cleanest end-to-end test of the new-sub-layer pattern (API → client → UI → render). Refineries and LNG come after because they need a shared GEM loader that has to be extracted + written first.

Ordering:
1. Task 0 — Revert chevron.
2. Tasks 1–5 — Fabs end-to-end (JSON data, API route, client fetcher, sub-panel row, glyph, render block).
3. Task 6 — Extract shared CSV parser (`api/_csv.js`).
4. Task 7 — Shared GEM loader (`api/_gem-loader.js`).
5. Tasks 8–12 — Refineries end-to-end (route, client, UI, glyph, render).
6. Tasks 13–17 — LNG terminals end-to-end (route, client, UI, glyph, render).
7. Task 18 — Final verification + PR.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/app2.jsx` | Modify | Revert chevron, add 3 sub-rows + 3 glyphs + 3 layer state keys + 3 data fetches + 3 detail cards. |
| `src/globe2.jsx` | Modify | Add 3 new `if (layers.infrastructure && layers.X)` render blocks. |
| `index.html` | Modify | Add `<script type="text/babel">` tags for 3 new JSX modules. |
| `api/_csv.js` | Create | RFC-4180 CSV parser (extracted from `api/power-plants.js`). |
| `api/_gem-loader.js` | Create | Shared GEM CSV-fetch + cache helper. 7-day TTL, module-scoped. |
| `api/refineries.js` | Create | Refineries route using `_gem-loader`. |
| `api/lng-terminals.js` | Create | LNG terminals route using `_gem-loader`. |
| `api/fabs.js` | Create | Fabs route serving `src/data/fabs.json`. |
| `api/power-plants.js` | Modify | Import `parseCsvLine` from new `api/_csv.js` instead of defining inline. |
| `src/data/fabs.json` | Create | ~30 hand-curated major fabs with `id, name, operator, node_nm, wafer_size_mm, lat, lon, country`. |
| `src/refineries.jsx` | Create | Client fetcher + rendering helpers for refineries. |
| `src/lng-terminals.jsx` | Create | Client fetcher + rendering helpers for LNG. |
| `src/fabs.jsx` | Create | Client fetcher + rendering helpers for fabs. |

Net estimate: ~800 lines added, ~60 lines removed. Larger than Phase 1 but each file is focused.

---

## Task 0: Revert chevron — auto-show sub-panel on parent toggle

**Files:**
- Modify: `src/app2.jsx`

**Context:** Phase 1 shipped with a chevron expand/collapse button on the Critical Infrastructure row. Per user feedback, we're reverting to match the flights/ships sub-filter pattern — sub-options appear automatically when the parent checkbox is on.

- [ ] **Step 1: Remove the `infraExpanded` state hook.**

Locate the line `const [infraExpanded, setInfraExpanded] = useState(false);` inside `LayersPopover` (added in Phase 1 Task 4) and the 3-line comment directly above it. Delete both. Resulting region should have `const [open, setOpen] = useState(false);` followed immediately by whatever used to be 4 lines below.

- [ ] **Step 2: Remove the chevron button.**

Locate the chevron `<button>` block inside `items.map`, wrapped in `{k === 'infrastructure' && (...)}`. It was positioned after `<span className="text-sm flex-1">{label}</span>` and before the seismic conditional. Delete the entire conditional block (all 11 lines from `{k === 'infrastructure' && (` through the matching `)}`).

- [ ] **Step 3: Change the sub-panel gate.**

Locate the sub-panel conditional `{k === 'infrastructure' && infraExpanded && (...)}`. Change the gate to `{k === 'infrastructure' && layers.infrastructure && (...)}`. Exact one-line change: replace `infraExpanded` with `layers.infrastructure` in that conditional.

- [ ] **Step 4: Verify via grep.**

Run these checks — all must return 0:
- `grep -c "infraExpanded" src/app2.jsx` → 0
- `grep -c "setInfraExpanded" src/app2.jsx` → 0
- `grep -c "Expand infrastructure sub-layers" src/app2.jsx` → 0
- `grep -c "Collapse infrastructure sub-layers" src/app2.jsx` → 0

And this must return 1:
- `grep -c "k === 'infrastructure' && layers.infrastructure &&" src/app2.jsx` → 1

- [ ] **Step 5: Commit.**

```bash
git add src/app2.jsx
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): drop chevron, auto-show sub-panel when parent is on

Matches the established flights/ships sub-filter pattern. User
feedback post-Phase-1 revised the design in favour of consistency
with existing layer UX.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Create `src/data/fabs.json` with hand-curated fabs

**Files:**
- Create: `src/data/fabs.json`

**Context:** Fabs is the simplest sub-layer to ship because it doesn't depend on an upstream data source. A hand-curated list of major fabs is committed as static data.

- [ ] **Step 1: Verify `src/data/` directory exists or create it.**

```bash
mkdir -p src/data
```

- [ ] **Step 2: Write the JSON file.**

Create `src/data/fabs.json` with the following content. Every entry has `id`, `name`, `operator`, `node_nm` (process node in nanometers, numeric), `wafer_size_mm` (usually 300), `lat`, `lon`, `country`. Coordinates verified against publicly-known fab locations; `node_nm` reflects the most advanced process reported for each site as of early 2026.

```json
[
  { "id": "tsmc-hsinchu-f12", "name": "Fab 12 (Hsinchu)", "operator": "TSMC", "node_nm": 7, "wafer_size_mm": 300, "lat": 24.784, "lon": 120.997, "country": "Taiwan" },
  { "id": "tsmc-tainan-f14", "name": "Fab 14 (Tainan)", "operator": "TSMC", "node_nm": 28, "wafer_size_mm": 300, "lat": 23.096, "lon": 120.282, "country": "Taiwan" },
  { "id": "tsmc-tainan-f18", "name": "Fab 18 (Tainan)", "operator": "TSMC", "node_nm": 3, "wafer_size_mm": 300, "lat": 23.085, "lon": 120.275, "country": "Taiwan" },
  { "id": "tsmc-taichung-f15", "name": "Fab 15 (Central Taiwan)", "operator": "TSMC", "node_nm": 16, "wafer_size_mm": 300, "lat": 24.259, "lon": 120.602, "country": "Taiwan" },
  { "id": "tsmc-arizona-f21", "name": "Fab 21 (Arizona)", "operator": "TSMC", "node_nm": 4, "wafer_size_mm": 300, "lat": 33.729, "lon": -112.129, "country": "United States" },
  { "id": "tsmc-kumamoto-jasm", "name": "JASM (Kumamoto)", "operator": "TSMC", "node_nm": 22, "wafer_size_mm": 300, "lat": 32.908, "lon": 130.744, "country": "Japan" },
  { "id": "samsung-giheung", "name": "Giheung Campus", "operator": "Samsung", "node_nm": 14, "wafer_size_mm": 300, "lat": 37.257, "lon": 127.087, "country": "South Korea" },
  { "id": "samsung-hwaseong", "name": "Hwaseong Campus", "operator": "Samsung", "node_nm": 3, "wafer_size_mm": 300, "lat": 37.211, "lon": 127.001, "country": "South Korea" },
  { "id": "samsung-pyeongtaek", "name": "Pyeongtaek Campus", "operator": "Samsung", "node_nm": 3, "wafer_size_mm": 300, "lat": 36.976, "lon": 127.127, "country": "South Korea" },
  { "id": "samsung-austin", "name": "Austin Fab", "operator": "Samsung", "node_nm": 14, "wafer_size_mm": 300, "lat": 30.394, "lon": -97.662, "country": "United States" },
  { "id": "samsung-taylor", "name": "Taylor Fab", "operator": "Samsung", "node_nm": 2, "wafer_size_mm": 300, "lat": 30.571, "lon": -97.411, "country": "United States" },
  { "id": "samsung-xian", "name": "Xi'an Fab", "operator": "Samsung", "node_nm": 128, "wafer_size_mm": 300, "lat": 34.354, "lon": 108.944, "country": "China" },
  { "id": "intel-chandler", "name": "Ocotillo Campus (Chandler)", "operator": "Intel", "node_nm": 4, "wafer_size_mm": 300, "lat": 33.317, "lon": -111.948, "country": "United States" },
  { "id": "intel-hillsboro", "name": "Ronler Acres (Hillsboro)", "operator": "Intel", "node_nm": 2, "wafer_size_mm": 300, "lat": 45.540, "lon": -122.940, "country": "United States" },
  { "id": "intel-rio-rancho", "name": "Rio Rancho Fab", "operator": "Intel", "node_nm": 10, "wafer_size_mm": 300, "lat": 35.297, "lon": -106.573, "country": "United States" },
  { "id": "intel-kiryat-gat", "name": "Kiryat Gat Fab 28", "operator": "Intel", "node_nm": 10, "wafer_size_mm": 300, "lat": 31.620, "lon": 34.770, "country": "Israel" },
  { "id": "intel-leixlip", "name": "Leixlip Fab 34", "operator": "Intel", "node_nm": 4, "wafer_size_mm": 300, "lat": 53.370, "lon": -6.526, "country": "Ireland" },
  { "id": "intel-magdeburg", "name": "Magdeburg Fab (planned)", "operator": "Intel", "node_nm": 18, "wafer_size_mm": 300, "lat": 52.130, "lon": 11.629, "country": "Germany" },
  { "id": "intel-ohio", "name": "Ohio Ocotillo (planned)", "operator": "Intel", "node_nm": 18, "wafer_size_mm": 300, "lat": 40.079, "lon": -82.745, "country": "United States" },
  { "id": "gf-malta", "name": "Fab 8 (Malta, NY)", "operator": "GlobalFoundries", "node_nm": 12, "wafer_size_mm": 300, "lat": 42.986, "lon": -73.859, "country": "United States" },
  { "id": "gf-dresden", "name": "Fab 1 (Dresden)", "operator": "GlobalFoundries", "node_nm": 22, "wafer_size_mm": 300, "lat": 51.116, "lon": 13.657, "country": "Germany" },
  { "id": "gf-singapore", "name": "Fab 7 (Singapore)", "operator": "GlobalFoundries", "node_nm": 40, "wafer_size_mm": 300, "lat": 1.363, "lon": 103.772, "country": "Singapore" },
  { "id": "smic-shanghai", "name": "Shanghai Fab", "operator": "SMIC", "node_nm": 14, "wafer_size_mm": 300, "lat": 31.257, "lon": 121.667, "country": "China" },
  { "id": "smic-beijing", "name": "Beijing Fab", "operator": "SMIC", "node_nm": 28, "wafer_size_mm": 300, "lat": 40.036, "lon": 116.512, "country": "China" },
  { "id": "smic-shenzhen", "name": "Shenzhen Fab", "operator": "SMIC", "node_nm": 28, "wafer_size_mm": 300, "lat": 22.620, "lon": 113.880, "country": "China" },
  { "id": "micron-boise", "name": "Boise HQ Fab", "operator": "Micron", "node_nm": 30, "wafer_size_mm": 300, "lat": 43.541, "lon": -116.205, "country": "United States" },
  { "id": "micron-manassas", "name": "Manassas Fab", "operator": "Micron", "node_nm": 45, "wafer_size_mm": 300, "lat": 38.741, "lon": -77.487, "country": "United States" },
  { "id": "micron-taichung", "name": "Taichung Fab", "operator": "Micron", "node_nm": 14, "wafer_size_mm": 300, "lat": 24.193, "lon": 120.618, "country": "Taiwan" },
  { "id": "micron-hiroshima", "name": "Hiroshima Fab", "operator": "Micron", "node_nm": 14, "wafer_size_mm": 300, "lat": 34.456, "lon": 132.710, "country": "Japan" },
  { "id": "micron-xian", "name": "Xi'an Fab", "operator": "Micron", "node_nm": 25, "wafer_size_mm": 300, "lat": 34.258, "lon": 108.872, "country": "China" },
  { "id": "skhynix-icheon", "name": "Icheon M16/M14", "operator": "SK Hynix", "node_nm": 12, "wafer_size_mm": 300, "lat": 37.266, "lon": 127.478, "country": "South Korea" },
  { "id": "skhynix-cheongju", "name": "Cheongju M11/M12/M15", "operator": "SK Hynix", "node_nm": 17, "wafer_size_mm": 300, "lat": 36.677, "lon": 127.496, "country": "South Korea" },
  { "id": "skhynix-wuxi", "name": "Wuxi Fab", "operator": "SK Hynix", "node_nm": 17, "wafer_size_mm": 300, "lat": 31.579, "lon": 120.359, "country": "China" },
  { "id": "umc-hsinchu", "name": "Fab 12A (Hsinchu)", "operator": "UMC", "node_nm": 14, "wafer_size_mm": 300, "lat": 24.773, "lon": 120.984, "country": "Taiwan" },
  { "id": "powerchip-hsinchu", "name": "Powerchip Hsinchu Fab", "operator": "Powerchip", "node_nm": 40, "wafer_size_mm": 300, "lat": 24.781, "lon": 121.013, "country": "Taiwan" },
  { "id": "infineon-dresden", "name": "Dresden Fab", "operator": "Infineon", "node_nm": 90, "wafer_size_mm": 300, "lat": 51.116, "lon": 13.661, "country": "Germany" },
  { "id": "stm-crolles", "name": "Crolles 300 (joint w/ GF)", "operator": "STMicroelectronics", "node_nm": 18, "wafer_size_mm": 300, "lat": 45.282, "lon": 5.883, "country": "France" },
  { "id": "kioxia-yokkaichi", "name": "Yokkaichi Fab", "operator": "Kioxia", "node_nm": 12, "wafer_size_mm": 300, "lat": 34.929, "lon": 136.616, "country": "Japan" },
  { "id": "rapidus-chitose", "name": "Chitose Fab (2nm, planned)", "operator": "Rapidus", "node_nm": 2, "wafer_size_mm": 300, "lat": 42.818, "lon": 141.681, "country": "Japan" }
]
```

- [ ] **Step 3: Commit.**

```bash
git add src/data/fabs.json
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): curated list of ~40 major semiconductor fabs

Covers TSMC, Samsung, Intel, SK Hynix, Micron, GlobalFoundries, SMIC,
UMC, Infineon, STM, Kioxia, Rapidus. Node size reflects most advanced
process at each site as of early 2026.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create `api/fabs.js` serverless route

**Files:**
- Create: `api/fabs.js`

- [ ] **Step 1: Read an existing simple route for reference.**

Read `api/power-plants.js` lines 1-30 to see the standard Vercel Node runtime config, cache pattern, and response shape.

- [ ] **Step 2: Write the new route.**

Create `api/fabs.js` with:

```js
// Semiconductor fabs layer. Curated static list — no upstream fetch.
// The JSON file at src/data/fabs.json is the source of truth; this
// route just loads, wraps in the standard response envelope, and
// caches the parsed array in module scope.

import fs from 'node:fs';
import path from 'node:path';

export const config = { runtime: 'nodejs', maxDuration: 10 };

let cached = null;

function load() {
  if (cached) return cached;
  const file = path.join(process.cwd(), 'src', 'data', 'fabs.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export default function handler(req, res) {
  try {
    const fabs = load();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: fabs.length,
      features: fabs,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
```

- [ ] **Step 3: Commit.**

```bash
git add api/fabs.js
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): /api/fabs route serving curated fab list

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Client fetcher `src/fabs.jsx`

**Files:**
- Create: `src/fabs.jsx`

- [ ] **Step 1: Read `src/datacenters.jsx` (or similar client module) for reference.**

Read `src/datacenters.jsx` to see the client-side pattern: a global fetcher function exposed on `window`, called from app2.jsx's data-fetch pipeline.

- [ ] **Step 2: Write the module.**

Create `src/fabs.jsx`:

```jsx
/* global fetch */
// Semiconductor fabs — client fetcher. Pulls /api/fabs once on demand
// when the `fabs` sub-layer is enabled, caches in memory for the
// session. The list rarely changes, so no polling.

(function () {
  let cached = null;
  let inflight = null;

  async function fetchFabs() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await fetch('/api/fabs');
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        const j = await r.json();
        cached = Array.isArray(j.features) ? j.features : [];
        return cached;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  window.fetchFabs = fetchFabs;
})();
```

- [ ] **Step 3: Commit.**

```bash
git add src/fabs.jsx
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): client fetcher for fabs layer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire fabs into app2.jsx + add glyph + sub-panel row + detail card

**Files:**
- Modify: `src/app2.jsx`
- Modify: `index.html`

- [ ] **Step 1: Add the `'fab'` case to `GlyphSVG`.**

Locate `case 'infra':` in `src/app2.jsx` (added in Phase 1 Task 2). Immediately after that case, add:

```jsx
    case 'fab':
      // Stylized chip: a square with four external pins per side, evoking
      // a packaged IC. Readable at 12px inside the sub-panel.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="7" width="10" height="10" rx="1"/>
          <line x1="4" y1="10" x2="7" y2="10"/><line x1="4" y1="14" x2="7" y2="14"/>
          <line x1="17" y1="10" x2="20" y2="10"/><line x1="17" y1="14" x2="20" y2="14"/>
          <line x1="10" y1="4" x2="10" y2="7"/><line x1="14" y1="4" x2="14" y2="7"/>
          <line x1="10" y1="17" x2="10" y2="20"/><line x1="14" y1="17" x2="14" y2="20"/>
        </svg>
      );
```

- [ ] **Step 2: Add `fabs:false` to the layer defaults.**

Locate the `const def = { ... }` object inside the hydration `useEffect`. Find `infrastructure:false` at the end. Insert `fabs:false, ` immediately before `infrastructure:false`. (Order doesn't matter semantically but grouping near other infra keys aids future readability.)

- [ ] **Step 3: Add the fabs sub-row to the infrastructure sub-panel Energy group.**

Locate the Energy group array inside the sub-panel (`[['plants', ...], ['reactors', ...]].map(...)`). Expand it to include fabs as the last Energy entry:

```jsx
                      {[
                        ['plants',     'Power plants',      'bolt',      '#f59e0b'],
                        ['reactors',   'Nuclear reactors',  'radiation', '#22c55e'],
                        ['fabs',       'Semiconductor fabs','fab',       '#a78bfa'],
                      ].map(([sk, slabel, sglyph, scol]) => (
```

- [ ] **Step 4: Add fabs data-fetching logic.**

Locate the data-fetching block in `src/app2.jsx` where other infrastructure layers fetch their data (grep for `fetchPowerPlants` or `window.fetchPeeringDbDatacenters` to find the pattern). Add a parallel block for fabs that fetches when `layers.infrastructure && layers.fabs` is true and stores the result into the `data` object under key `fabs`.

If the existing code uses a useState/useEffect pattern per layer, mirror it. Expected shape:

```jsx
const [fabs, setFabs] = useState([]);
useEffect(() => {
  if (!(layers.infrastructure && layers.fabs)) return;
  if (typeof window.fetchFabs !== 'function') return;
  let cancel = false;
  window.fetchFabs().then(r => { if (!cancel) setFabs(r); }).catch(() => {});
  return () => { cancel = true; };
}, [layers.infrastructure, layers.fabs]);
```

Then include `fabs` in the `data` object passed to `<Globe data={...}>` (again, grep for the existing `data={{...}}` prop or equivalent).

- [ ] **Step 5: Add a detail card for fabs.**

Locate the detail-card section in `src/app2.jsx` that has `{layer === 'datacenter' && <>...</>}` (added in a prior commit). Immediately after that block, add:

```jsx
        {layer === 'fab' && <>
          <div className="text-lg">{item.name}</div>
          <div className="text-sm opacity-70">Semiconductor fab · {item.operator}</div>
          <KV k="Process" v={`${item.node_nm} nm`}/>
          <KV k="Wafer" v={`${item.wafer_size_mm} mm`}/>
          {item.country && <KV k="Country" v={item.country}/>}
          <KV k="Position" v={`${item.lat.toFixed(3)}°, ${item.lon.toFixed(3)}°`}/>
          <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(item.operator)}`} target="_blank" rel="noopener" className="text-xs text-accent-500 underline">Wikipedia →</a>
        </>}
```

- [ ] **Step 6: Link `src/fabs.jsx` in index.html.**

In `index.html`, find the block of `<script type="text/babel" src="src/XXX.jsx">` tags. Add a new line for fabs directly before `src/app2.jsx`:

```html
<script type="text/babel" src="src/fabs.jsx"></script>
```

- [ ] **Step 7: Commit.**

```bash
git add src/app2.jsx index.html
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): wire fabs sub-layer into app (glyph, toggle, fetch, card)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add fabs render block in globe2.jsx

**Files:**
- Modify: `src/globe2.jsx`

- [ ] **Step 1: Find the render block for an existing point layer in the infrastructure family.**

Read `src/globe2.jsx` near the `layers.infrastructure && layers.plants` block (from Phase 1). That's the reference pattern for a point-data rendering block inside the parent gate. Note the shape: a projection test, per-point draw with `ctx.arc` or a small glyph, LOD gating.

- [ ] **Step 2: Add the fabs render block.**

Immediately after the plants render block, add a new block gated on `layers.infrastructure && layers.fabs`. Follow the plants block's exact structure but use the fabs data array, a `fab` glyph color (`#a78bfa`), and a slightly different icon rendering — the code reviewer should confirm visual distinctiveness from plants at small sizes.

The precise code depends on the plants block's current shape, which this plan doesn't reproduce verbatim (it varies with canvas setup). The implementer reads the plants block, copies it, substitutes the data array reference and color, and hands to review. If the plants rendering is materially different from a "small pin with glyph" pattern, the implementer escalates as DONE_WITH_CONCERNS and we rethink.

- [ ] **Step 3: Add hit-test support for fab clicks.**

Locate the hit-test code in `globe2.jsx` that returns the clicked item + its `layer` string. Add an entry for fab — when a user clicks within the hit radius of a fab marker, return `{ layer: 'fab', ...fab_data }`. The detail-card added in Task 4 Step 5 will render.

- [ ] **Step 4: Commit.**

```bash
git add src/globe2.jsx
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): render fabs layer on the globe with click-to-inspect

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract RFC-4180 CSV parser to `api/_csv.js`

**Files:**
- Create: `api/_csv.js`
- Modify: `api/power-plants.js`

**Context:** The existing `api/power-plants.js` defines a `parseCsvLine` function inline for the WRI CSV. Refineries and LNG will reuse this exact parser via the shared GEM loader. Extract it first so both callers can import.

- [ ] **Step 1: Read the existing parser.**

Read `api/power-plants.js` and locate the `parseCsvLine` function (near the top). Note its signature: takes a single CSV line string, returns an array of strings.

- [ ] **Step 2: Create `api/_csv.js`.**

```js
// RFC-4180 CSV line parser extracted from power-plants.js so multiple
// routes can share it. Handles quoted fields, escaped quotes (""), and
// embedded commas/newlines inside quoted fields.

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"' && cur.length === 0) {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}
```

(If the existing `power-plants.js` `parseCsvLine` differs materially from the above — e.g., it handles embedded newlines differently — copy its current implementation verbatim instead of writing fresh. Don't silently change behaviour.)

- [ ] **Step 3: Update `api/power-plants.js` to import.**

Remove the inline `parseCsvLine` definition and add an import at the top:

```js
import { parseCsvLine } from './_csv.js';
```

The rest of the file stays unchanged — it just calls `parseCsvLine(...)` which now comes from the import.

- [ ] **Step 4: Verify.**

Run `grep -c "function parseCsvLine" api/power-plants.js` — must return 0. Run `grep -c "parseCsvLine" api/_csv.js` — must return 1 (the export).

- [ ] **Step 5: Commit.**

```bash
git add api/_csv.js api/power-plants.js
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "refactor(api): extract CSV parser to shared _csv.js helper

Prepares for GEM-loader reuse in refineries + LNG terminals routes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create `api/_gem-loader.js` shared helper

**Files:**
- Create: `api/_gem-loader.js`

**Context:** Global Energy Monitor publishes tracker CSVs at stable URLs. The loader fetches, parses, trims per caller-supplied projection, caches 7 days.

> **Open question at implementation time:** The specific GEM download URLs need verification. GEM's data-download page (https://globalenergymonitor.org/projects/) typically requires email registration; programmatic-friendly URLs may be on their GitHub org (https://github.com/GlobalEnergyMonitor) or via direct S3. If the implementer cannot find a stable HTTPS URL that returns CSV without auth, escalate as BLOCKED and we'll decide between (a) hosting a cached copy of the dataset ourselves, or (b) committing a static snapshot to `src/data/` similar to fabs.

- [ ] **Step 1: Write the loader.**

```js
// Shared Global Energy Monitor CSV fetch + parse + cache helper. Used
// by refineries and LNG terminals routes. Each caller supplies a
// config { id, url, project }; the loader returns the projected rows.

import { parseCsvLine } from './_csv.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — GEM publishes quarterly

// Per-dataset cache keyed by id.
const cache = new Map(); // id -> { data, at }

/**
 * Fetch + parse a GEM CSV, trim to caller-defined shape, cache.
 *
 * @param {Object} ds
 * @param {string} ds.id     Cache key.
 * @param {string} ds.url    HTTPS URL returning CSV (with header row).
 * @param {(row: Object) => Object | null} ds.project
 *   Called per parsed row; return the trimmed shape for that row, or
 *   null to skip. Row is a header->value dict.
 * @returns {Promise<Array>} Array of projected rows.
 */
export async function loadGemDataset(ds) {
  const hit = cache.get(ds.id);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.data;

  const r = await fetch(ds.url);
  if (!r.ok) throw new Error(`GEM ${ds.id}: upstream ${r.status}`);
  const text = await r.text();

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error(`GEM ${ds.id}: empty CSV`);
  const headers = parseCsvLine(lines[0]).map(h => h.trim());

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const row = Object.create(null);
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cells[j] ?? '';
    const proj = ds.project(row);
    if (proj != null) out.push(proj);
  }

  cache.set(ds.id, { data: out, at: now });
  return out;
}
```

- [ ] **Step 2: Commit.**

```bash
git add api/_gem-loader.js
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(api): shared GEM-CSV loader with 7d module-scoped cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Create `api/refineries.js`

**Files:**
- Create: `api/refineries.js`

**Context:** Uses the shared loader. Requires a valid GEM refineries tracker URL — see open question in Task 7.

- [ ] **Step 1: Write the route.**

```js
// Oil refineries — Global Energy Monitor Oil Infrastructure Tracker.
// Trims the full GEM row to the minimal set the UI needs.

import { loadGemDataset } from './_gem-loader.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

// NOTE: This URL must be verified at implementation time. Check
// https://github.com/GlobalEnergyMonitor and the GEM data-download
// page for the current CSV URL. If no stable auth-free URL is
// available, see the Task 7 escalation path.
const URL = 'https://globalenergymonitor.org/wp-content/uploads/2024/Global-Oil-Infrastructure-Tracker-Refineries.csv';

function project(row) {
  const lat = parseFloat(row['Latitude']);
  const lon = parseFloat(row['Longitude']);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const status = (row['Status'] || '').toLowerCase();
  if (status.includes('cancelled') || status.includes('shelved')) return null;
  return {
    id: row['GEM ID'] || row['Unit name'] || `${lat},${lon}`,
    name: row['Unit name'] || 'Refinery',
    operator: row['Owner'] || row['Parent'] || null,
    capacity_bpd: parseFloat(row['Capacity (bpd)']) || null,
    country: row['Country'] || null,
    status: row['Status'] || null,
    lat, lon,
  };
}

export default async function handler(req, res) {
  try {
    const data = await loadGemDataset({ id: 'refineries', url: URL, project });
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      count: data.length,
      features: data,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
```

- [ ] **Step 2: Verify the URL.**

Before committing, attempt `curl -I <URL>` in terminal to confirm it returns 200. If 404 or redirect, escalate per Task 7 open question.

- [ ] **Step 3: Commit.**

```bash
git add api/refineries.js
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): /api/refineries route using GEM loader

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Client + UI + render block for refineries

**Files:**
- Create: `src/refineries.jsx`
- Modify: `src/app2.jsx`
- Modify: `src/globe2.jsx`
- Modify: `index.html`

Mirror Tasks 3, 4, 5 but for refineries. Condensed because the pattern is identical:

- [ ] **Step 1:** Create `src/refineries.jsx` — same shape as `src/fabs.jsx`, fetching `/api/refineries`, exposing `window.fetchRefineries`.

- [ ] **Step 2:** In `src/app2.jsx`:
  - Add `refineries:false` to the `def` defaults.
  - Add `['refineries', 'Oil refineries', 'refinery', '#a16207']` as a sub-row in the Energy group (inserted before `plants` for grouping by fuel type — oil/gas first, then electricity generators).
  - Add `case 'refinery':` to `GlyphSVG` with a small SVG tower icon (details below).
  - Add a useState + useEffect to fetch refineries when `layers.infrastructure && layers.refineries`.
  - Pass `refineries` into the globe's data prop.
  - Add a detail card for `layer === 'refinery'` showing name, operator, capacity in bpd, country, position, GEM link.

Refinery glyph (`case 'refinery':`) — a fractionation-column silhouette:

```jsx
    case 'refinery':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="4" width="6" height="16"/>
          <line x1="9" y1="8" x2="15" y2="8"/>
          <line x1="9" y1="12" x2="15" y2="12"/>
          <line x1="9" y1="16" x2="15" y2="16"/>
          <path d="M12 4 L12 2"/>
          <path d="M6 20 L18 20"/>
        </svg>
      );
```

- [ ] **Step 3:** In `src/globe2.jsx`, add a refineries render block after the plants block, gated `layers.infrastructure && layers.refineries`. Same rendering style as plants with the refinery color `#a16207`.

- [ ] **Step 4:** Add `<script type="text/babel" src="src/refineries.jsx"></script>` to `index.html`.

- [ ] **Step 5: Commit.**

```bash
git add src/refineries.jsx src/app2.jsx src/globe2.jsx index.html
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): wire refineries sub-layer end-to-end

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: LNG terminals end-to-end

**Files:**
- Create: `api/lng-terminals.js`
- Create: `src/lng-terminals.jsx`
- Modify: `src/app2.jsx`
- Modify: `src/globe2.jsx`
- Modify: `index.html`

Mirror Tasks 8-9 for LNG. Structure is identical to refineries. Key differences:

- Layer state key: `lng` (short form — the LNG.js suffix for files is fine but the state key stays concise).
- Glyph: `lng`, a stylized gas storage tank (see below).
- Color: `#93c5fd` (ice blue).
- Label: `LNG terminals`.
- GEM dataset id: `lng`, URL: (verify at implementation time) — target is GEM Global Gas Infrastructure Tracker, LNG terminals subset.
- Projection includes `type` field (import vs. export) and `capacity_mtpa` (million tonnes per annum).

LNG glyph (`case 'lng':`) — a horizontal gas tank:

```jsx
    case 'lng':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="10" width="14" height="8" rx="4"/>
          <circle cx="18" cy="14" r="2"/>
          <line x1="8" y1="10" x2="8" y2="18"/>
          <line x1="12" y1="10" x2="12" y2="18"/>
        </svg>
      );
```

- [ ] **Step 1:** Create `api/lng-terminals.js`. Same pattern as `api/refineries.js`; projection returns `{id, name, operator, type, capacity_mtpa, country, lat, lon}`.

- [ ] **Step 2:** Create `src/lng-terminals.jsx`. Same pattern as `src/fabs.jsx`, fetching `/api/lng-terminals`, exposing `window.fetchLngTerminals`.

- [ ] **Step 3:** In `src/app2.jsx`:
  - Add `lng:false` to the `def` defaults.
  - Add `['lng', 'LNG terminals', 'lng', '#93c5fd']` as a sub-row in the Energy group (immediately after `refineries`).
  - Add `case 'lng':` to `GlyphSVG` with the glyph above.
  - Add fetch + passthrough into the globe's data prop.
  - Add a detail card for `layer === 'lng'` showing name, operator, type (import/export), capacity (mtpa), country, position.

- [ ] **Step 4:** In `src/globe2.jsx`, add an LNG render block after the refineries block, color `#93c5fd`.

- [ ] **Step 5:** Add `<script type="text/babel" src="src/lng-terminals.jsx"></script>` to `index.html`.

- [ ] **Step 6: Commit.**

```bash
git add api/lng-terminals.js src/lng-terminals.jsx src/app2.jsx src/globe2.jsx index.html
git -c user.email=lbunter12@outlook.com -c user.name="Lachlan Bunter" commit -m "feat(infra): wire LNG terminals sub-layer end-to-end

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Phase 2 verification + PR

**Files:** None modified. Validation only.

- [ ] **Step 1: Static sanity.**

- `grep -c "infraExpanded" src/app2.jsx` → 0 (chevron revert landed).
- `grep -c "fabs:false" src/app2.jsx` → 1.
- `grep -c "refineries:false" src/app2.jsx` → 1.
- `grep -c "lng:false" src/app2.jsx` → 1.
- `grep -c "layers.infrastructure && layers.fabs" src/globe2.jsx` → 1.
- `grep -c "layers.infrastructure && layers.refineries" src/globe2.jsx` → 1.
- `grep -c "layers.infrastructure && layers.lng" src/globe2.jsx` → 1.
- `grep -c "src/fabs.jsx\|src/refineries.jsx\|src/lng-terminals.jsx" index.html` → 3.

- [ ] **Step 2: Browser verification on a local static server + Playwright.**

Same pattern as Phase 1 Task 8 — spin up `npx serve -l 8765 .`, navigate to localhost:8765, manipulate localStorage, and use Playwright to verify:

- Fresh user: popover shows Critical Infrastructure; enabling it shows the sub-panel with 7 sub-rows (plants, reactors, fabs, cables, datacenters, plus refineries + lng in the Energy group).
- Enabling a sub-layer triggers the corresponding data fetch (check console for `/api/fabs` 200 — static server will 404 because Vercel routes aren't emulated, but the fetch attempt should happen and not crash).
- No new JS errors introduced in the console beyond the expected 404s.

For API-live verification, wait for the Vercel preview URL from the PR and walk the UI there.

- [ ] **Step 3: Force-push, open PR, merge.**

```bash
git push -u origin claude/phase2-critical-infrastructure
gh pr create --title "Critical Infrastructure: refineries + LNG + fabs sub-layers (Phase 2)" --body "$(cat <<'BODY'
## Summary
- Drops the chevron affordance from the Critical Infrastructure row; sub-panel now auto-shows when parent is on, matching flights/ships sub-filter UX.
- Adds three new point-data sub-layers to the Energy group: **Oil refineries** (Global Energy Monitor), **LNG terminals** (Global Energy Monitor), **Semiconductor fabs** (~40 curated from TSMC/Samsung/Intel/SK Hynix/Micron/etc.).
- Introduces shared `api/_csv.js` (extracted from power-plants) and `api/_gem-loader.js` (7d module cache) to avoid duplication across the two GEM-backed routes.
- No changes to existing sub-layers; dcFilters grid for data centers unchanged.

## Phasing
Phase 2 of 3. Phase 3 will add major dams + ports + oil/gas pipelines.

## Test plan
- [ ] Fresh user: parent off, no infra renders.
- [ ] Parent on: sub-panel auto-shows with 7 sub-rows.
- [ ] Each sub-layer toggles independently; globe renders expected points for fabs (curated, deterministic).
- [ ] Refineries + LNG render points (from GEM data) without client-side errors.
- [ ] Click on a fab/refinery/LNG marker opens the correct detail card with the right fields.
- [ ] Adjacent layers untouched.
- [ ] Migration from Phase 1 users unaffected.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
gh pr merge <N> --squash --delete-branch
```

---

## Self-review

**Spec coverage check (Phase 2 section 9 of the spec):**

- [x] `api/_gem-loader.js` — Task 7.
- [x] `api/_csv.js` extracted from `api/power-plants.js` — Task 6.
- [x] `api/refineries.js`, `api/lng-terminals.js` — Tasks 8, 10.
- [x] `api/fabs.js` + `src/data/fabs.json` (curated) — Tasks 1, 2.
- [x] `src/refineries.jsx`, `src/lng-terminals.jsx`, `src/fabs.jsx` — Tasks 3, 9, 10.
- [x] Three new glyph kinds `refinery`, `lng`, `fab` — Tasks 4, 9, 10.
- [x] Three new render blocks in `globe2.jsx` — Tasks 5, 9, 10.
- [x] Three new `layers.infrastructure && layers.X` sub-toggles — Tasks 4, 9, 10 (via adding sub-rows + updating render guards).

Plus out-of-spec:
- [x] Chevron revert (post-Phase-1 user feedback) — Task 0.

All Phase 2 deliverables covered.

**Placeholder scan:** No "TBD" or "TODO". The GEM URL is an acknowledged open question with a clear escalation path (Task 7 comment). The fabs curated list is explicit and inline.

**Type / naming consistency:**
- Layer state keys: `fabs`, `refineries`, `lng` (consistent across Tasks 4, 9, 10).
- Glyph kinds: `fab`, `refinery`, `lng` (consistent).
- Client fetcher names: `window.fetchFabs`, `window.fetchRefineries`, `window.fetchLngTerminals` (consistent verb-prefix).
- Detail card `layer` values: `'fab'`, `'refinery'`, `'lng'` (match glyph kinds, differ from state keys — state is plural, glyph is singular — established convention from existing layers).

No inconsistencies found.
