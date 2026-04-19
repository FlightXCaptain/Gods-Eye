// Shared Neon Postgres connection + schema setup for server-side ship
// position history. Used by api/ships-stream.js (writes) and api/ship-
// history.js (reads).
//
// Setup (one-time, in Vercel Marketplace):
//   1. Open the gods-eye project on Vercel.
//   2. Storage → Browse Marketplace → Neon Postgres → Install.
//   3. Vercel auto-provisions env vars (DATABASE_URL / POSTGRES_URL) on
//      the project. No code change needed.
//
// When DATABASE_URL is missing, everything here silently no-ops so the
// app still runs — clients just don't see historical tracks across
// devices. Client still falls back to IndexedDB-accumulated history.

import { neon } from '@neondatabase/serverless';

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;

export const shipDb = CONN ? neon(CONN) : null;
export const shipDbReady = !!shipDb;

// Retention window — prune positions older than 30 days on each write
// cycle. With ~20k sampled MMSIs/hour at our 30-min sample rate, a 30-day
// window holds ~14.4M rows × 20 bytes ≈ 290 MB — within Neon's 0.5 GB
// free tier.
export const SHIP_RETENTION_DAYS = 30;

let schemaPromise = null;

// Idempotent schema bootstrap. Called from any write path before the
// first INSERT; `IF NOT EXISTS` means it's cheap on warm instances.
export async function ensureShipSchema() {
  if (!shipDb) return;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await shipDb`
      CREATE TABLE IF NOT EXISTS ship_positions (
        mmsi INTEGER NOT NULL,
        t    INTEGER NOT NULL,
        lat  REAL    NOT NULL,
        lon  REAL    NOT NULL,
        sog  SMALLINT,
        cog  SMALLINT,
        PRIMARY KEY (mmsi, t)
      )
    `;
    await shipDb`
      CREATE INDEX IF NOT EXISTS ship_positions_t_idx
      ON ship_positions (t)
    `;
    console.log('[ship-db] schema ready');
  })();
  try { await schemaPromise; }
  catch (e) { schemaPromise = null; throw e; }
}
