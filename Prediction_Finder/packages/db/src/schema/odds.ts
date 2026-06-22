import { doublePrecision, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";
import { sportsbooks } from "./sportsbooks.js";

// ─── Odds Snapshots (TimescaleDB hypertable) ───────────────────────────────
//
// After running migrations, convert this table to a TimescaleDB hypertable:
//
//   SELECT create_hypertable('odds_snapshots', 'recorded_at');
//   SELECT add_compression_policy('odds_snapshots', INTERVAL '7 days');
//   SELECT add_retention_policy('odds_snapshots', INTERVAL '90 days');
//
// TimescaleDB requires the partition column (recorded_at) to be part of every
// UNIQUE constraint and PRIMARY KEY on the table. The composite PK
// (id, recorded_at) satisfies this requirement while keeping id queryable.
//
export const oddsSnapshots = pgTable(
  "odds_snapshots",
  {
    id: uuid("id").notNull().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    sportsbookId: uuid("sportsbook_id")
      .notNull()
      .references(() => sportsbooks.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    priceDecimal: doublePrecision("price_decimal").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.recordedAt] }),
    marketOutcomeIdx: index("odds_snapshots_market_outcome_idx").on(t.marketId, t.outcome),
    sportsbookIdIdx: index("odds_snapshots_sportsbook_id_idx").on(t.sportsbookId),
    // TimescaleDB creates its own chunk-level time index on recorded_at
  }),
);

export type OddsSnapshot = typeof oddsSnapshots.$inferSelect;
export type NewOddsSnapshot = typeof oddsSnapshots.$inferInsert;
