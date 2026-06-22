import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sport: text("sport").notNull(),
    eventName: text("event_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
  },
  (t) => ({
    sportIdx: index("markets_sport_idx").on(t.sport),
    startsAtIdx: index("markets_starts_at_idx").on(t.startsAt),
    homeTeamIdx: index("markets_home_team_idx").on(t.homeTeam),
    awayTeamIdx: index("markets_away_team_idx").on(t.awayTeam),
  }),
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
