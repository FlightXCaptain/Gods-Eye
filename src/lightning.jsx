/* Lightning client — subscribes to /api/lightning-stream via SSE, keeps a
   rolling buffer of recent strikes. Globe renders each strike as a bright
   flash that fades over ~3 seconds from its arrival time. */

(function () {
  const STRIKES = [];        // { t, lat, lon, pol }
  const STRIKE_TTL_MS = 3000;
  const MAX = 3000;           // ring buffer cap — busy convective nights burst

  let es = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;

  function prune() {
    const cutoff = Date.now() - STRIKE_TTL_MS;
    while (STRIKES.length && STRIKES[0].t < cutoff) STRIKES.shift();
  }

  function connect() {
    if (es) { try { es.close(); } catch {} }
    console.log('[lightning] opening SSE /api/lightning-stream');
    es = new EventSource('/api/lightning-stream');

    es.addEventListener('b', (ev) => {
      // On-connect buffer — recent strikes from the ring buffer upstream.
      try {
        const list = JSON.parse(ev.data);
        for (const s of list) if (s?.lat != null && s?.lon != null) STRIKES.push(s);
      } catch {}
    });

    es.addEventListener('s', (ev) => {
      try {
        const s = JSON.parse(ev.data);
        if (s?.lat == null || s?.lon == null) return;
        STRIKES.push(s);
        if (STRIKES.length > MAX) STRIKES.splice(0, STRIKES.length - MAX);
      } catch {}
    });

    es.onopen = () => { reconnectDelay = 3000; };

    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(60000, reconnectDelay * 2);
    };
  }

  // Prune stale strikes every 500 ms so the buffer doesn't keep growing
  // when the user leaves a tab idle.
  setInterval(prune, 500);

  connect();

  // Globe reads this each frame — return the slice currently within the
  // fade window. Cheap array scan; strikes only live for ~3 s.
  window.getLightningStrikes = () => STRIKES;
})();
