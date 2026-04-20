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
// the whole response. Auto-detects UTF-16 BOM (AWS's currentevents feed
// is UTF-16 BE) and decodes with the right TextDecoder before parsing.
async function safeJson(url, timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let text;
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else {
      text = new TextDecoder('utf-8').decode(bytes);
    }
    return JSON.parse(text);
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

// AWS's older /data.json was deprecated. The current public events feed
// is at /public/currentevents, returned as UTF-16 BE JSON — safeJson
// auto-decodes. Each element has { date, arn, eventTypeCode, ... } where
// the ARN encodes the region and service.
async function fetchAws() {
  const j = await safeJson('https://health.aws.amazon.com/public/currentevents');
  if (!Array.isArray(j)) return { state: 'unknown', incidents: [] };
  const incidents = j.map(e => {
    // ARN shape: arn:aws:health:<region>::event/<service>/<typeCode>/<id>
    const arnMatch = /^arn:aws:health:([^:]+)::event\/([^/]+)\/([^/]+)/.exec(e.arn || '');
    const region  = arnMatch?.[1] || null;
    const service = arnMatch?.[2] || null;
    const typeCode = arnMatch?.[3] || e.eventTypeCode || null;
    // Turn MULTIPLE_SERVICES_OPERATIONAL_ISSUE into "Multiple services
    // operational issue" — readable in the dossier.
    const pretty = typeCode ? typeCode.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'AWS event';
    return {
      id: e.arn || `aws-${e.date || Date.now()}`,
      title: service ? `${service.toUpperCase()} · ${pretty}` : pretty,
      regions: region ? [region] : [],
      startedAt: e.date ? new Date(parseInt(e.date, 10) * 1000).toISOString() : null,
      severity: null,
    };
  });
  return { state: incidents.length ? 'degraded' : 'operational', incidents };
}

// ── Top-level handler ───────────────────────────────────────────────

// Oracle's OCI status page doesn't expose summary.json or incidents.json
// like a standard Statuspage deployment — only the aggregate indicator
// at /api/v2/status.json. Returns { status: { indicator, description } }
// with indicator ∈ {none, minor, major, critical}. No per-incident detail.
async function fetchOci() {
  const j = await safeJson('https://ocistatus.oraclecloud.com/api/v2/status.json');
  if (!j?.status) return { state: 'unknown', incidents: [] };
  const ind = (j.status.indicator || '').toLowerCase();
  const state = ind === 'none'     ? 'operational'
              : ind === 'critical' ? 'outage'
              : ind && ind !== 'unknown' ? 'degraded'
              : 'unknown';
  return {
    state,
    incidents: [],
    note: j.status.description || undefined,
  };
}

async function buildList() {
  const [gcp, cloudflare, oracle, aws] = await Promise.all([
    fetchGcp(),
    fetchStatuspage('https://www.cloudflarestatus.com/api/v2/summary.json', 'cloudflare'),
    fetchOci(),
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
