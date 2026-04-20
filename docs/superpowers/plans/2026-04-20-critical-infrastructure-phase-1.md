# Critical Infrastructure Layer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `Critical Infrastructure` parent toggle in the LayersPopover that gates four existing infrastructure sub-layers (Power plants, Nuclear reactors, Submarine cables, Data centers). UI refactor only — no new data sources in this phase.

**Architecture:** Add a new top-level layer key `infrastructure` that acts as a master gate. The existing 4 sub-layer keys stay where they are in state; their render conditions gain a `layers.infrastructure &&` conjunct. UI adds an expand/collapse chevron on the parent row; the 4 sub-checkboxes render inline in the LayersPopover when expanded. A one-shot conditional migration opts existing users who had any infrastructure sub-layer enabled into the new parent.

**Tech Stack:** React 18 (UMD), Vanilla JSX, D3 v7 (for existing rendering, not touched in this phase), Tailwind CSS, localStorage for persistence. No test framework exists in the repo — validation is manual via the local dev server.

**Companion spec:** `docs/superpowers/specs/2026-04-20-critical-infrastructure-layer-design.md`

**Note on TDD:** The canonical test-first flow assumes a test runner is present. This repo has none and the design section explicitly defers to manual visual validation. Each task in this plan therefore replaces the "write failing test → pass" cycle with "write change → verify in browser → commit." This matches repo convention.

---

## File map

Only two source files are modified in Phase 1. Both already exist.

| File | What changes |
|---|---|
| `src/app2.jsx` | Add `infrastructure` to layer defaults; add migration in hydration effect; add `infra` glyph to `GlyphSVG`; restructure `LayersPopover` items array; add expand/collapse state; render chevron and sub-panel. |
| `src/globe2.jsx` | Add `layers.infrastructure &&` to the 4 existing sub-layer render guards (lines 1429, 2108, 2135, 2443). |

No new files in Phase 1.

---

## Task 1: Add `infrastructure` layer default + one-shot migration

**Files:**
- Modify: `src/app2.jsx:1127-1139`

- [ ] **Step 1: Read current hydration logic**

Read `src/app2.jsx` lines 1127-1139 to confirm the shape of the existing layer state hydration. You should see a `useState` initializer that parses `localStorage['ge-layers']` and a `useEffect` that merges defaults.

- [ ] **Step 2: Add `infrastructure: false` to defaults and migration logic**

Replace lines 1127-1139 with:

```jsx
  // Layers
  const [layers, setLayers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ge-layers')) || {}; } catch { return {}; }
  });
  useEffect(()=>{
    const def = { flights:true, ships:true, sats:true, iss:true, quakes:true, events:true, aurora:true, wiki:true, daynight:true, fires:true, lightning:true, tsunamis:false, wind:false, stormTracks:true, cyclones:true, outages:true, cables:false, reactors:false, plants:false, news:false, oceanCurrents:false, datacenters:false, infrastructure:false };
    // One-shot migration: users who had any infrastructure sub-layer enabled
    // before the parent toggle existed should have the parent auto-enabled
    // on first load of this version. Detect by: `infrastructure` key absent
    // from stored state AND at least one sub-layer true. Idempotent because
    // next load will have `infrastructure` in stored state.
    const anyOldInfra = layers.plants || layers.reactors || layers.cables || layers.datacenters;
    const needsMigration = layers.infrastructure === undefined && anyOldInfra;
    const merged = { ...def, ...layers, ...(needsMigration ? { infrastructure: true } : {}) };
    if (JSON.stringify(merged) !== JSON.stringify(layers)) setLayers(merged);
    localStorage.setItem('ge-layers', JSON.stringify(merged));
  }, [layers]);
```

- [ ] **Step 3: Verify in dev tools**

In a browser with the app loaded:
1. Open DevTools → Application → Local Storage.
2. Set `ge-layers` to `{"plants":true}` and reload.
3. Confirm `ge-layers` is now `{...,"plants":true,"infrastructure":true,...}`.
4. Set `ge-layers` to `{}` and reload.
5. Confirm `ge-layers` has `"infrastructure":false` (no migration — new user).

- [ ] **Step 4: Commit**

```bash
git add src/app2.jsx
git commit -m "feat(infra): add infrastructure layer key + migration"
```

