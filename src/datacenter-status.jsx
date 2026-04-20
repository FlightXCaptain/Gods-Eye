/* Datacenter status client — polls /api/datacenter-status every 5 min.
   Provides two lookup helpers for the dossier:

     window.getDcProviderStatus(operator)    →  { state, incidents, note? }
     window.getDcRegionIncidents(operator, region) → [ { title, startedAt, severity } ]

   Both return null/[] when we have no data. PeeringDB facilities have
   no status — only hyperscaler regions get real entries. */

(function () {
  let STATUS = { providers: {} };
  const SUBS = new Set();
  const REFRESH_MS = 5 * 60 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/datacenter-status', { cache: 'no-store' });
      if (!r.ok) { console.warn('[dc-status] HTTP', r.status); return; }
      const j = await r.json();
      if (!j?.providers) return;
      STATUS = j;
      const summary = Object.entries(j.providers)
        .map(([op, p]) => `${op}:${p.state}${p.incidents?.length ? `(${p.incidents.length})` : ''}`)
        .join(' ');
      console.log(`[dc-status] ${summary}`);
      for (const fn of SUBS) { try { fn(STATUS); } catch {} }
    } catch (e) {
      console.warn('[dc-status] pull failed', e);
    }
  }

  pull();
  setInterval(pull, REFRESH_MS);

  window.getDcProviderStatus = (operator) => {
    if (!operator) return null;
    return STATUS.providers?.[operator.toLowerCase()] || null;
  };

  window.getDcRegionIncidents = (operator, region) => {
    const p = STATUS.providers?.[String(operator || '').toLowerCase()];
    if (!p?.incidents?.length || !region) return [];
    const needle = String(region).toLowerCase();
    return p.incidents.filter(inc =>
      (inc.regions || []).some(r => String(r).toLowerCase().includes(needle))
    );
  };

  window.subscribeDcStatus = (cb) => {
    SUBS.add(cb);
    if (STATUS.providers) { try { cb(STATUS); } catch {} }
    return () => SUBS.delete(cb);
  };

  window.__dcStatus = () => STATUS;
})();
