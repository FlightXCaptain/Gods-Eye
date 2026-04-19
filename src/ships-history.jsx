/* Ships history — per-vessel position accumulator backed by IndexedDB.

   The server-side AIS stream only buffers ~10 recent positions per vessel
   in module memory, and nothing persists across Fluid Compute cold starts.
   There's no free historical AIS API worth using (MarineTraffic charges,
   GFW only covers fishing). So: accumulate what we can see from the client
   as the user browses, persist it in IndexedDB, and surface the track
   when a vessel is focused.

   Honest limitations (surfaced in the dossier UI):
   - "30-day history" means up to 30 days of samples collected while the
     user's browser has been running. A user who just loaded the site sees
     nothing; a user who had the tab open yesterday sees yesterday's track.
   - Sampling is throttled to one position per MMSI every 3 minutes so
     IndexedDB doesn't balloon. With ~5k active vessels visible at any
     given time that's still ~1M records after 30 days — we cap total
     vessels tracked to 8000 LRU and prune positions older than 30 days
     on a loose cadence.

   Exposes:
     window.getShipHistory(mmsi) → Promise<{ mmsi, positions: [{t, lon, lat, sog?, cog?}], firstSeen, lastSeen, count }>
     window.getShipHistoryStats()     → Promise<{ vesselCount, sampleCount, dbSizeBytes? }>
*/

