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

  let ws = null, reconnectTimer = null, reconnectDelay = 2000;

  function connect() {
    if (!window.API_KEYS?.AISSTREAM) {
      console.warn('[ships] no AISStream API key');
      return;
    }
    try { ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); }
    catch (e) { scheduleReconnect(); return; }

    ws.onopen = () => {
      reconnectDelay = 2000;
      // Whole globe — single bounding box, per AISStream docs.
      ws.send(JSON.stringify({
        APIKey: window.API_KEYS.AISSTREAM,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }));
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
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

    ws.onclose = () => scheduleReconnect();
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(30000, reconnectDelay * 1.6);
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
