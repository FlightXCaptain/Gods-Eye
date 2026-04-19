// GDELT 2.0 news hotspots proxy. GDELT publishes a tab-separated
// events file every 15 minutes at a predictable URL, zipped. We:
//   1. Read lastupdate.txt to find the latest file's URL.
//   2. Download the zip (~50 KB), inflate the single embedded CSV in
//      memory (no dependency — GDELT's zip is plain store+deflate so
//      Node's built-in zlib.inflateRawSync is enough).
//   3. Parse the tab-separated rows, keep only those with a geocoded
//      action location, and project onto a compact record with the
//      fields the UI needs for theme/tone filtering + rendering.
//   4. Cache the array in module scope for the full 15-minute window
//      between upstream refreshes (no point re-fetching mid-cycle).
//
// GDELT is rate-limited per source IP (roughly 1 req / 5 s for the API
// endpoints; the data server is looser but still polite), so never
// bypass the cache.

import zlib from 'node:zlib';

export const config = { runtime: 'nodejs', maxDuration: 20 };

const LASTUPDATE = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const TTL_MS = 15 * 60 * 1000;

let cached = null;
let cachedAt = 0;
let cachedKey = null;

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
  const end   = start + compSize;
  const payload = buf.subarray(start, end);
  if (method === 0) return payload;
  if (method === 8) return zlib.inflateRawSync(payload);
  throw new Error('unsupported zip compression method: ' + method);
}

async function latestEventsUrl() {
  const r = await fetch(LASTUPDATE);
  if (!r.ok) throw new Error(`lastupdate ${r.status}`);
  const text = await r.text();
  // Three lines: export, mentions, gkg. Want export.
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[2].includes('export.CSV.zip')) return parts[2];
  }
  throw new Error('no export URL in lastupdate.txt');
}

async function loadHotspots() {
  const url = await latestEventsUrl();
  // If we've already processed this exact file, return cached result.
  if (cachedKey === url && cached) return cached;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`events ${resp.status}`);
  const ab = await resp.arrayBuffer();
  const csv = unzipFirst(Buffer.from(ab)).toString('utf8');

  // GDELT 2.0 events CSV: tab-separated, 61 columns, no header row.
  // Column indices of interest:
  //   0  GLOBALEVENTID
  //  26  EventCode          (full CAMEO code)
  //  28  EventRootCode      (2-digit theme bucket 01-20)
  //  29  QuadClass          (1=verbal coop, 2=mat coop, 3=verbal conflict, 4=mat conflict)
  //  30  GoldsteinScale     (-10..+10 conflict/cooperation)
  //  31  NumMentions
  //  34  AvgTone            (-10..+10 sentiment)
  //  52  ActionGeo_FullName (place label)
  //  53  ActionGeo_CountryCode
  //  56  ActionGeo_Lat
  //  57  ActionGeo_Long
  //  59  DATEADDED
  //  60  SOURCEURL
  const out = [];
  const rows = csv.split('\n');
  for (const row of rows) {
    if (!row) continue;
    const f = row.split('\t');
    if (f.length < 61) continue;
    const lat = parseFloat(f[56]);
    const lon = parseFloat(f[57]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // Drop (0,0) — GDELT uses this when a row didn't actually geocode.
    if (lat === 0 && lon === 0) continue;
    const rootCode = parseInt(f[28], 10);
    if (!isFinite(rootCode)) continue;
    out.push({
      id: f[0],
      lon, lat,
      place: f[52] || '',
      country: f[53] || '',
      rootCode,
      quad: parseInt(f[29], 10) || 0,
      goldstein: parseFloat(f[30]) || 0,
      mentions: parseInt(f[31], 10) || 1,
      tone: parseFloat(f[34]) || 0,
      dateAdded: f[59],
      url: f[60] || null,
    });
  }
  cached = out;
  cachedAt = Date.now();
  cachedKey = url;
  return out;
}

export default async function handler(req, res) {
  try {
    const now = Date.now();
    if (!cached || now - cachedAt > TTL_MS) {
      await loadHotspots();
    }
    // Let Vercel's edge cache shoulder the repeat hits on the same 15-min file.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json(cached);
  } catch (err) {
    return res.status(502).json({ error: 'gdelt-failed', message: String(err) });
  }
}