---

## Task 2: Add `infra` glyph kind to `GlyphSVG`

**Files:**
- Modify: `src/app2.jsx:192-320` (end of `GlyphSVG` switch statement)

- [ ] **Step 1: Read current `GlyphSVG` component**

Read `src/app2.jsx:192-320` to see the existing `switch(kind)` with cases for `flight`, `sat`, `ship`, `iss`, `quake`, `fire`, `volcano`, `storm`, `ice`, `tsunami`, `aurora`, `wiki`, `moon`, `radiation`, `bolt`. Note the prop signature: `{ kind, color = 'currentColor', size = 14 }`.

- [ ] **Step 2: Add `infra` case**

Locate the `case 'bolt':` branch near line 307. Immediately before the `default:` branch (or at the end of the switch), add:

```jsx
    case 'infra':
      // Stylized industrial silhouette: two tanks + a stack, evoking a
      // refinery / plant footprint. Works as a generic "fixed-location
      // infrastructure" mark since the sub-panel has its own per-layer
      // glyphs.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="5" height="8" rx="0.5"/>
          <rect x="16" y="8" width="5" height="11" rx="0.5"/>
          <path d="M11 19 L11 6 L13 4 L13 19 Z"/>
          <line x1="2" y1="19" x2="22" y2="19"/>
        </svg>
      );
```

- [ ] **Step 3: Verify the glyph renders**

Temporarily paste `<GlyphSVG kind="infra" color="#94a3b8" size={20}/>` into any visible component (e.g., next to the app title). Run `npm run dev`, confirm a small industrial icon appears. Remove the temporary paste.

- [ ] **Step 4: Commit**

```bash
git add src/app2.jsx
git commit -m "feat(infra): add infra glyph kind to GlyphSVG"
```

---

## Task 3: Remove 4 existing infra entries from LayersPopover items array, add parent entry

**Files:**
- Modify: `src/app2.jsx:321-342`

- [ ] **Step 1: Read current items array**

Read `src/app2.jsx:321-342`. Confirm the array has 20 tuples including `['cables','Submarine cables','aurora','#22d3ee']`, `['reactors','Nuclear reactors','radiation','#22c55e']`, `['plants','Power plants','bolt','#f59e0b']`, and `['datacenters','Data centers','sat','#5eead4']`.

- [ ] **Step 2: Replace the items array**

Replace lines 321-342 with:

```jsx
  const [open, setOpen] = useState(false);
  const items = [
    ['flights','Flights', 'flight',  '#7dd3fc'],
    ['ships','Ships',     'ship',    '#22d3ee'],
    ['sats','Satellites', 'sat',     '#d946ef'],
    ['iss','ISS',         'iss',     '#f43f5e'],
    ['quakes','Seismic',  'quake',   '#fb923c'],
    ['cyclones','Tropical cyclones', 'storm', '#f97316'],
    ['outages','Internet outages', 'bolt', '#ef4444'],
    ['events','Natural events', 'fire', '#ef4444'],
    ['infrastructure','Critical Infrastructure', 'infra', '#94a3b8'],
    ['news','News hotspots', 'wiki', '#ef4444'],
    ['fires','Active fire pixels', 'fire', '#fb923c'],
    ['lightning','Lightning strikes', 'bolt', '#fef08a'],
    ['aurora','Aurora',   'aurora',  '#84cca3'],
    ['wind','Wind flow',  'aurora',  '#60a5fa'],
    ['oceanCurrents','Ocean currents', 'aurora', '#0d9488'],
    ['daynight','Day / night shade', 'moon',  '#94a3b8'],
    ['tsunamis','Tsunami archive', 'tsunami', '#22d3ee'],
  ];
```

The 4 removed tuples (`cables`, `reactors`, `plants`, `datacenters`) are replaced by the single new `infrastructure` tuple at the position the `cables` tuple used to occupy. Array length: 20 → 17.

- [ ] **Step 3: Verify in browser**

Run `npm run dev`. Open the app, click the Layers icon. The popover should now show 17 items with "Critical Infrastructure" where Submarine cables used to be. The 4 old infra toggles are gone. Clicking the parent checkbox flips it on/off but has no visible effect yet on the globe — that wiring comes in Task 7.

