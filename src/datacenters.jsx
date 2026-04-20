/* Data centers client — polls /api/datacenters on load, refresh every
   6 h. The server merges PeeringDB (~4500 carrier-neutral colos) and a
   bundled hyperscaler list (~150 cloud regions). Dataset is static
   enough that frequent refreshes are wasted effort. */

(function () {
  let DCS = [];
  const SUBS = new Set();
  const REFRESH_MS = 6 * 3600 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/datacenters', { cache: 'no-store' });
      if (!r.ok) { console.warn('[datacenters] HTTP', r.status); return; }
      const j = await r.json();
      if (!Array.isArray(j?.datacenters)) return;
      DCS = j.datacenters;
      console.log(`[datacenters] ${DCS.length} loaded (${j.counts?.hyperscaler} hyperscaler + ${j.counts?.peeringdb} peeringdb)`);
      for (const fn of SUBS) { try { fn(DCS); } catch {} }
    } catch (e) {
      console.warn('[datacenters] pull failed', e);
    }
  }

  pull();
  setInterval(pull, REFRESH_MS);

  window.subscribeDatacenters = (cb) => {
    SUBS.add(cb);
    if (DCS.length) { try { cb(DCS); } catch {} }
    return () => SUBS.delete(cb);
  };
  window.__datacenters = () => DCS;
})();
