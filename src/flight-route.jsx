/* Flight route client — thin wrapper around /api/flight-route (ADSBdb).
   - In-memory cache per callsign with a 10-min TTL (matches the server cache).
   - Coalesces concurrent requests for the same callsign into one network call.
   - Returns null on any failure so the UI can silently degrade. */

(function () {
  const CACHE    = new Map();   // callsign → { t, route | null }
  const INFLIGHT = new Map();   // callsign → Promise<route | null>
  const TTL_MS   = 10 * 60 * 1000;

  async function getRoute(callsign) {
    if (!callsign) return null;
    const k = String(callsign).toUpperCase().trim();
    if (!/^[A-Z0-9]{3,10}$/.test(k)) return null;
    const c = CACHE.get(k);
    if (c && Date.now() - c.t < TTL_MS) return c.route;
    if (INFLIGHT.has(k)) return INFLIGHT.get(k);

    const p = (async () => {
      try {
        const r = await fetch(`/api/flight-route?callsign=${encodeURIComponent(k)}`);
        // 404 = no route available (negative cache). Treat as success with
        // a null result so we don't retry this callsign for the TTL window.
        const route = r.ok ? await r.json() : null;
        CACHE.set(k, { t: Date.now(), route });
        return route;
      } catch {
        // Network error — don't negative-cache, try again next time.
        return null;
      } finally {
        INFLIGHT.delete(k);
      }
    })();
    INFLIGHT.set(k, p);
    return p;
  }

  window.getFlightRoute = getRoute;
})();
