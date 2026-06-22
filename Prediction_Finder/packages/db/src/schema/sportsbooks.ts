import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

export const sportsbooks = pgTable(
  "sportsbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    region: text("region").notNull(),
    baseUrl: text("base_url").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    regionIdx: index("sportsbooks_region_idx").on(t.region),
    isActiveIdx: index("sportsbooks_is_active_idx").on(t.isActive),
  }),
);

export type Sportsbook = typeof sportsbooks.$inferSelect;
export type NewSportsbook = typeof sportsbooks.$inferInsert;
