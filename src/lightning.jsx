/* Lightning client — connects directly to Blitzortung's public WebSocket
   from the browser.

   We originally ran this through /api/lightning-stream (a Vercel serverless
   WS → SSE fan-out) so that one upstream connection could serve many
   browsers. In practice Blitzortung appears to silently drop server-side
   connections from cloud IP ranges (Vercel/AWS/etc.): the handshake hangs
   with no error or close frame, the function times out at 5 minutes, no
   strikes ever arrive. Their own map.blitzortung.org client connects
   directly from each visitor's browser, so matching that topology is the
   reliable path — Blitzortung already expects thousands of concurrent
   browser subscribers and the WS service is built for that load.

   Protocol (canonical):
     1. Open wss://ws{1..8}.blitzortung.org/ (rotate for load spread)
     2. Send {"a": 111} to subscribe to the global strike feed
     3. Receive TEXT frames. Some servers send plain JSON; others send an
        LZW-compressed form. Decoder below handles both.
*/

(function () {
  const STRIKES = [];
  const STRIKE_TTL_MS = 3000;
  const MAX = 3000;

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;
  const RECONNECT_CAP = 60000;

  // Blitzortung LZW-style decoder. Bytes ≥ 256 reference phrases built
  // during decoding. Canonical impl; shared by their own JS client.
  function decode(msg) {
    const e = {};
    const chars = msg.split('');
    let prev = chars[0];
    let curr = prev;
    const out = [curr];
    let code = 256;
    for (let i = 1; i < chars.length; i++) {
      const cc = chars[i].charCodeAt(0);
      const phrase = cc < 256 ? chars[i] : (e[cc] || (prev + curr));
      out.push(phrase);
      curr = phrase[0];
      e[code] = prev + curr;
      code++;
      prev = phrase;
    }
    return out.join('');
  }

  function prune() {
    const cutoff = Date.now() - STRIKE_TTL_MS;
    while (STRIKES.length && STRIKES[0].t < cutoff) STRIKES.shift();
  }

  function connect() {
    try { if (ws) ws.close(); } catch {}
    const n = 1 + Math.floor(Math.random() * 8);
    const url = `wss://ws${n}.blitzortung.org/`;
    console.log('[lightning] opening', url);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[lightning] WS construct failed', e);
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      reconnectDelay = 3000;
      ws.send(JSON.stringify({ a: 111 }));
    };
    ws.onmessage = (ev) => {
      const text = ev.data;
      if (!text) return;
      let j;
      try {
        j = (text[0] === '{' || text[0] === '[') ? JSON.parse(text) : JSON.parse(decode(text));
      } catch { return; }
      if (typeof j.lat !== 'number' || typeof j.lon !== 'number') return;
      STRIKES.push({ t: Date.now(), lat: +j.lat.toFixed(3), lon: +j.lon.toFixed(3), pol: j.pol || 0 });
      if (STRIKES.length > MAX) STRIKES.splice(0, STRIKES.length - MAX);
    };
    ws.onerror = () => { /* onclose will fire right after */ };
    ws.onclose = () => { scheduleReconnect(); };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(RECONNECT_CAP, reconnectDelay * 2);
  }

  setInterval(prune, 500);
  connect();

  // Globe reads this each frame.
  window.getLightningStrikes = () => STRIKES;
})();
