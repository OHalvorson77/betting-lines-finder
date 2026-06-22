-- Migration: Add event_id and market_key to markets for OddsProcessor upsert
--
-- event_id  — external provider event ID (e.g. The Odds API event UUID)
-- market_key — bet-type identifier: "h2h" | "spreads" | "totals" | "outrights"
--
-- Together they form a natural unique key that lets the OddsProcessor do
-- idempotent upserts without table-scanning for duplicates.

ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "event_id"   text;
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "market_key" text;

-- Backfill any pre-existing rows so we can set NOT NULL safely.
UPDATE "markets"
SET
  "event_id"   = id::text,
  "market_key" = 'h2h'
WHERE "event_id" IS NULL OR "market_key" IS NULL;

ALTER TABLE "markets" ALTER COLUMN "event_id"   SET NOT NULL;
ALTER TABLE "markets" ALTER COLUMN "market_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "markets_event_id_market_key_uniq"
  ON "markets" ("event_id", "market_key");
