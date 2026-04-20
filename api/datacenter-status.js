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

// Azure status is published as RSS 2.0 only. No JSON endpoint discovered
// — the official "Azure Service Health" API requires AAD auth. Empty
// <channel> (no <item>) means no active incidents.
async function fetchAzure() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('https://azurestatuscdn.azureedge.net/en-us/status/feed/', {
      headers: {
        'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)',
        'Accept':     'application/rss+xml,text/xml,*/*',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { state: 'unknown', incidents: [] };
    const xml = await res.text();
    const stripCdata = (s) => (s || '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
    const decodeEntities = (s) => (s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    const items = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];
    const incidents = items.map((blk, i) => {
      const title   = decodeEntities(stripCdata(/<title>([\s\S]*?)<\/title>/.exec(blk)?.[1] || ''));
      const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(blk)?.[1] || '').trim();
      const link    = (/<link>([\s\S]*?)<\/link>/.exec(blk)?.[1] || '').trim();
      return {
        id: link || `azure-${pubDate || i}`,
        title: title || 'Azure event',
        regions: extractAzureRegions(title),
        startedAt: pubDate ? new Date(pubDate).toISOString() : null,
        severity: null,
      };
    });
    return { state: incidents.length ? 'degraded' : 'operational', incidents };
  } catch (e) {
    console.warn('[dc-status] azure failed:', e.message);
    return { state: 'unknown', incidents: [] };
  }
}
function extractAzureRegions(title) {
  // Azure incident titles typically mention the affected region by name.
  // Coarse substring match against the core region codes we care about.
  const map = {
    'EAST US 2':            'eastus2',
    'EAST US':              'eastus',
    'WEST US 3':            'westus3',
    'WEST US 2':            'westus2',
    'WEST US':              'westus',
    'CENTRAL US':           'centralus',
    'NORTH CENTRAL US':     'northcentralus',
    'SOUTH CENTRAL US':     'southcentralus',
    'CANADA CENTRAL':       'canadacentral',
    'CANADA EAST':          'canadaeast',
    'BRAZIL SOUTH':         'brazilsouth',
    'NORTH EUROPE':         'northeurope',
    'WEST EUROPE':          'westeurope',
    'UK SOUTH':             'uksouth',
    'UK WEST':              'ukwest',
    'FRANCE CENTRAL':       'francecentral',
    'GERMANY WEST CENTRAL': 'germanywestcentral',
    'SWITZERLAND NORTH':    'switzerlandnorth',
    'NORWAY EAST':          'norwayeast',
    'SWEDEN CENTRAL':       'swedencentral',
    'ITALY NORTH':          'italynorth',
    'POLAND CENTRAL':       'polandcentral',
    'SPAIN CENTRAL':        'spaincentral',
    'JAPAN EAST':           'japaneast',
    'JAPAN WEST':           'japanwest',
    'KOREA CENTRAL':        'koreacentral',
    'SOUTHEAST ASIA':       'southeastasia',
    'EAST ASIA':            'eastasia',
    'AUSTRALIA EAST':       'australiaeast',
    'AUSTRALIA SOUTHEAST':  'australiasoutheast',
    'CENTRAL INDIA':        'centralindia',
    'SOUTH INDIA':          'southindia',
    'UAE NORTH':            'uaenorth',
    'QATAR CENTRAL':        'qatarcentral',
    'ISRAEL CENTRAL':       'israelcentral',
    'SOUTH AFRICA NORTH':   'southafricanorth',
  };
  const u = (title || '').toUpperCase();
  const hits = [];
  // Check longest labels first to avoid "EAST US" false-matching "EAST US 2".
  for (const [label, code] of Object.entries(map).sort((a,b) => b[0].length - a[0].length)) {
    if (u.includes(label)) hits.push(code);
  }
  return Array.from(new Set(hits));
}

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
  const [gcp, cloudflare, oracle, aws, azure] = await Promise.all([
    fetchGcp(),
    fetchStatuspage('https://www.cloudflarestatus.com/api/v2/summary.json', 'cloudflare'),
    fetchOci(),
    fetchAws(),
    fetchAzure(),
  ]);
  return {
    generatedAt: Date.now(),
    providers: {
      aws,
      azure,
      gcp,
      cloudflare,
      oci: oracle,
      // Alibaba's status console is a client-rendered React app with
      // bot-walled /api/* endpoints (all 302 to Taobao login for non-
      // browser User-Agents). Without a server-side JS runtime there's
      // no way to read their feed from here.
      alibaba: {
        state: 'unknown', incidents: [],
        note: 'Alibaba Cloud has no public JSON/RSS status feed; status.alibabacloud.com is a client-rendered app with bot-walled APIs.',
      },
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
