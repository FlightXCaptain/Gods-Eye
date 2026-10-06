// Satellite TLE proxy — CelesTrak GP groups, fetched server-side.
//
// Why a proxy:
// - CelesTrak doesn't send Access-Control-Allow-Origin, so the browser
//   can't fetch it directly.
// - The previous browser-direct source (tle.ivanstanojevic.me) is a free
//   hobby mirror: every visitor fired 14 requests at it, it started
//   answering 508 "Resource Limit Is Reached", and the TLEs it did return
//   were up to years stale (SGP4 positions from a 2023 epoch are fiction).
// - CelesTrak publishes fresh elements every ~2 h and asks clients not to
//   re-download a group more often than that. The module cache + CDN
//   s-maxage below means CelesTrak sees a handful of requests per 2 h
//   regardless of visitor count.
//
// Mega-constellations are down-sampled (every Nth) so the globe reads as
// a swarm without propagating 10k+ objects in the browser every 2 s.

export const config = { runtime: 'nodejs', maxDuration: 30 };

const GROUPS = [
  // [CelesTrak GROUP, keep every Nth]
  ['stations',     1],
  ['visual',       1],
  ['gps-ops',      1],
  ['galileo',      1],
  ['glo-ops',      1],
  ['beidou',       1],
  ['iridium-NEXT', 1],
  ['weather',      1],
  ['science',      1],
  ['geo',          1],
  ['oneweb',       3],
  ['starlink',     20],
];
const URL_FOR = g => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=tle`;
const TTL_MS = 2 * 60 * 60 * 1000;

let cached = null;
let cachedAt = 0;

// CelesTrak TLE format: name line, line 1, line 2 — repeated.
function parseTle(text) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; ) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      out.push({ name: name.trim(), line1: l1, line2: l2, satelliteId: parseInt(l1.slice(2, 7), 10) });
      i += 3;
    } else {
      i += 1; // resync on malformed input
    }
  }
  return out;
}

async function fetchGroup(group) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(URL_FOR(group), { signal: ctrl.signal, headers: { 'User-Agent': 'gods-eye/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseTle(await r.text());
  } finally {
    clearTimeout(t);
  }
}

async function load() {
  const results = await Promise.allSettled(GROUPS.map(([g]) => fetchGroup(g)));
  const seen = new Set();
  const sats = [];
  results.forEach((r, gi) => {
    const [group, every] = GROUPS[gi];
    if (r.status !== 'fulfilled') { console.warn(`[satellites] ${group} failed:`, String(r.reason)); return; }
    r.value.forEach((s, i) => {
      if (i % every !== 0 || seen.has(s.satelliteId)) return;
      seen.add(s.satelliteId);
      sats.push(s);
    });
  });
  return sats;
}

export default async function handler(req, res) {
  const now = Date.now();
  if (!cached || now - cachedAt > TTL_MS) {
    try {
      const sats = await load();
      // A partial upstream outage can return a handful of groups; don't
      // replace a good cache with a much smaller set.
      if (sats.length && (!cached || sats.length >= cached.length * 0.5)) {
        cached = sats;
        cachedAt = now;
      }
    } catch (e) {
      console.warn('[satellites] load failed:', String(e));
    }
  }
  if (!cached?.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'satellites unavailable' });
  }
  res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=7200, stale-while-revalidate=86400');
  return res.status(200).json({ generatedAt: cachedAt, count: cached.length, member: cached });
}
