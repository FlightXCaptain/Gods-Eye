// Cloudflare Radar — internet outages / anomalies proxy.
//
// Keeps the API token server-side (the client never sees it), caches
// responses for 5 min (Radar annotations update on the order of hours,
// and the endpoint is rate-limited per token), and trims the payload to
// the fields the UI actually uses.

export const config = { runtime: 'nodejs', maxDuration: 15 };

const TTL_MS = 5 * 60 * 1000;
let cache = { ts: 0, data: null };

export default async function handler(req, res) {
  const now = Date.now();
  if (cache.data && now - cache.ts < TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json(cache.data);
  }
  const key = process.env.CLOUDFLARE_API_TOKEN;
  if (!key) return res.status(500).json({ error: 'CLOUDFLARE_API_TOKEN missing' });
  try {
    // 28-day window surfaces both ongoing and recently-resolved incidents.
    // Limit 200 is well above typical volume; outages are rare enough that
    // we've never observed more than ~40 in a 28-day window globally.
    const url = 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=28d&limit=200';
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!j.success) {
      console.warn('[radar-outages] cloudflare error:', JSON.stringify(j.errors));
      return res.status(502).json({ error: 'cloudflare-error' });
    }
    const outages = (j.result?.annotations || []).map(a => ({
      id: a.id,
      eventType: a.eventType || null,
      description: a.description || '',
      startDate: a.startDate || null,
      endDate: a.endDate || null, // null = ongoing
      scope: a.scope || null,
      cause: a.outage?.outageCause || null,
      outageType: a.outage?.outageType || null,
      // Strip geometry to just what's needed for rendering / hover.
      locations: (a.locationsDetails || []).map(l => ({ code: l.code, name: l.name })),
      asns: (a.asnsDetails || []).map(n => ({
        asn: String(n.asn), name: n.name || null,
        location: n.location ? { code: n.location.code, name: n.location.name } : null,
      })),
      linkedUrl: a.linkedUrl || null,
    }));
    cache = { ts: now, data: outages };
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json(outages);
  } catch (err) {
    console.warn('[radar-outages] fetch failed:', String(err));
    return res.status(502).json({ error: 'fetch-failed' });
  }
}
