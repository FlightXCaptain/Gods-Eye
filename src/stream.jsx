/* Unified SSE client for /api/stream — demuxes ships + flights from a
   single EventSource. Replaces the former src/ships.jsx and
   src/flights-stream.jsx pair.

   Why one connection:
   - Every live SSE connection pins a warm Fluid Compute instance on
     Vercel. Two streams = two instances per visitor, so provisioned-
     memory billing roughly doubled for every tab open. One connection
     still shows both pipelines' data because each server event is
     tagged with a `source:kind` prefix on the SSE `event:` line.

   Wire format (must match api/stream.js):
     event: ship:s    → ship snapshot on connect
     event: ship:u    → single-vessel update
     event: ship:d    → vessel deletion
     event: flight:s  → periodic flight snapshot

   Public API preserved unchanged so callers (globe2.jsx, app2.jsx,
   ships-history.jsx, flight-route.jsx) don't need to know this file
   exists:
     window.subscribeShips(cb)    → unsubscribe fn; cb receives array
     window.subscribeFlights(cb)  → unsubscribe fn; cb receives array
     window.__ships               → Map<mmsi, ship>
     window.__flights             → Map<hex, flight>
*/

(function () {
  // ── Ships state ───────────────────────────────────────────────────
  const SHIPS = new Map();
  const SHIP_SUBS = new Set();

  function shipCategory(code) {
    const c = Number(code) || 0;
    if (c >= 60 && c <= 69) return 'passenger';
    if (c >= 70 && c <= 79) return 'cargo';
    if (c >= 80 && c <= 89) return 'tanker';
    if (c >= 30 && c <= 39) return 'fishing';
    if (c >= 50 && c <= 59) return 'service';
    if (c >= 40 && c <= 49) return 'highspeed';
    return 'other';
  }

  function normaliseShip(s) {
    if (s.category == null && s.type != null) s.category = shipCategory(s.type);
    return s;
  }

  function broadcastShips() {
    const list = [];
    for (const s of SHIPS.values()) if (s.lat != null) list.push(s);
    for (const fn of SHIP_SUBS) { try { fn(list); } catch {} }
  }

  // ── Flights state ─────────────────────────────────────────────────
  const FLIGHTS = new Map();
  const FLIGHT_SUBS = new Set();

  function broadcastFlights() {
    const list = Array.from(FLIGHTS.values());
    for (const fn of FLIGHT_SUBS) { try { fn(list); } catch {} }
  }

  // ── Connection ────────────────────────────────────────────────────
  let es = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;

  function connect() {
    if (es) { try { es.close(); } catch {} }
    console.log('[stream] opening SSE /api/stream');
    es = new EventSource('/api/stream');

    // Ships — snapshot on connect replaces whatever's in memory.
    es.addEventListener('ship:s', (ev) => {
      try {
        const list = JSON.parse(ev.data);
        SHIPS.clear();
        for (const s of list) SHIPS.set(s.mmsi, normaliseShip(s));
        console.log(`[stream] ships snapshot: ${list.length} vessels`);
        broadcastShips();
      } catch (e) { console.warn('[stream] ship snapshot parse', e); }
    });

    es.addEventListener('ship:u', (ev) => {
      try {
        const s = JSON.parse(ev.data);
        const prev = SHIPS.get(s.mmsi) || {};
        SHIPS.set(s.mmsi, normaliseShip({ ...prev, ...s }));
      } catch {}
    });

    es.addEventListener('ship:d', (ev) => {
      try {
        const { mmsi } = JSON.parse(ev.data);
        SHIPS.delete(mmsi);
      } catch {}
    });

    // Flights — server pushes a fresh full list every ~5 s. Replace the
    // map in place so dead entries don't accumulate.
    es.addEventListener('flight:s', (ev) => {
      try {
        const list = JSON.parse(ev.data);
        FLIGHTS.clear();
        for (const f of list) FLIGHTS.set(f.id, f);
        broadcastFlights();
      } catch (e) { console.warn('[stream] flight snapshot parse', e); }
    });

    es.onopen = () => {
      reconnectDelay = 3000;
      console.log('[stream] SSE open');
    };

    es.onerror = () => {
      console.warn('[stream] SSE error — reconnecting');
      try { es.close(); } catch {}
      es = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(60000, reconnectDelay * 2);
    };
  }

  // Throttled re-broadcast to React subscribers — a burst of AIS ticks
  // shouldn't force the globe to re-render once per message. 2 s matches
  // the cadence from the previous separate clients, so downstream
  // animations behave the same as before.
  setInterval(broadcastShips, 2000);
  setInterval(broadcastFlights, 2000);

  connect();

  window.subscribeShips = (onUpdate) => {
    SHIP_SUBS.add(onUpdate);
    const list = [];
    for (const s of SHIPS.values()) if (s.lat != null) list.push(s);
    onUpdate(list);
    return () => SHIP_SUBS.delete(onUpdate);
  };

  window.subscribeFlights = (onUpdate) => {
    FLIGHT_SUBS.add(onUpdate);
    onUpdate(Array.from(FLIGHTS.values()));
    return () => FLIGHT_SUBS.delete(onUpdate);
  };

  window.__ships = SHIPS;
  window.__flights = FLIGHTS;
})();
