import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const predictionStatusEnum = pgEnum("prediction_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// ─── Predictions ──────────────────────────────────────────────────────────────

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    status: predictionStatusEnum("status").notNull().default("pending"),
    confidence: doublePrecision("confidence"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull(),
    resolveAt: timestamp("resolve_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    outcome: boolean("outcome"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("predictions_status_idx").on(t.status),
    index("predictions_source_idx").on(t.source),
    index("predictions_predicted_at_idx").on(t.predictedAt),
    index("predictions_tags_idx").using("gin", t.tags),
  ],
);

// ─── Prediction Metrics (TimescaleDB hypertable) ──────────────────────────────
//
// After running migrations, convert this table into a TimescaleDB hypertable:
//
//   SELECT create_hypertable('prediction_metrics', 'timestamp');
//   SELECT add_retention_policy('prediction_metrics', INTERVAL '90 days');
//   SELECT add_compression_policy('prediction_metrics', INTERVAL '7 days');
//
export const predictionMetrics = pgTable(
  "prediction_metrics",
  {
    // TimescaleDB requires the time column to be part of the primary key
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    predictionId: uuid("prediction_id")
      .notNull()
      .references(() => predictions.id, { onDelete: "cascade" }),
    metricName: text("metric_name").notNull(),
    value: doublePrecision("value").notNull(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("prediction_metrics_prediction_id_idx").on(t.predictionId),
    index("prediction_metrics_metric_name_idx").on(t.metricName),
    // TimescaleDB will create its own time index on the hypertable
  ],
);

// ─── Sources ──────────────────────────────────────────────────────────────────

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    baseUrl: text("base_url").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    scrapeIntervalMinutes: doublePrecision("scrape_interval_minutes").notNull().default(60),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_is_active_idx").on(t.isActive)],
);

export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;
export type PredictionMetric = typeof predictionMetrics.$inferSelect;
export type NewPredictionMetric = typeof predictionMetrics.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
