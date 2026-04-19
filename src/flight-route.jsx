/* Flight route client — thin wrapper around /api/flight-route.
   - In-memory cache per icao24 with a 10-min TTL (matches the server cache).
   - Coalesces concurrent requests for the same icao24 into one network call.
   - Returns null on any failure so the UI can silently degrade. */

(function () {
  const CACHE    = new Map();   // icao24 → { t, route | null }
  const INFLIGHT = new Map();   // icao24 → Promise<route | null>
  const TTL_MS   = 10 * 60 * 1000;

  async function getRoute(icao24) {
    if (!icao24) return null;
    const k = String(icao24).toLowerCase();
    if (!/^[a-f0-9]{6}$/.test(k)) return null;
    const c = CACHE.get(k);
    if (c && Date.now() - c.t < TTL_MS) return c.route;
    if (INFLIGHT.has(k)) return INFLIGHT.get(k);

    const p = (async () => {
      try {
        const r = await fetch(`/api/flight-route?icao24=${k}`);
        // 404 = no route available (negative cache). Treat as success with
        // a null result so we don't retry this icao24 for the TTL window.
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
