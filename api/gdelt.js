// GDELT 2.0 news hotspots proxy. GDELT publishes a tab-separated events
// file every 15 minutes at a predictable URL, zipped. We pull the latest
// 8 hours (32 × 15-min slots) in parallel, dedupe by GlobalEventID, and
// enrich each record with:
//   - CAMEO root + full event name (from an embedded lookup)
//   - Actor1/Actor2 names, codes, and type codes (GOV / MIL / REB / etc.)
//   - Source domain extracted from the article URL
//   - Precomputed `conflict` boolean (root codes 14–20 = protest, force
//     posture, reduce relations, coerce, assault, fight, mass violence)
//
// The endpoint returns ALL events — conflict and non-conflict together.
// The UI decides what to render via the `conflict` flag so users can
// toggle "conflict only" (default) vs "everything".
//
// Pipeline:
//   1. Read lastupdate.txt to find the most recent 15-min timestamp.
//   2. Generate the 32 previous slot URLs from that timestamp.
//   3. Download all 32 zips in parallel (each ~50 KB). Inflate each with
//      Node's built-in zlib.inflateRawSync — GDELT's zip is plain
//      store+deflate so no npm dep needed.
//   4. Parse tab-separated rows; keep only geocoded action locations.
//   5. Dedupe by GlobalEventID across slots (same event can repeat when
//      an update triggers a fresh row).
//   6. Cache the final array in module scope for one 15-min upstream cycle.

import zlib from 'node:zlib';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const LASTUPDATE = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const SLOT_COUNT = 32;                        // 32 × 15 min = 8 hours
const SLOT_MS = 15 * 60 * 1000;
const TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;               // per-slot guard

// CAMEO event root code names. These are the 20 top-level "what happened"
// buckets; every event code starts with one of these two digits.
const CAMEO_ROOT = {
  '01': 'Public statement',
  '02': 'Appeal',
  '03': 'Express intent to cooperate',
  '04': 'Consult',
  '05': 'Diplomatic cooperation',
  '06': 'Material cooperation',
  '07': 'Provide aid',
  '08': 'Yield',
  '09': 'Investigate',
  '10': 'Demand',
  '11': 'Disapprove',
  '12': 'Reject',
  '13': 'Threaten',
  '14': 'Protest',
  '15': 'Exhibit force posture',
  '16': 'Reduce relations',
  '17': 'Coerce',
  '18': 'Assault',
  '19': 'Fight',
  '20': 'Mass violence',
};

// Common sub-codes that are sharp enough to be worth naming. Anything
// not in this table falls back to the root name. Scoped to conflict tiers
// since that's where the finer granularity matters most.
const CAMEO_EVENT = {
  // 14 Protest
  '140':'Protest/demonstrate','141':'Demonstrate or rally','143':'Strike or boycott',
  '145':'Protest violently, riot','146':'Obstruct passage',
  // 15 Exhibit force posture
  '150':'Exhibit force posture','151':'Increase police alert','152':'Mobilize armed forces',
  '153':'Military alert','154':'Military exercise',
  // 16 Reduce relations
  '160':'Reduce relations','161':'Reduce diplomatic relations','163':'Expel diplomats',
  '165':'Halt negotiations','166':'Expel peacekeepers',
  // 17 Coerce
  '170':'Coerce','171':'Seize/damage property','172':'Administrative sanctions',
  '173':'Arrest or detain','174':'Expel or deport','175':'Violent repression',
  '176':'Restrict movement',
  // 18 Assault
  '180':'Assault','181':'Abduct, hijack, take hostage','182':'Physical assault',
  '183':'Assassinate','184':'Bombing','185':'Sexual violence','186':'Torture',
  // 19 Fight
  '190':'Use conventional military force','191':'Impose blockade','192':'Occupy territory',
  '193':'Small-arms and light-weapons fight','194':'Artillery and tank fight',
  '195':'Aerial weapons','1951':'Employ precision-guided aerial munitions',
  '1952':'Employ remotely piloted aerial munitions','196':'Violate ceasefire',
  // 20 Mass violence
  '200':'Use unconventional mass violence','201':'Engage in mass expulsion',
  '202':'Engage in mass killing','203':'Engage in ethnic cleansing',
  '204':'Use weapons of mass destruction',
};