Note: with `infrastructure: false` default and no chevron yet, the sub-layers are effectively unreachable from the UI right now. This is expected and temporary — next tasks add the chevron and sub-panel.

- [ ] **Step 4: Do not commit yet**

Tasks 3, 4, 5, and 6 together produce the full LayersPopover UI. Committing between them leaves the UI in an incomplete state. Hold until Task 6.

---

## Task 4: Add expand/collapse state to `LayersPopover`

**Files:**
- Modify: `src/app2.jsx:320` (inside `LayersPopover` component, with the existing `useState` hooks)

- [ ] **Step 1: Read the top of the `LayersPopover` function body**

Read `src/app2.jsx:317-325` to locate where `const [open, setOpen] = useState(false);` sits inside the function body.

- [ ] **Step 2: Add expand state next to `open`**

Immediately after `const [open, setOpen] = useState(false);`, add:

```jsx
  // Expand/collapse for the Critical Infrastructure sub-panel. Independent
  // of `open` (popover visibility) and of `layers.infrastructure` (master
  // gate) — users can inspect sub-options before enabling the parent.
  const [infraExpanded, setInfraExpanded] = useState(false);
```

- [ ] **Step 3: Do not commit yet**

Still holding until Task 6.

---

## Task 5: Render chevron button on the parent row

**Files:**
- Modify: `src/app2.jsx:371-397` (the items.map `<label>` block)

- [ ] **Step 1: Read the existing items.map render block**

Read `src/app2.jsx:371-397`. You should see a `<label>` containing `<input type="checkbox">`, `<GlyphSVG>`, and `<span>{label}</span>`, with a conditional for the seismic magnitude readout.

- [ ] **Step 2: Add chevron button inside the label for the infrastructure row**

Inside the `<label>`, immediately after the `<span className="text-sm flex-1">{label}</span>` line, add:

```jsx
                    {k === 'infrastructure' && (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInfraExpanded(x => !x); }}
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 transition-transform"
                        style={{ transform: infraExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                        aria-label={infraExpanded ? 'Collapse infrastructure sub-layers' : 'Expand infrastructure sub-layers'}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 1 L7 5 L3 9 Z"/></svg>
                      </button>
                    )}
```

The `e.preventDefault() + stopPropagation()` prevents the chevron click from also toggling the parent checkbox (because the chevron is inside the `<label>`).

- [ ] **Step 3: Do not commit yet**

---

## Task 6: Render sub-panel with 4 sub-items grouped by Energy / Connectivity

**Files:**
- Modify: `src/app2.jsx:398-484` (after the label closing tag, before the seismic-slider conditional)

- [ ] **Step 1: Locate the sub-filter insertion point**

Read `src/app2.jsx:385-400`. After the `</label>` closing tag on ~line 386, there are conditional blocks for `quakes` (magnitude slider), then `flights` (sub-filter checkboxes at line 400), then `ships` at line 422. New sub-panel goes before the `quakes` conditional, keyed on `k === 'infrastructure'`.

- [ ] **Step 2: Insert the infrastructure sub-panel conditional**

Between the `</label>` close and the `{k === 'quakes' && (` line, insert:

