/* Ships — SSE client for /api/ships-stream.
   The Vercel function holds a single upstream AISStream WebSocket and fans
   out ship updates to every browser via Server-Sent Events. The API key
   never reaches the browser, and AISStream only sees one connection total
   per warm function instance. */

(function () {
  const SHIPS = new Map();         // mmsi -> ship
  const SUBS = new Set();

  function category(code) {
    const c = Number(code) || 0;
    if (c >= 60 && c <= 69) return 'passenger';
    if (c >= 70 && c <= 79) return 'cargo';
    if (c >= 80 && c <= 89) return 'tanker';
    if (c >= 30 && c <= 39) return 'fishing';
    if (c >= 50 && c <= 59) return 'service';
    if (c >= 40 && c <= 49) return 'highspeed';
    return 'other';
  }

  function normalise(s) {
    if (s.category == null && s.type != null) s.category = category(s.type);
    return s;
  }

  // Fan out the current ship list to subscribers. Called on a throttled
  // interval so a burst of upstream updates (hundreds per second) doesn't
  // force the globe to re-render at the same rate.
  function broadcastSnapshot() {
    const list = [];
    for (const s of SHIPS.values()) if (s.lat != null) list.push(s);
    for (const fn of SUBS) { try { fn(list); } catch {} }
  }

  let es = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;

  function connect() {
    if (es) { try { es.close(); } catch {} }
    console.log('[ships] opening SSE /api/ships-stream');
    es = new EventSource('/api/ships-stream');

    es.addEventListener('s', (ev) => {
      // Snapshot on connect — replaces whatever's currently in memory.
      try {
        const list = JSON.parse(ev.data);
        SHIPS.clear();
        for (const s of list) SHIPS.set(s.mmsi, normalise(s));
        console.log(`[ships] snapshot: ${list.length} vessels`);
        broadcastSnapshot();
      } catch (e) { console.warn('[ships] snapshot parse', e); }
    });

    es.addEventListener('u', (ev) => {
      try {
        const s = JSON.parse(ev.data);
        const prev = SHIPS.get(s.mmsi) || {};
        SHIPS.set(s.mmsi, normalise({ ...prev, ...s }));
      } catch {}
    });

    es.addEventListener('d', (ev) => {
      try {
        const { mmsi } = JSON.parse(ev.data);
        SHIPS.delete(mmsi);
      } catch {}
    });

    es.onopen = () => {
      reconnectDelay = 3000;
      console.log('[ships] SSE open');
    };

    es.onerror = () => {
      console.warn('[ships] SSE error — reconnecting');
      try { es.close(); } catch {}
      es = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(60000, reconnectDelay * 2);
    };
  }

  // Broadcast to subscribers every 2s — fresh enough to feel live, slow
  // enough that the globe isn't redrawing on every AIS ping.
  setInterval(broadcastSnapshot, 2000);

  connect();

  window.subscribeShips = (onUpdate) => {
    SUBS.add(onUpdate);
    const list = [];
    for (const s of SHIPS.values()) if (s.lat != null) list.push(s);
    onUpdate(list);
    return () => SUBS.delete(onUpdate);
  };
  window.__ships = SHIPS;
})();