// CAMEO actor type codes. These decorate actor names with role (e.g.
// "UNITED STATES · MIL" or "HAMAS · REB"). Only the most common are
// worth naming; anything else we leave as the raw 3-letter code.
const CAMEO_ACTOR_TYPE = {
  COP:'Police', GOV:'Government', MIL:'Military', REB:'Rebels',
  OPP:'Opposition', JUD:'Judiciary', MED:'Media', CVL:'Civilian',
  INT:'Intl. org', NGO:'NGO', LEG:'Legislative', BUS:'Business',
  CRM:'Criminal', SPY:'Intelligence', UAF:'Unidentified armed', REF:'Refugees',
  EDU:'Education', ELI:'Elite', LAB:'Labour', HLH:'Health',
  REL:'Religious', SOC:'Social', ENV:'Environmental',
};

// Root codes 14–20 are "conflict" for UI purposes. This is the set the
// /api/gdelt response marks with `conflict: true` and what the UI's
// "Conflict" sub-toggle enables by default. Everything else (01–13) is
// "non-conflict" — statements, consultations, cooperation, aid, demands,
// disapproval, threats.
const CONFLICT_ROOTS = new Set([14, 15, 16, 17, 18, 19, 20]);

// Minimal single-file-zip reader. GDELT events are published as classic
// zip containers: one PK\x03\x04 local file header, one deflate stream,
// one central directory. We only need the compressed payload, which
// sits at offset (30 + filenameLen + extraLen) from the local header.
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method    = buf.readUInt16LE(8);
  const compSize  = buf.readUInt32LE(18);
  const fnLen     = buf.readUInt16LE(26);
  const exLen     = buf.readUInt16LE(28);
  const start = 30 + fnLen + exLen;
  const payload = buf.subarray(start, start + compSize);
  if (method === 0) return payload;
  if (method === 8) return zlib.inflateRawSync(payload);
  throw new Error('unsupported zip compression method: ' + method);
}

function fmtTs(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function parseLatestTs(text) {
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[2].includes('export.CSV.zip')) {
      const m = parts[2].match(/(\d{14})\.export/);
      if (m) return m[1];
    }
  }
  return null;
}

function slotUrls(latestTs, count) {
  const y  = +latestTs.slice(0, 4);
  const mo = +latestTs.slice(4, 6) - 1;
  const d  = +latestTs.slice(6, 8);
  const h  = +latestTs.slice(8, 10);
  const mi = +latestTs.slice(10, 12);
  const base = Date.UTC(y, mo, d, h, mi, 0);
  const urls = [];
  for (let i = 0; i < count; i++) {
    urls.push(`http://data.gdeltproject.org/gdeltv2/${fmtTs(new Date(base - i * SLOT_MS))}.export.CSV.zip`);
  }
  return urls;
}

function extractDomain(url) {
  if (!url) return '';
  const m = url.match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
}

// Titlecase an all-caps actor name. GDELT hands back "ISRAELI MILITARY" —
// a readable hover label wants "Israeli Military".
function titleCase(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
}

