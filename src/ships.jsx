/* Ships — AISStream live WebSocket.
   AISStream is a free global AIS feed (requires key). Spec:
   https://aisstream.io/documentation
   We maintain an in-memory map of MMSI → latest ship report and expose it via
   window.subscribeShips(onUpdate). Ships fade out after ~15 min silence. */

(function () {
  const SHIPS = new Map();       // mmsi -> ship
  const SUBS = new Set();
  const STALE_MS = 15 * 60 * 1000;

  // Ship type codes (ITU) grouped to coarse categories for icon/color.
  function category(code) {
    const c = Number(code) || 0;
    if (c >= 60 && c <= 69) return 'passenger';
    if (c >= 70 && c <= 79) return 'cargo';
    if (c >= 80 && c <= 89) return 'tanker';
    if (c >= 30 && c <= 39) return 'fishing';
    if (c >= 36 && c <= 37) return 'sail';
    if (c >= 50 && c <= 59) return 'service';
    if (c >= 40 && c <= 49) return 'highspeed';
    return 'other';
  }

  // AISStream free tier aggressively rate-limits repeated handshakes. Start
  // with a patient 15s backoff and cap at 5min so we don't keep tripping 429s
  // on every page load / tab reopen.
  let ws = null, reconnectTimer = null, reconnectDelay = 15000;
  const RECONNECT_CAP = 5 * 60 * 1000;

  let msgCount = 0;
  let openedAtLeastOnce = false;

  function connect() {
    if (!window.API_KEYS?.AISSTREAM) {
      console.warn('[ships] no AISStream API key — skipping websocket');
      return;
    }
    console.log('[ships] connecting to AISStream…');
    try { ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); }
    catch (e) { console.warn('[ships] WS ctor threw', e); scheduleReconnect(); return; }

    ws.onopen = () => {
      reconnectDelay = 15000;
      openedAtLeastOnce = true;
      console.log('[ships] WS open — subscribing globally');
      ws.send(JSON.stringify({
        APIKey: window.API_KEYS.AISSTREAM,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }));
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      // AISStream auth errors arrive as plain objects without MetaData.
      if (m.error || m.Error) {
        console.warn('[ships] AIS error frame:', m.error || m.Error);
        return;
      }
      msgCount++;
      if (msgCount === 1) console.log('[ships] first message received');
      if (msgCount % 500 === 0) console.log(`[ships] ${msgCount} msgs, ${SHIPS.size} unique vessels`);
      const mmsi = m.MetaData?.MMSI;
      if (!mmsi) return;
      const prev = SHIPS.get(mmsi) || { mmsi };
      const now = Date.now();

      if (m.MessageType === 'PositionReport') {
        const pr = m.Message?.PositionReport || {};
        const lat = pr.Latitude, lon = pr.Longitude;
        if (!isFinite(lat) || !isFinite(lon)) return;
        prev.lat = lat;
        prev.lon = lon;
        prev.cog = pr.Cog;
        prev.sog = pr.Sog;              // knots
        prev.heading = pr.TrueHeading;
        prev.nav = pr.NavigationalStatus;
        prev.time = now;
        prev.name = prev.name || m.MetaData?.ShipName?.trim();
        SHIPS.set(mmsi, prev);
      } else if (m.MessageType === 'ShipStaticData') {
        const sd = m.Message?.ShipStaticData || {};
        prev.name = sd.Name?.trim() || prev.name;
        prev.callsign = sd.CallSign?.trim() || prev.callsign;
        prev.type = sd.Type || prev.type;
        prev.category = category(sd.Type);
        prev.dest = sd.Destination?.trim() || prev.dest;
        prev.dim = sd.Dimension;
        prev.time = prev.time || now;
        SHIPS.set(mmsi, prev);
      }
    };

    ws.onclose = (ev) => {
      console.warn('[ships] WS closed', ev.code, ev.reason || '(no reason)');
      scheduleReconnect();
    };
    ws.onerror = (e) => {
      console.warn('[ships] WS error', e?.message || '(no message)');
      try { ws.close(); } catch {}
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    // If the handshake never opened, the most likely cause is a 429 from
    // AISStream — wait extra long in that case to let the limit clear.
    const delay = openedAtLeastOnce ? reconnectDelay : Math.max(60000, reconnectDelay);
    console.log(`[ships] reconnecting in ${Math.round(delay/1000)}s`);
    reconnectTimer = setTimeout(connect, delay);
    reconnectDelay = Math.min(RECONNECT_CAP, reconnectDelay * 2);
  }

  // Prune stale ships + broadcast every 2s
  setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [k, v] of SHIPS) if (v.time < cutoff) SHIPS.delete(k);
    const list = Array.from(SHIPS.values()).filter(s => s.lat != null);
    for (const fn of SUBS) { try { fn(list); } catch {} }
  }, 2000);

  // Wait for /api/config to populate window.API_KEYS before opening the WS.
  (window.__keysReady || Promise.resolve()).then(connect);

  window.subscribeShips = (onUpdate) => {
    SUBS.add(onUpdate);
    // Immediately deliver current snapshot
    const list = Array.from(SHIPS.values()).filter(s => s.lat != null);
    onUpdate(list);
    return () => SUBS.delete(onUpdate);
  };
  window.__ships = SHIPS;
})();
