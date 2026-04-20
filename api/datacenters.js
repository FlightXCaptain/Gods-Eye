// Data centers layer. Two sources merged at the edge:
//
//   1. PeeringDB — public /api/fac endpoint returns ~4500 carrier-neutral
//      colo facilities worldwide with lat/lon. No auth required; be
//      respectful (one fetch per warm instance, 24 h cache).
//
//   2. Hyperscaler cloud regions — curated static list. AWS, Azure,
//      Google Cloud, Oracle, Alibaba, Cloudflare. Operator region codes
//      + the metro the region sits in. Locations only per spec — no
//      status / availability / latency data.
//
// Response shape:
//   { generatedAt, counts:{total,peeringdb,hyperscaler},
//     datacenters: [ { id, name, lat, lon, operator?, city?, country?, source } ] }
//
// source ∈ { 'peeringdb' | 'hyperscaler' }

export const config = { runtime: 'nodejs', maxDuration: 30 };

const CACHE_TTL = 24 * 3600 * 1000;
let cache = null;

// ── Hyperscaler regions (curated) ────────────────────────────────────
// Coordinates point to the advertised metro for each region. Some hyper-
// scalers spread a region across multiple sites in one metro; here we
// drop a single pin at the metro centroid — the goal is "there's a
// cloud region here," not facility-level precision.

