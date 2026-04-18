/* Keys are loaded at runtime from /api/config (backed by Vercel env vars).
   src/ships.jsx awaits window.__keysReady before opening the AIS websocket. */
window.API_KEYS = {};
window.__keysReady = (async () => {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error('config ' + res.status);
    const cfg = await res.json();
    if (cfg.aisstreamKey) window.API_KEYS.AISSTREAM = cfg.aisstreamKey;
  } catch (e) {
    console.warn('[keys] config fetch failed — ships layer will be disabled', e);
  }
})();
