// Hyperscaler cloud status aggregator. Pulls current incidents from the
// providers that expose a clean public JSON endpoint and returns a
// per-operator summary so the dossier can show "Operational" vs. "3
// active incidents · AWS us-east-1 EC2".
//
// Providers covered in this version:
//   - GCP         https://status.cloud.google.com/incidents.json
//   - Cloudflare  https://www.cloudflarestatus.com/api/v2/summary.json
//   - Oracle      https://ocistatus.oraclecloud.com/api/v2/summary.json
//   - AWS         https://status.aws.amazon.com/data.json  (archive + current)
//
// Not covered yet:
//   - Azure  — only has RSS (XML parsing adds build surface; TODO).
//   - Alibaba — no public JSON status API discovered.
//
// PeeringDB colo facilities don't have a unified status feed; only
// hyperscaler regions get status info here.

export const config = { runtime: 'nodejs', maxDuration: 30 };

const CACHE_TTL = 5 * 60 * 1000;    // 5 min — status feeds update fast
let cache = null;

// Small safe-fetch with a 6 s timeout so one slow provider doesn't stall
// the whole response.
async function safeJson(url, timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[dc-status] fetch failed:', url.replace(/^https?:\/\//, '').split('/')[0], e.message);
    return null;
  }
}

// ── Parsers: each returns { incidents: [{title, regions, startedAt}], state }
// where state ∈ { 'operational' | 'degraded' | 'outage' | 'unknown' }.

async function fetchGcp() {
  const j = await safeJson('https://status.cloud.google.com/incidents.json');
  if (!Array.isArray(j)) return { state: 'unknown', incidents: [] };
  const now = Date.now();
  const active = j.filter(inc => {
    // Active = no `end` timestamp or end is in the future.
    if (!inc.end) return true;
    return new Date(inc.end).getTime() > now;
  });
  const incidents = active.map(inc => ({
    id: inc.id,
    title: inc.external_desc || inc.service_name || 'GCP incident',
    regions: Array.from(new Set(
      (inc.currently_affected_locations || inc.previously_affected_locations || [])
        .map(l => l.id || l.title).filter(Boolean)
    )),
    startedAt: inc.begin || inc.created || null,
    severity: inc.severity || null,
  }));
  return { state: incidents.length ? 'degraded' : 'operational', incidents };
}

// Statuspage.io-style summary (Cloudflare, Oracle, and many others).
// `components` is a flat list; `incidents` a separate list. We use both.
async function fetchStatuspage(url, operator) {
  const j = await safeJson(url);
  if (!j) return { state: 'unknown', incidents: [] };
  const comps = Array.isArray(j.components) ? j.components : [];
  const incs  = Array.isArray(j.incidents)  ? j.incidents  : [];
  const active = incs.filter(i =>
    i.status && !['resolved', 'postmortem', 'completed'].includes(i.status)
  );
  const incidents = active.map(i => ({
    id: i.id,
    title: i.name,
    regions: (i.components || []).map(c => c.name).filter(Boolean),
    startedAt: i.started_at || i.created_at || null,
    severity: i.impact || null,
  }));
  // Overall state: if any component is not "operational," degraded.
  const nonOp = comps.find(c => c.status && c.status !== 'operational');
  const state = incidents.length || nonOp
    ? (nonOp?.status === 'major_outage' ? 'outage' : 'degraded')
    : 'operational';
  return { state, incidents };
}

// AWS's public feed lumps archive + current. `current` is present only
// during active events; when empty, AWS is fully green.
async function fetchAws() {
  const j = await safeJson('https://status.aws.amazon.com/data.json');
  if (!j) return { state: 'unknown', incidents: [] };
  const cur = Array.isArray(j.current) ? j.current : [];
  const incidents = cur.map(e => ({
    id: e.date || e.summary || e.service_name,
    title: e.service_name ? `${e.service_name} · ${e.summary || 'service event'}` : (e.summary || 'AWS event'),
    // AWS encodes region in the service_name suffix (e.g. "Amazon EC2 (N. Virginia)").
    regions: e.service_name ? extractAwsRegions(e.service_name) : [],
    startedAt: e.date || null,
    severity: e.status || null,
  }));
  return { state: incidents.length ? 'degraded' : 'operational', incidents };
}
function extractAwsRegions(serviceName) {
  // Very coarse — AWS uses friendly region names in service_name.
  const map = {
    'N. VIRGINIA':   'us-east-1',
    'OHIO':          'us-east-2',
    'N. CALIFORNIA': 'us-west-1',
    'OREGON':        'us-west-2',
    'CANADA':        'ca-central-1',
    'IRELAND':       'eu-west-1',
    'LONDON':        'eu-west-2',
    'PARIS':         'eu-west-3',
    'FRANKFURT':     'eu-central-1',
    'ZURICH':        'eu-central-2',
    'STOCKHOLM':     'eu-north-1',
    'MILAN':         'eu-south-1',
    'TOKYO':         'ap-northeast-1',
    'SEOUL':         'ap-northeast-2',
    'OSAKA':         'ap-northeast-3',
    'SINGAPORE':     'ap-southeast-1',
    'SYDNEY':        'ap-southeast-2',
    'JAKARTA':       'ap-southeast-3',
    'MELBOURNE':     'ap-southeast-4',
    'MUMBAI':        'ap-south-1',
    'HYDERABAD':     'ap-south-2',
    'HONG KONG':     'ap-east-1',
    'SAO PAULO':     'sa-east-1',
    'SÃO PAULO':     'sa-east-1',
    'BAHRAIN':       'me-south-1',
    'UAE':           'me-central-1',
    'CAPE TOWN':     'af-south-1',
    'ISRAEL':        'il-central-1',
  };
  const u = serviceName.toUpperCase();
  for (const [label, region] of Object.entries(map)) {
    if (u.includes(label)) return [region];
  }
  return [];
}

// ── Top-level handler ───────────────────────────────────────────────

async function buildList() {
  const [gcp, cloudflare, oracle, aws] = await Promise.all([
    fetchGcp(),
    fetchStatuspage('https://www.cloudflarestatus.com/api/v2/summary.json', 'cloudflare'),
    fetchStatuspage('https://ocistatus.oraclecloud.com/api/v2/summary.json', 'oci'),
    fetchAws(),
  ]);
  return {
    generatedAt: Date.now(),
    providers: {
      aws,
      gcp,
      cloudflare,
      oci: oracle,
      azure:   { state: 'unknown', incidents: [], note: 'Azure status is RSS-only; not yet parsed.' },
      alibaba: { state: 'unknown', incidents: [], note: 'No public JSON status feed.' },
    },
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  if (!cache || now - cache.generatedAt > CACHE_TTL) {
    try { cache = await buildList(); }
    catch (e) {
      console.warn('[dc-status] build failed:', e.message);
      if (!cache) { res.status(502).json({ error: 'status unavailable' }); return; }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  // 1 min edge + 5 min SWR — client will poll every few minutes anyway.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json(cache);
}