const HYPERSCALER = [
  // ── AWS ──
  ['aws','us-east-1',         'AWS · N. Virginia',        38.944, -77.455],
  ['aws','us-east-2',         'AWS · Ohio',               40.068, -82.850],
  ['aws','us-west-1',         'AWS · N. California',      37.354, -121.970],
  ['aws','us-west-2',         'AWS · Oregon',             45.835, -119.287],
  ['aws','ca-central-1',      'AWS · Canada Central',     45.501, -73.567],
  ['aws','ca-west-1',         'AWS · Canada West',        51.046, -114.057],
  ['aws','eu-west-1',         'AWS · Ireland',            53.350, -6.260],
  ['aws','eu-west-2',         'AWS · London',             51.507, -0.128],
  ['aws','eu-west-3',         'AWS · Paris',              48.856,  2.352],
  ['aws','eu-central-1',      'AWS · Frankfurt',          50.110,  8.682],
  ['aws','eu-central-2',      'AWS · Zurich',             47.377,  8.541],
  ['aws','eu-north-1',        'AWS · Stockholm',          59.329, 18.068],
  ['aws','eu-south-1',        'AWS · Milan',              45.464,  9.190],
  ['aws','eu-south-2',        'AWS · Spain',              40.417, -3.703],
  ['aws','ap-northeast-1',    'AWS · Tokyo',              35.676, 139.650],
  ['aws','ap-northeast-2',    'AWS · Seoul',              37.566, 126.978],
  ['aws','ap-northeast-3',    'AWS · Osaka',              34.694, 135.502],
  ['aws','ap-southeast-1',    'AWS · Singapore',           1.290, 103.851],
  ['aws','ap-southeast-2',    'AWS · Sydney',            -33.868, 151.209],
  ['aws','ap-southeast-3',    'AWS · Jakarta',            -6.200, 106.846],
  ['aws','ap-southeast-4',    'AWS · Melbourne',         -37.814, 144.963],
  ['aws','ap-south-1',        'AWS · Mumbai',             19.076, 72.878],
  ['aws','ap-south-2',        'AWS · Hyderabad',          17.385, 78.487],
  ['aws','ap-east-1',         'AWS · Hong Kong',          22.320, 114.169],
  ['aws','sa-east-1',         'AWS · São Paulo',         -23.550, -46.633],
  ['aws','me-south-1',        'AWS · Bahrain',            26.229,  50.586],
  ['aws','me-central-1',      'AWS · UAE',                24.467, 54.367],
  ['aws','af-south-1',        'AWS · Cape Town',         -33.925,  18.424],
  ['aws','il-central-1',      'AWS · Israel',             32.085, 34.781],
  // ── Azure ──
  ['azure','eastus',          'Azure · East US (Virginia)', 37.322, -79.899],
  ['azure','eastus2',         'Azure · East US 2',          36.666, -78.375],
  ['azure','eastus3',         'Azure · East US 3 (Atlanta)',33.749, -84.388],
  ['azure','westus',          'Azure · West US (California)',37.786, -122.420],
  ['azure','westus2',         'Azure · West US 2 (Washington)',47.234, -119.852],
  ['azure','westus3',         'Azure · West US 3 (Arizona)',  33.440, -112.030],
  ['azure','centralus',       'Azure · Central US (Iowa)',    41.592, -93.620],
  ['azure','northcentralus',  'Azure · North Central (Illinois)',41.878, -87.629],
  ['azure','southcentralus',  'Azure · South Central (Texas)', 29.424, -98.494],
  ['azure','canadacentral',   'Azure · Canada Central (Toronto)',43.653, -79.383],
  ['azure','canadaeast',      'Azure · Canada East (Quebec)', 46.813, -71.208],
  ['azure','brazilsouth',     'Azure · Brazil South',        -23.550, -46.633],
  ['azure','brazilsoutheast', 'Azure · Brazil Southeast',    -22.907, -43.173],
  ['azure','northeurope',     'Azure · North Europe (Dublin)', 53.350, -6.260],
  ['azure','westeurope',      'Azure · West Europe (Netherlands)',52.368, 4.904],
  ['azure','uksouth',         'Azure · UK South (London)',     51.507, -0.128],
  ['azure','ukwest',          'Azure · UK West (Cardiff)',     51.483, -3.168],
  ['azure','francecentral',   'Azure · France Central (Paris)',48.856,  2.352],
  ['azure','germanywestcentral','Azure · Germany West Central',50.110, 8.682],
  ['azure','switzerlandnorth', 'Azure · Switzerland North',    47.377, 8.541],
  ['azure','norwayeast',      'Azure · Norway East',           59.914, 10.752],
  ['azure','swedencentral',   'Azure · Sweden Central',        60.193, 18.284],
  ['azure','italynorth',      'Azure · Italy North',           45.464, 9.190],
  ['azure','polandcentral',   'Azure · Poland Central',        52.230, 21.011],
  ['azure','spaincentral',    'Azure · Spain Central',         40.417, -3.703],
  ['azure','japaneast',       'Azure · Japan East (Tokyo)',    35.676, 139.650],
  ['azure','japanwest',       'Azure · Japan West (Osaka)',    34.694, 135.502],
  ['azure','koreacentral',    'Azure · Korea Central (Seoul)', 37.566, 126.978],
  ['azure','southeastasia',   'Azure · SE Asia (Singapore)',    1.290, 103.851],
  ['azure','eastasia',        'Azure · East Asia (Hong Kong)',  22.320, 114.169],
  ['azure','australiaeast',   'Azure · Australia East (Sydney)',-33.868, 151.209],
  ['azure','australiasoutheast','Azure · Australia SE (Melbourne)',-37.814, 144.963],
  ['azure','centralindia',    'Azure · Central India (Pune)',  18.520, 73.856],
  ['azure','southindia',      'Azure · South India (Chennai)', 13.083, 80.271],
  ['azure','uaenorth',        'Azure · UAE North (Dubai)',     25.205, 55.271],
  ['azure','qatarcentral',    'Azure · Qatar Central (Doha)',  25.286, 51.532],
  ['azure','israelcentral',   'Azure · Israel Central',        32.085, 34.781],
  ['azure','southafricanorth','Azure · S. Africa North (Jhb)', -26.204, 28.048],
  // ── Google Cloud ──
  ['gcp','us-east1',          'GCP · us-east1 (S. Carolina)',   33.837, -81.163],
  ['gcp','us-east4',          'GCP · us-east4 (N. Virginia)',   39.044, -77.487],
  ['gcp','us-east5',          'GCP · us-east5 (Columbus)',      39.961, -82.999],
  ['gcp','us-central1',       'GCP · us-central1 (Iowa)',       41.260, -95.860],
  ['gcp','us-south1',         'GCP · us-south1 (Dallas)',       32.779, -96.807],
  ['gcp','us-west1',          'GCP · us-west1 (Oregon)',        45.601, -121.181],
  ['gcp','us-west2',          'GCP · us-west2 (Los Angeles)',   34.052, -118.244],
  ['gcp','us-west3',          'GCP · us-west3 (Salt Lake City)',40.761, -111.891],
  ['gcp','us-west4',          'GCP · us-west4 (Las Vegas)',     36.170, -115.140],
  ['gcp','northamerica-northeast1','GCP · Montreal',            45.502, -73.567],
  ['gcp','northamerica-northeast2','GCP · Toronto',             43.653, -79.383],
  ['gcp','southamerica-east1','GCP · São Paulo',                -23.550, -46.633],
  ['gcp','southamerica-west1','GCP · Santiago',                 -33.447, -70.673],
  ['gcp','europe-west1',      'GCP · Belgium',                   50.450, 3.820],
  ['gcp','europe-west2',      'GCP · London',                    51.507, -0.128],
  ['gcp','europe-west3',      'GCP · Frankfurt',                 50.110, 8.682],
  ['gcp','europe-west4',      'GCP · Netherlands',               52.368, 4.904],
  ['gcp','europe-west6',      'GCP · Zurich',                    47.377, 8.541],
  ['gcp','europe-west8',      'GCP · Milan',                     45.464, 9.190],
  ['gcp','europe-west9',      'GCP · Paris',                     48.856, 2.352],
  ['gcp','europe-west10',     'GCP · Berlin',                    52.520, 13.405],
  ['gcp','europe-west12',     'GCP · Turin',                     45.070, 7.686],
  ['gcp','europe-north1',     'GCP · Finland',                   60.566, 27.188],
  ['gcp','europe-central2',   'GCP · Warsaw',                    52.230, 21.011],
  ['gcp','europe-southwest1', 'GCP · Madrid',                    40.417, -3.703],
  ['gcp','asia-east1',        'GCP · Taiwan',                    23.697, 120.961],
  ['gcp','asia-east2',        'GCP · Hong Kong',                 22.320, 114.169],
  ['gcp','asia-northeast1',   'GCP · Tokyo',                     35.676, 139.650],
  ['gcp','asia-northeast2',   'GCP · Osaka',                     34.694, 135.502],
  ['gcp','asia-northeast3',   'GCP · Seoul',                     37.566, 126.978],
  ['gcp','asia-south1',       'GCP · Mumbai',                    19.076, 72.878],
  ['gcp','asia-south2',       'GCP · Delhi',                     28.704, 77.103],
  ['gcp','asia-southeast1',   'GCP · Singapore',                  1.290, 103.851],
  ['gcp','asia-southeast2',   'GCP · Jakarta',                   -6.200, 106.846],
  ['gcp','australia-southeast1','GCP · Sydney',                 -33.868, 151.209],
  ['gcp','australia-southeast2','GCP · Melbourne',              -37.814, 144.963],
  ['gcp','me-west1',          'GCP · Tel Aviv',                  32.085, 34.781],
  ['gcp','me-central1',       'GCP · Doha',                      25.286, 51.532],
  ['gcp','me-central2',       'GCP · Dammam',                    26.393, 49.984],
  ['gcp','africa-south1',     'GCP · Johannesburg',             -26.204, 28.048],
  // ── Oracle Cloud ──
  ['oci','us-ashburn-1',      'OCI · Ashburn',              39.044, -77.487],
  ['oci','us-phoenix-1',      'OCI · Phoenix',              33.448, -112.074],
  ['oci','us-chicago-1',      'OCI · Chicago',              41.878, -87.629],
  ['oci','us-sanjose-1',      'OCI · San Jose',             37.335, -121.891],
  ['oci','ca-toronto-1',      'OCI · Toronto',              43.653, -79.383],
  ['oci','ca-montreal-1',     'OCI · Montreal',             45.502, -73.567],
  ['oci','uk-london-1',       'OCI · London',               51.507, -0.128],
  ['oci','uk-cardiff-1',      'OCI · Cardiff',              51.483, -3.168],
  ['oci','eu-frankfurt-1',    'OCI · Frankfurt',            50.110, 8.682],
  ['oci','eu-amsterdam-1',    'OCI · Amsterdam',            52.368, 4.904],
  ['oci','eu-zurich-1',       'OCI · Zurich',               47.377, 8.541],
  ['oci','eu-milan-1',        'OCI · Milan',                45.464, 9.190],
  ['oci','eu-marseille-1',    'OCI · Marseille',            43.297, 5.370],
  ['oci','eu-stockholm-1',    'OCI · Stockholm',            59.329, 18.068],
  ['oci','eu-madrid-1',       'OCI · Madrid',               40.417, -3.703],
  ['oci','eu-paris-1',        'OCI · Paris',                48.856, 2.352],
  ['oci','ap-tokyo-1',        'OCI · Tokyo',                35.676, 139.650],
  ['oci','ap-osaka-1',        'OCI · Osaka',                34.694, 135.502],
  ['oci','ap-seoul-1',        'OCI · Seoul',                37.566, 126.978],
  ['oci','ap-singapore-1',    'OCI · Singapore',             1.290, 103.851],
  ['oci','ap-mumbai-1',       'OCI · Mumbai',               19.076, 72.878],
  ['oci','ap-hyderabad-1',    'OCI · Hyderabad',            17.385, 78.487],
  ['oci','ap-sydney-1',       'OCI · Sydney',              -33.868, 151.209],
  ['oci','ap-melbourne-1',    'OCI · Melbourne',           -37.814, 144.963],
  ['oci','sa-saopaulo-1',     'OCI · São Paulo',           -23.550, -46.633],
  ['oci','me-jeddah-1',       'OCI · Jeddah',               21.485, 39.192],
  ['oci','me-dubai-1',        'OCI · Dubai',                25.205, 55.271],
  // ── Alibaba Cloud ──
  ['alibaba','cn-hangzhou',   'Alibaba · Hangzhou',         30.273, 120.155],
  ['alibaba','cn-beijing',    'Alibaba · Beijing',          39.904, 116.407],
  ['alibaba','cn-shanghai',   'Alibaba · Shanghai',         31.230, 121.474],
  ['alibaba','cn-shenzhen',   'Alibaba · Shenzhen',         22.543, 114.060],
  ['alibaba','cn-chengdu',    'Alibaba · Chengdu',          30.572, 104.066],
  ['alibaba','cn-hongkong',   'Alibaba · Hong Kong',        22.320, 114.169],
  ['alibaba','ap-southeast-1','Alibaba · Singapore',         1.290, 103.851],
  ['alibaba','ap-northeast-1','Alibaba · Tokyo',            35.676, 139.650],
  ['alibaba','us-east-1',     'Alibaba · Virginia',         39.044, -77.487],
  ['alibaba','us-west-1',     'Alibaba · Silicon Valley',   37.335, -121.891],
  ['alibaba','eu-central-1',  'Alibaba · Frankfurt',        50.110, 8.682],
  ['alibaba','me-east-1',     'Alibaba · Dubai',            25.205, 55.271],
  // ── Cloudflare (selected major edge hubs) ──
  ['cloudflare','SFO','Cloudflare · San Francisco',         37.775, -122.419],
  ['cloudflare','IAD','Cloudflare · Ashburn',               39.044, -77.487],
  ['cloudflare','ORD','Cloudflare · Chicago',               41.878, -87.629],
  ['cloudflare','DFW','Cloudflare · Dallas',                32.779, -96.807],
  ['cloudflare','LAX','Cloudflare · Los Angeles',           34.052, -118.244],
  ['cloudflare','MIA','Cloudflare · Miami',                 25.761, -80.192],
  ['cloudflare','YYZ','Cloudflare · Toronto',               43.653, -79.383],
  ['cloudflare','LHR','Cloudflare · London',                51.507, -0.128],
  ['cloudflare','AMS','Cloudflare · Amsterdam',             52.368, 4.904],
  ['cloudflare','FRA','Cloudflare · Frankfurt',             50.110, 8.682],
  ['cloudflare','CDG','Cloudflare · Paris',                 48.856, 2.352],
  ['cloudflare','MAD','Cloudflare · Madrid',                40.417, -3.703],
  ['cloudflare','WAW','Cloudflare · Warsaw',                52.230, 21.011],
  ['cloudflare','ARN','Cloudflare · Stockholm',             59.329, 18.068],
  ['cloudflare','VIE','Cloudflare · Vienna',                48.208, 16.373],
  ['cloudflare','IST','Cloudflare · Istanbul',              41.013, 28.980],
  ['cloudflare','NRT','Cloudflare · Tokyo',                 35.676, 139.650],
  ['cloudflare','ICN','Cloudflare · Seoul',                 37.566, 126.978],
  ['cloudflare','SIN','Cloudflare · Singapore',              1.290, 103.851],
  ['cloudflare','HKG','Cloudflare · Hong Kong',             22.320, 114.169],
  ['cloudflare','BOM','Cloudflare · Mumbai',                19.076, 72.878],
  ['cloudflare','DEL','Cloudflare · Delhi',                 28.704, 77.103],
  ['cloudflare','SYD','Cloudflare · Sydney',               -33.868, 151.209],
  ['cloudflare','AKL','Cloudflare · Auckland',             -36.848, 174.763],
  ['cloudflare','GRU','Cloudflare · São Paulo',            -23.550, -46.633],
  ['cloudflare','GIG','Cloudflare · Rio de Janeiro',       -22.907, -43.173],
  ['cloudflare','EZE','Cloudflare · Buenos Aires',         -34.603, -58.381],
  ['cloudflare','JNB','Cloudflare · Johannesburg',         -26.204, 28.048],
  ['cloudflare','CPT','Cloudflare · Cape Town',            -33.925, 18.424],
  ['cloudflare','DXB','Cloudflare · Dubai',                 25.205, 55.271],
  ['cloudflare','DOH','Cloudflare · Doha',                  25.286, 51.532],
  ['cloudflare','TLV','Cloudflare · Tel Aviv',              32.085, 34.781],
];

