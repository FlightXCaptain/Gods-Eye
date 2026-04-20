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
