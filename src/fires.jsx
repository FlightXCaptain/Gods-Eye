/* NASA FIRMS active fires — polls /api/fires every 15 min, broadcasts the
   current detection list. Dataset is typically 15-40k points per day. */

(function () {
  let FIRES = [];
  const SUBS = new Set();
  const REFRESH_MS = 15 * 60 * 1000;

  async function pull() {
    try {
      const r = await fetch('/api/fires', { cache: 'no-store' });
      if (!r.ok) {
        // 503 + auth_required → silently disable. 502 → transient, retry next tick.
        if (r.status === 503) {
          try {
            const j = await r.json();
            if (j?.auth_required) console.info('[fires] disabled — set FIRMS_MAP_KEY');
          } catch {}
        } else {
          console.warn('[fires] HTTP', r.status);
        }
        return;
      }
      const j = await r.json();
      FIRES = Array.isArray(j?.fires) ? j.fires : [];
      console.log(`[fires] ${FIRES.length} detections (${j.sensor}/${j.days}d)`);
      for (const fn of SUBS) { try { fn(FIRES); } catch {} }
    } catch (e) {
      console.warn('[fires] pull failed', e);
    }
  }

  pull();
  setInterval(pull, REFRESH_MS);

  window.subscribeFires = (cb) => {
    SUBS.add(cb);
    if (FIRES.length) { try { cb(FIRES); } catch {} }
    return () => SUBS.delete(cb);
  };
  window.__fires = () => FIRES;
})();
