/* Lightning client — connects directly to Blitzortung's public WebSocket
   from the browser.

   We originally proxied this through /api/lightning-stream (Vercel
   serverless WS → SSE fan-out) so one upstream connection could serve
   many browsers. In practice Blitzortung silently drops connections
   from cloud IP ranges (Vercel/AWS): the handshake hangs with no error
   or close frame, the function times out at 5 minutes, no strikes ever
   arrive. Their own map.blitzortung.org client connects directly from
   each visitor's browser, so matching that topology is the reliable
   path — their WS is built for thousands of concurrent browser
   subscribers and that's exactly the load it expects.

   Protocol (canonical, mirrors what their own client does):
     1. Open wss://ws{1..8}.blitzortung.org/ (rotate for load spread)
     2. Send {"a": 111} to subscribe to the global strike feed
     3. Receive TEXT frames. Some servers send plain JSON; others use
        an LZW-compressed form. Decoder below handles both.
*/

(function () {
  const STRIKES = [];
  const STRIKE_TTL_MS = 3000;
  const MAX = 3000;

  let ws = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;
  const RECONNECT_CAP = 60000;

  // Blitzortung LZW decoder — bytes ≥ 256 reference phrases built up
  // during decoding. Canonical impl shared by their own JS client.
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
    let msgsSinceLog = 0;
    let strikesSinceLog = 0;
    let statsTimer = null;
    ws.onopen = () => {
      reconnectDelay = 3000;
      ws.send(JSON.stringify({ a: 111 }));
      console.log(`[lightning] WS open → ${url} — subscribed {a:111}`);
      // Periodic stats so the user can see in DevTools whether
      // strikes are actually flowing through.
      if (statsTimer) clearInterval(statsTimer);
      statsTimer = setInterval(() => {
        if (msgsSinceLog || strikesSinceLog) {
          console.log(`[lightning] 30s: ${msgsSinceLog} msgs, ${strikesSinceLog} strikes`);
        } else {
          console.warn('[lightning] 30s: NO messages — Blitzortung WS silent');
        }
        msgsSinceLog = 0;
        strikesSinceLog = 0;
      }, 30000);
    };
    ws.onmessage = (ev) => {
      msgsSinceLog++;
      const text = ev.data;
      if (!text) return;
      let j;
      try {
        // Always decode. Blitzortung's LZW output preserves the first
        // character of the original payload, so it always starts with
        // '{' — meaning the old "is it plain JSON?" heuristic was a
        // false positive that left the high-codepoint dictionary refs
        // (Ć, Ċ, ė ...) embedded in what JSON.parse thought was JSON.
        // The decoder is safe on plain ASCII too: every char < 256 is
        // treated as a literal, so a plain-JSON input round-trips
        // unchanged. No heuristic needed.
        j = JSON.parse(decode(text));
      } catch (err) {
        if (msgsSinceLog <= 2) console.warn('[lightning] parse fail, first bytes:', String(text).slice(0, 60));
        return;
      }
      if (typeof j.lat !== 'number' || typeof j.lon !== 'number') {
        if (msgsSinceLog <= 2) console.warn('[lightning] msg without lat/lon, keys:', Object.keys(j).slice(0, 8));
        return;
      }
      strikesSinceLog++;
      STRIKES.push({ t: Date.now(), lat: +j.lat.toFixed(3), lon: +j.lon.toFixed(3), pol: j.pol || 0 });
      if (STRIKES.length > MAX) STRIKES.splice(0, STRIKES.length - MAX);
    };
    ws.onerror = (e) => {
      console.warn('[lightning] WS error', e?.message || '(no detail)');
    };
    ws.onclose = (e) => {
      if (statsTimer) clearInterval(statsTimer);
      statsTimer = null;
      console.warn(`[lightning] WS close code=${e.code} clean=${e.wasClean} reason=${e.reason || '(none)'}`);
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(RECONNECT_CAP, reconnectDelay * 2);
  }

  setInterval(prune, 500);
  connect();

  window.getLightningStrikes = () => STRIKES;
})();