// Compact one-liner summary usable as a hover label or dossier heading.
// Builds from the fields we already have — no external lookups needed.
// Shape heuristics:
//   both actors → "Israeli Military → Palestinian Civilian · Small-arms fight"
//   one  actor  → "Russia · Military mobilization"
//   no   actors → "Small-arms fight · Kyiv, Ukraine"
// Place is always appended when absent from the actor framing so the hover
// is self-contained even on a crowded map.
function buildSummary(rec) {
  const a1 = titleCase(rec.actor1Name);
  const a2 = titleCase(rec.actor2Name);
  const ev = rec.eventName || rec.rootName || 'Event';
  const place = rec.place || '';
  // Trim "Country (general), Country" duplication GDELT likes to emit.
  const shortPlace = place.replace(/\s*\(general\)/ig, '').replace(/,\s*[^,]+$/, (m) => place.split(',').length > 2 ? m : '');
  if (a1 && a2 && a1 !== a2) {
    return `${a1} → ${a2} · ${ev}${shortPlace ? ` · ${shortPlace}` : ''}`;
  }
  if (a1) {
    return `${a1} · ${ev}${shortPlace ? ` · ${shortPlace}` : ''}`;
  }
  return shortPlace ? `${ev} · ${shortPlace}` : ev;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Parse one GDELT events CSV slot into normalised records. Columns we care
// about (0-indexed, GDELT 2.0 events schema):
//    0  GLOBALEVENTID
//    5  Actor1Code         ISO-ish + CAMEO role codes
//    6  Actor1Name         human-readable, all-caps
//   12  Actor1Type1Code    GOV / MIL / REB / CVL etc.
//   15  Actor2Code
//   16  Actor2Name
//   22  Actor2Type1Code
//   26  EventCode          full CAMEO (3–4 digit)
//   28  EventRootCode      2-digit theme bucket (01–20)
//   29  QuadClass          1/2/3/4 (verbal coop → material conflict)
//   30  GoldsteinScale     −10…+10 cooperation/conflict magnitude
//   31  NumMentions
//   34  AvgTone            −10…+10 sentiment
//   52  ActionGeo_FullName readable place label ("Kyiv, Kyyiv, Misto, Ukraine")
//   53  ActionGeo_CountryCode (FIPS 2-letter — *not* ISO)
//   56  ActionGeo_Lat
//   57  ActionGeo_Long
//   59  DATEADDED          YYYYMMDDHHMMSS of when GDELT ingested
//   60  SOURCEURL          article URL
function parseSlotCsv(csv) {
  const out = [];
  for (const row of csv.split('\n')) {
    if (!row) continue;
    const f = row.split('\t');
    if (f.length < 61) continue;
    const lat = parseFloat(f[56]);
    const lon = parseFloat(f[57]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // (0,0) is GDELT's placeholder when a row didn't actually geocode.
    if (lat === 0 && lon === 0) continue;
    const rootCode = parseInt(f[28], 10);
    if (!isFinite(rootCode)) continue;
    const rootKey = String(rootCode).padStart(2, '0');
    const eventCode = f[26] || '';
    const rec = {
      id: f[0],
      lon, lat,
      place: f[52] || '',
      country: f[53] || '',
      rootCode,
      rootName: CAMEO_ROOT[rootKey] || 'Other',
      eventCode,
      eventName: CAMEO_EVENT[eventCode] || CAMEO_ROOT[rootKey] || 'Other',
      conflict: CONFLICT_ROOTS.has(rootCode),
      quad: parseInt(f[29], 10) || 0,
      goldstein: parseFloat(f[30]) || 0,
      mentions: parseInt(f[31], 10) || 1,
      tone: parseFloat(f[34]) || 0,
      actor1Name: f[6] || '',
      actor1Code: f[5] || '',
      actor1Type: f[12] || '',
      actor1TypeName: CAMEO_ACTOR_TYPE[f[12]] || f[12] || '',
      actor2Name: f[16] || '',
      actor2Code: f[15] || '',
      actor2Type: f[22] || '',
      actor2TypeName: CAMEO_ACTOR_TYPE[f[22]] || f[22] || '',
      sourceDomain: extractDomain(f[60]),
      dateAdded: f[59],
      url: f[60] || null,
    };
    rec.summary = buildSummary(rec);
    out.push(rec);
  }
  return out;
}

async function fetchSlot(url) {
  try {
    const r = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!r.ok) return [];
    const ab = await r.arrayBuffer();
    const csv = unzipFirst(Buffer.from(ab)).toString('utf8');
    return parseSlotCsv(csv);
  } catch {
    return [];
  }
}

let cached = null;
let cachedAt = 0;
let cachedKey = null;
let inflight = null;

async function loadHotspots() {
  // De-dup concurrent refreshes so 10 simultaneous cold readers don't all
  // kick off 32 downloads each.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetchWithTimeout(LASTUPDATE, FETCH_TIMEOUT_MS);
      if (!r.ok) throw new Error(`lastupdate ${r.status}`);
      const latestTs = parseLatestTs(await r.text());
      if (!latestTs) throw new Error('no latest timestamp in lastupdate.txt');

      // If the latest 15-min window hasn't rolled over and we have a cache,
      // skip re-downloading — same 32 files, same result.
      if (cachedKey === latestTs && cached) return cached;

      const urls = slotUrls(latestTs, SLOT_COUNT);
      const results = await Promise.allSettled(urls.map(fetchSlot));

      // Dedupe by GlobalEventID. Slots are enumerated newest-first, so
      // the first occurrence wins — that's intentional, it keeps the
      // freshest row (including tone/mentions) for events that span
      // multiple slots as GDELT re-ingests coverage.
      const byId = new Map();
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const ev of r.value) {
          if (!byId.has(ev.id)) byId.set(ev.id, ev);
        }
      }

      const out = Array.from(byId.values());
      cached = out;
      cachedAt = Date.now();
      cachedKey = latestTs;
      return out;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export default async function handler(req, res) {
  try {
    if (!cached || Date.now() - cachedAt > TTL_MS) {
      await loadHotspots();
    }
    // Let Vercel's edge cache absorb repeat hits within a 15-min window.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json(cached);
  } catch (err) {
    return res.status(502).json({ error: 'gdelt-failed', message: String(err) });
  }
}