function seedHyperscalers() {
  return HYPERSCALER.map(([op, code, name, lat, lon]) => ({
    id: `${op}-${code}`.toLowerCase(),
    name,
    operator: op,
    region: code,
    lat, lon,
    source: 'hyperscaler',
  }));
}

// ── PeeringDB ────────────────────────────────────────────────────────

async function fetchPeeringDB() {
  try {
    const url = 'https://www.peeringdb.com/api/fac?depth=0';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'gods-eye/1.0 (+https://gods-eye-phi.vercel.app)' },
    });
    if (!res.ok) {
      console.warn('[datacenters] peeringdb HTTP', res.status);
      return [];
    }
    const j = await res.json();
    const rows = Array.isArray(j?.data) ? j.data : [];
    const out = [];
    for (const r of rows) {
      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      if (lat === 0 && lon === 0) continue;  // null island sentinels
      out.push({
        id: 'peeringdb-' + r.id,
        name: r.name,
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
        city: r.city || null,
        country: r.country || null,
        source: 'peeringdb',
      });
    }
    return out;
  } catch (e) {
    console.warn('[datacenters] peeringdb failed:', e.message);
    return [];
  }
}

// ── Assembly ─────────────────────────────────────────────────────────

async function buildList() {
  const hyper = seedHyperscalers();
  const peering = await fetchPeeringDB();
  return {
    generatedAt: Date.now(),
    counts: {
      total: hyper.length + peering.length,
      hyperscaler: hyper.length,
      peeringdb: peering.length,
    },
    datacenters: [...hyper, ...peering],
  };
}

export default async function handler(req, res) {
  const now = Date.now();
  if (!cache || now - cache.generatedAt > CACHE_TTL) {
    try { cache = await buildList(); }
    catch (e) {
      console.warn('[datacenters] build failed:', e.message);
      if (!cache) { res.status(503).json({ error: 'datacenters unavailable', detail: e.message }); return; }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  // 1 h edge cache, 24 h SWR — dataset changes daily at most.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json(cache);
}