```jsx
                  {/* Critical Infrastructure sub-panel. Rendered only when
                      the chevron has been expanded, regardless of whether
                      the parent checkbox is on (so users can inspect
                      sub-options pre-enable). Visual groups separated by
                      thin dividers; no group headers. */}
                  {k === 'infrastructure' && infraExpanded && (
                    <div className="pl-6 pr-2 pb-1.5 pt-0.5 space-y-0.5">
                      {/* Energy group */}
                      {[
                        ['plants',     'Power plants',      'bolt',      '#f59e0b'],
                        ['reactors',   'Nuclear reactors',  'radiation', '#22c55e'],
                      ].map(([sk, slabel, sglyph, scol]) => (
                        <label key={sk} className="flex items-center gap-2 py-0.5 text-[11px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!layers[sk]}
                            onChange={e => setLayers(x => ({ ...x, [sk]: e.target.checked }))}
                            className="accent-accent-500 scale-90"
                          />
                          <span className="shrink-0 w-3 h-3 flex items-center justify-center" style={{ color: scol }}>
                            <GlyphSVG kind={sglyph} color={scol} size={12}/>
                          </span>
                          <span className="opacity-80">{slabel}</span>
                        </label>
                      ))}
                      {/* Divider between Energy and Connectivity */}
                      <div className="border-t border-black/10 dark:border-white/10 my-1"/>
                      {/* Connectivity group */}
                      {[
                        ['cables',      'Submarine cables', 'aurora', '#22d3ee'],
                        ['datacenters', 'Data centers',     'sat',    '#5eead4'],
                      ].map(([sk, slabel, sglyph, scol]) => (
                        <label key={sk} className="flex items-center gap-2 py-0.5 text-[11px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!layers[sk]}
                            onChange={e => setLayers(x => ({ ...x, [sk]: e.target.checked }))}
                            className="accent-accent-500 scale-90"
                          />
                          <span className="shrink-0 w-3 h-3 flex items-center justify-center" style={{ color: scol }}>
                            <GlyphSVG kind={sglyph} color={scol} size={12}/>
                          </span>
                          <span className="opacity-80">{slabel}</span>
                        </label>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 3: Verify the UI works end-to-end**

Run `npm run dev`. Click the Layers icon.
1. Confirm "Critical Infrastructure" shows a right-pointing chevron (▶).
2. Click the chevron. It rotates 90° (▼) and a 4-row sub-panel appears.
3. Confirm sub-panel order: Power plants → Nuclear reactors → [divider] → Submarine cables → Data centers.
4. Clicking the chevron again collapses the sub-panel.
5. Clicking the parent checkbox toggles `infrastructure` in state but has no visible effect on the globe yet (Task 7 wires that).
6. Clicking a sub-checkbox toggles its key in state; still no globe effect yet.

- [ ] **Step 4: Commit the combined UI changes from Tasks 3-6**

```bash
git add src/app2.jsx
git commit -m "feat(infra): add Critical Infrastructure parent row + sub-panel UI"
```

---

## Task 7: Gate 4 existing render blocks with `layers.infrastructure &&`

**Files:**
- Modify: `src/globe2.jsx:1429` (cables render guard)
- Modify: `src/globe2.jsx:2108` (reactors render guard)
- Modify: `src/globe2.jsx:2135` (plants render guard)
- Modify: `src/globe2.jsx:2443` (datacenters render guard)

- [ ] **Step 1: Read each render-block guard line**

Read these four lines in `src/globe2.jsx` to confirm their shape. Each should currently be a single-line `if (layers.X && Array.isArray(data.X) && data.X.length) {` pattern.

- [ ] **Step 2: Update cables guard**

Line 1429, change:

```jsx
        if (layers.cables && Array.isArray(data.cables) && data.cables.length) {
```

To:

```jsx
        if (layers.infrastructure && layers.cables && Array.isArray(data.cables) && data.cables.length) {
```

- [ ] **Step 3: Update reactors guard**

Line 2108, change:

```jsx
      if (layers.reactors && Array.isArray(data.reactors) && data.reactors.length) {
```

To:

```jsx
      if (layers.infrastructure && layers.reactors && Array.isArray(data.reactors) && data.reactors.length) {
```

- [ ] **Step 4: Update plants guard**

Line 2135, change:

```jsx
      if (layers.plants && Array.isArray(data.plants) && data.plants.length) {
```

To:

```jsx
      if (layers.infrastructure && layers.plants && Array.isArray(data.plants) && data.plants.length) {
```

- [ ] **Step 5: Update datacenters guard**

Line 2443, change:

```jsx
      if (layers.datacenters && datacentersRef.current && datacentersRef.current.length) {
```

To:

```jsx
      if (layers.infrastructure && layers.datacenters && datacentersRef.current && datacentersRef.current.length) {
```

- [ ] **Step 6: Verify parent gating works**

Run `npm run dev`. In the Layers popover:
1. Expand Critical Infrastructure sub-panel.
2. Turn on `Power plants` sub-checkbox. Leave parent `Critical Infrastructure` OFF. Confirm no power plants appear on the globe.
3. Turn parent ON. Confirm power plants now render.
4. Turn parent OFF again. Confirm plants disappear.
5. Repeat the parent-OFF/parent-ON test with `Submarine cables`, `Nuclear reactors`, and `Data centers` individually enabled. Each should only appear when parent is ON.
6. Turn parent ON with no sub-layers on. Confirm nothing renders (parent on is necessary but not sufficient).

- [ ] **Step 7: Commit**

```bash
git add src/globe2.jsx
git commit -m "feat(infra): gate 4 infrastructure render blocks on parent toggle"
```

---

## Task 8: Phase 1 final verification + PR

**Files:** None modified. This task is validation only.

- [ ] **Step 1: Full migration test (existing-user path)**

1. Clear all localStorage for the app origin.
2. Manually set `localStorage['ge-layers'] = '{"plants":true,"datacenters":true}'`.
3. Reload. Confirm in DevTools that `ge-layers` now contains `"infrastructure":true` and both `plants:true`, `datacenters:true`.
4. Confirm on the globe that power plants and data centers render immediately on first view (no user action needed).
5. Reload again. Confirm `ge-layers` unchanged (migration ran once, idempotent).

- [ ] **Step 2: Full migration test (new-user path)**

1. Clear all localStorage.
2. Reload. Confirm `ge-layers` populates with defaults, including `"infrastructure":false`.
3. Confirm no infrastructure layers render on the globe.
4. Open Layers popover, enable Critical Infrastructure + Power plants. Confirm plants render.

- [ ] **Step 3: Popover layout check**

1. Open Layers popover with sub-panel collapsed. Confirm total vertical space is reasonable (should fit in the default popover max-height of 70vh without scrollbar on most displays).
2. Expand sub-panel. Confirm popover still fits or scrolls smoothly without layout breakage.
3. Re-collapse. Confirm no residual artifacts.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin claude/fervent-taussig-dbc9a8
gh pr create --title "Critical Infrastructure layer — Phase 1 (UI refactor)" --body "$(cat <<'BODY'
## Summary
- Introduces a `Critical Infrastructure` parent toggle in the LayersPopover
- Relocates Power plants, Nuclear reactors, Submarine cables, and Data centers into a sub-panel under it
- One-shot migration auto-enables the parent for users who had any infrastructure sub-layer on
- No new data sources — pure UI refactor

## Phases
This is Phase 1 of 3. Phase 2 adds refineries/LNG/fabs. Phase 3 adds dams/ports/pipelines. See `docs/superpowers/specs/2026-04-20-critical-infrastructure-layer-design.md`.

## Test plan
- [ ] Parent OFF hides all 4 sub-layers
- [ ] Parent ON + sub-checkbox shows that sub-layer
- [ ] Chevron expand/collapse works without touching parent state
- [ ] Existing user with `plants:true` in localStorage gets `infrastructure:true` auto-set on first load
- [ ] New user sees parent off by default
- [ ] Popover fits vertically with sub-panel expanded

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-review

**Spec coverage check:**

Phase 1 in the spec (section 9) lists these items:
- [x] Add `infrastructure` key to layer defaults — Task 1
- [x] Add new `Critical Infrastructure` top-level entry to LayersPopover — Task 3
- [x] Remove `plants`, `reactors`, `cables`, `datacenters` from top-level items — Task 3
- [x] Implement expand/collapse chevron + sub-panel rendering — Tasks 4, 5, 6
- [x] Add `layers.infrastructure &&` conjunct to each of 4 existing sub-layer render guards — Task 7
- [x] Implement one-shot migration rule — Task 1
- [x] Add `infra` glyph to `GlyphSVG` — Task 2

All Phase 1 deliverables are covered. Phase 2 and Phase 3 are out of scope for this plan.

**Placeholder scan:** No "TBD", "TODO", or "similar to above" patterns. All code blocks are complete and runnable. All file paths are exact with line numbers. All verification steps are concrete browser actions with expected outcomes.

**Type / naming consistency:**
- Layer state key: `infrastructure` (consistent across Tasks 1, 3, 6, 7 and the migration).
- Glyph kind: `infra` (consistent between Tasks 2 and 3).
- Expand state: `infraExpanded` / `setInfraExpanded` (consistent between Tasks 4 and 5).
- Render guard pattern: `layers.infrastructure && layers.<subkey>` (consistent across Task 7's four edits).

No inconsistencies found.
