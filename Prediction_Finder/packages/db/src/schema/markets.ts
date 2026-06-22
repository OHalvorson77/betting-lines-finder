import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").notNull(),
    eventName: text("event_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    /** External event ID from the odds data provider (e.g. The Odds API). */
    eventId: text("event_id").notNull(),
    /** Bet-type key (e.g. "h2h", "spreads", "totals"). One market record per event × market type. */
    marketKey: text("market_key").notNull(),
  },
  (t) => ({
    sportIdx: index("markets_sport_idx").on(t.sport),
    startsAtIdx: index("markets_starts_at_idx").on(t.startsAt),
    homeTeamIdx: index("markets_home_team_idx").on(t.homeTeam),
    awayTeamIdx: index("markets_away_team_idx").on(t.awayTeam),
    eventMarketUniq: unique("markets_event_id_market_key_uniq").on(t.eventId, t.marketKey),
  }),
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