(function () {
  if (typeof window === 'undefined' || !window.indexedDB) return;

  const DB_NAME         = 'ge-ships-v1';
  const DB_VERSION      = 1;
  const STORE_POS       = 'positions';   // keyPath: [mmsi, t]
  const STORE_META      = 'meta';        // keyPath: mmsi
  const SAMPLE_INTERVAL = 3 * 60 * 1000; // one sample per MMSI per 3 min
  const RETENTION_MS    = 30 * 24 * 3600 * 1000;
  const MAX_VESSELS     = 8000;
  const PRUNE_EVERY_MS  = 5 * 60 * 1000;

  // ── DB open ─────────────────────────────────────────────────────────
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_POS)) {
          // Composite key [mmsi, t] — lets us range-query per-MMSI by time.
          const s = db.createObjectStore(STORE_POS, { keyPath: ['mmsi', 't'] });
          s.createIndex('t', 't');
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          const m = db.createObjectStore(STORE_META, { keyPath: 'mmsi' });
          m.createIndex('lastUpdate', 'lastUpdate');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, stores) {
    return openDb().then(db => {
      const t = db.transaction(stores, mode);
      return { tx: t, stores: Object.fromEntries(stores.map(n => [n, t.objectStore(n)])) };
    });
  }

  // Wrap a single-request cursor / put / get in a promise.
  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // ── Recording ───────────────────────────────────────────────────────

  // In-memory throttle: `mmsi -> lastRecordedT`. Avoids hammering IDB on
  // every 2-second broadcast when we've already recorded the vessel
  // recently. Rebuilt at module load from the meta store so we don't
  // re-record positions across page reloads.
  const lastRecorded = new Map();

  let recordingEnabled = false;

  async function hydrateThrottleMap() {
    const { stores } = await tx('readonly', [STORE_META]);
    const allReq = stores[STORE_META].getAll();
    const metas = await reqToPromise(allReq);
    for (const m of metas) {
      if (m?.mmsi && m.lastUpdate) lastRecorded.set(m.mmsi, m.lastUpdate);
    }
    recordingEnabled = true;
  }

  async function recordBatch(ships) {
    if (!recordingEnabled || !ships?.length) return;
    const now = Date.now();
    const toWrite = [];
    const metaUpdates = [];
    for (const s of ships) {
      if (!s?.mmsi || typeof s.lat !== 'number' || typeof s.lon !== 'number') continue;
      const prevT = lastRecorded.get(s.mmsi) || 0;
      if (now - prevT < SAMPLE_INTERVAL) continue;
      lastRecorded.set(s.mmsi, now);
      toWrite.push({
        mmsi: s.mmsi, t: now,
        lon: +s.lon.toFixed(4), lat: +s.lat.toFixed(4),
        sog: typeof s.sog === 'number' ? +s.sog.toFixed(1) : undefined,
        cog: typeof s.cog === 'number' ? +s.cog.toFixed(0) : undefined,
      });
      metaUpdates.push({
        mmsi: s.mmsi,
        lastUpdate: now,
        name: s.name || undefined,
        category: s.category || undefined,
      });
    }
    if (!toWrite.length) return;
    try {
      const { stores } = await tx('readwrite', [STORE_POS, STORE_META]);
      for (const p of toWrite)       stores[STORE_POS].put(p);
      for (const m of metaUpdates)   stores[STORE_META].put(m);
    } catch (e) {
      console.warn('[ships-history] write failed', e);
    }
  }

  // ── Query ───────────────────────────────────────────────────────────

  async function getHistory(mmsi) {
    if (!mmsi) return null;
    const { stores } = await tx('readonly', [STORE_POS, STORE_META]);
    // IDBKeyRange for all positions of this mmsi — composite key between
    // [mmsi, 0] and [mmsi, +∞].
    const range = IDBKeyRange.bound([mmsi, 0], [mmsi, Number.MAX_SAFE_INTEGER]);
    const positions = [];
    await new Promise((resolve, reject) => {
      const req = stores[STORE_POS].openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        positions.push(c.value);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const metaReq = stores[STORE_META].get(mmsi);
    const meta = await reqToPromise(metaReq);
    if (!positions.length) return { mmsi, positions: [], firstSeen: null, lastSeen: null, count: 0, meta };
    positions.sort((a, b) => a.t - b.t);
    return {
      mmsi,
      positions,
      firstSeen: positions[0].t,
      lastSeen:  positions[positions.length - 1].t,
      count:     positions.length,
      meta,
    };
  }

  async function getStats() {
    try {
      const { stores } = await tx('readonly', [STORE_META]);
      const vesselCount = await reqToPromise(stores[STORE_META].count());
      return { vesselCount };
    } catch { return { vesselCount: 0 }; }
  }

  // ── Pruning ─────────────────────────────────────────────────────────
  //
  // Runs on a loose cadence — once at load and then every 5 minutes. Two
  // passes:
  //   1. Delete any position older than RETENTION_MS regardless of MMSI.
  //   2. If the meta store has more than MAX_VESSELS entries, delete the
  //      least-recently-updated ones (LRU) and purge their positions.

  async function prune() {
    const now = Date.now();
    const ttlCutoff = now - RETENTION_MS;
    try {
      // Pass 1 — TTL.
      const { stores: s1 } = await tx('readwrite', [STORE_POS]);
      const oldReq = s1[STORE_POS].index('t').openCursor(IDBKeyRange.upperBound(ttlCutoff));
      await new Promise((resolve) => {
        oldReq.onsuccess = () => {
          const c = oldReq.result;
          if (!c) return resolve();
          c.delete();
          c.continue();
        };
        oldReq.onerror = () => resolve();
      });

      // Pass 2 — LRU vessel cap.
      const { stores: s2 } = await tx('readwrite', [STORE_META, STORE_POS]);
      const metaCount = await reqToPromise(s2[STORE_META].count());
      if (metaCount > MAX_VESSELS) {
        const toRemove = metaCount - MAX_VESSELS;
        const cur = s2[STORE_META].index('lastUpdate').openCursor();
        let removed = 0;
        await new Promise((resolve) => {
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c || removed >= toRemove) return resolve();
            const m = c.value;
            c.delete();
            // Cascade-delete positions for this mmsi.
            const r = IDBKeyRange.bound([m.mmsi, 0], [m.mmsi, Number.MAX_SAFE_INTEGER]);
            s2[STORE_POS].delete(r);
            lastRecorded.delete(m.mmsi);
            removed++;
            c.continue();
          };
          cur.onerror = () => resolve();
        });
      }
    } catch (e) {
      console.warn('[ships-history] prune failed', e);
    }
  }

  // ── Bootstrap ───────────────────────────────────────────────────────

  hydrateThrottleMap().then(() => {
    // Prune once immediately so stale data doesn't linger past reload.
    prune();
    // Subscribe to the live ship broadcasts. ships.jsx's subscribeShips
    // fires every 2 seconds with the current full list; our throttle
    // ensures we only write one sample per MMSI per SAMPLE_INTERVAL.
    const sub = () => {
      if (typeof window.subscribeShips !== 'function') { setTimeout(sub, 500); return; }
      window.subscribeShips((list) => { recordBatch(list); });
    };
    sub();
    // Loose periodic prune.
    setInterval(prune, PRUNE_EVERY_MS);
  }).catch((e) => {
    console.warn('[ships-history] hydrate failed — disabled', e);
  });

  window.getShipHistory      = getHistory;
  window.getShipHistoryStats = getStats;
})();
