/* Flights — SSE client for /api/flights-stream.
   The Vercel function fans a single server-side ADS-B aggregation out to
   all browsers, so the state is persistent across page loads (planes don't
   pop in/out every 25 s) and every visitor shares the same upstream poll
   budget. */

(function () {
  const FLIGHTS = new Map();       // hex -> flight record
  const SUBS = new Set();

  function broadcastSnapshot() {
    const list = Array.from(FLIGHTS.values());
    for (const fn of SUBS) { try { fn(list); } catch {} }
  }

  let es = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;

  function connect() {
    if (es) { try { es.close(); } catch {} }
    console.log('[flights] opening SSE /api/flights-stream');
    es = new EventSource('/api/flights-stream');

    es.addEventListener('s', (ev) => {
      try {
        const list = JSON.parse(ev.data);
        // Replace map in-place so we don't accumulate dead entries.
        FLIGHTS.clear();
        for (const f of list) FLIGHTS.set(f.id, f);
        broadcastSnapshot();
      } catch (e) { console.warn('[flights] snapshot parse', e); }
    });

    es.onopen = () => {
      reconnectDelay = 3000;
      console.log('[flights] SSE open');
    };
    es.onerror = () => {
      console.warn('[flights] SSE error — reconnecting');
      try { es.close(); } catch {}
      es = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(60000, reconnectDelay * 2);
    };
  }

  connect();

  // Re-broadcast to React every 2 s regardless of server push cadence —
  // keeps the UI in sync with whatever's currently in the map.
  setInterval(broadcastSnapshot, 2000);

  window.subscribeFlights = (onUpdate) => {
    SUBS.add(onUpdate);
    onUpdate(Array.from(FLIGHTS.values()));
    return () => SUBS.delete(onUpdate);
  };
  window.__flights = FLIGHTS;
})();
