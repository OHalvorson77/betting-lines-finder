import { getDb, getRedis, markets, oddsSnapshots, sportsbooks } from "@prediction-finder/db";
import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";

// ─── Validation schemas ────────────────────────────────────────────────────────

const marketsQuerySchema = z.object({
  sport: z.string().optional(),
  /** When true, only return markets whose game is currently in progress (started < 4 h ago). */
  live: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const historyQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  outcome: z.string().optional(),
  /**
   * TimescaleDB time_bucket interval for aggregation.
   * Defaults to "1 hour". Allowed: "5 minutes" | "15 minutes" | "1 hour" | "6 hours" | "1 day".
   */
  bucket: z
    .enum(["5 minutes", "15 minutes", "1 hour", "6 hours", "1 day"])
    .default("1 hour"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryRow extends Record<string, unknown> {
  bucket: Date;
  outcome: string;
  sportsbook_id: string;
  sportsbook_name: string;
  avg_price: string;
  min_price: string;
  max_price: string;
  sample_count: number;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const marketRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const redis = getRedis();

  // ── GET /markets ────────────────────────────────────────────────────────────

  app.get(
    "/markets",
    {
      schema: {
        tags: ["markets"],
        summary: "List markets with current best lines",
        description:
          "Returns a paginated list of betting markets. Each market is augmented with " +
          "the best available price per outcome, pulled from the Redis best-line cache.",
        querystring: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Filter by sport key (e.g. americanfootball_nfl)",
            },
            live: {
              type: "string",
              description: "When 'true', only return in-progress games (started < 4 h ago)",
            },
            page: { type: "number", default: 1 },
            limit: { type: "number", default: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      const query = marketsQuerySchema.parse(req.query);
      const offset = (query.page - 1) * query.limit;

      // Build WHERE conditions
      const conditions = [];
      if (query.sport) {
        conditions.push(eq(markets.sport, query.sport));
      }
      if (query.live) {
        const now = new Date();
        const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        conditions.push(gte(markets.startsAt, fourHoursAgo));
        conditions.push(lte(markets.startsAt, now));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Fetch page + total in parallel
      const [rows, totalResult] = await Promise.all([
        db
          .select()
          .from(markets)
          .where(where)
          .orderBy(markets.startsAt)
          .limit(query.limit)
          .offset(offset),
        db.select({ value: count() }).from(markets).where(where),
      ]);

      // Augment each market with its Redis-cached best lines
      const data = await Promise.all(
        rows.map(async (market) => {
          const bestLines = await redis.getBestLinesForMarket(market.id);
          return { ...market, bestLines };
        }),
      );

      const total = Number(totalResult[0]?.value ?? 0);

      return reply.send({
        data,
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      });
    },
  );

  // ── GET /markets/:id/history ────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/markets/:id/history",
    {
      schema: {
        tags: ["markets"],
        summary: "Time-series price history for a market",
        description:
          "Returns aggregated odds snapshots from TimescaleDB, bucketed by the requested " +
          "interval. Useful for charting price movement over time.",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", description: "Market UUID" } },
        },
        querystring: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "ISO 8601 start of range (default: 24 hours ago)",
            },
            to: {
              type: "string",
              description: "ISO 8601 end of range (default: now)",
            },
            outcome: {
              type: "string",
              description: "Filter to a single outcome name",
            },
            bucket: {
              type: "string",
              enum: ["5 minutes", "15 minutes", "1 hour", "6 hours", "1 day"],
              description: "TimescaleDB time_bucket interval (default: 1 hour)",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      // Verify the market exists
      const [market] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, id))
        .limit(1);

      if (!market) {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Market not found" },
        });
      }

      const q = historyQuerySchema.parse(req.query);
      const now = new Date();
      const from = q.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const to = q.to ?? now;

      // time_bucket is a TimescaleDB function. If running plain Postgres, replace
      // time_bucket(interval, column) with date_trunc('hour', column) etc.
      const outcomeClause = q.outcome
        ? sql`AND o.outcome = ${q.outcome}`
        : sql``;

      const result = await db.execute<HistoryRow>(sql`
        SELECT
          time_bucket(${q.bucket}::interval, o.recorded_at)  AS bucket,
          o.outcome,
          o.sportsbook_id,
          s.name                                             AS sportsbook_name,
          AVG(o.price_decimal)::float                        AS avg_price,
          MIN(o.price_decimal)::float                        AS min_price,
          MAX(o.price_decimal)::float                        AS max_price,
          COUNT(*)::int                                      AS sample_count
        FROM odds_snapshots o
        JOIN sportsbooks s ON o.sportsbook_id = s.id
        WHERE o.market_id  = ${id}::uuid
          AND o.recorded_at >= ${from}::timestamptz
          AND o.recorded_at <= ${to}::timestamptz
          ${outcomeClause}
        GROUP BY bucket, o.outcome, o.sportsbook_id, s.name
        ORDER BY bucket ASC, o.outcome
      `);

      const rows = [...result].map((r) => ({
        bucket: r.bucket,
        outcome: r.outcome,
        sportsbookId: r.sportsbook_id,
        sportsbookName: r.sportsbook_name,
        avgPrice: Number(r.avg_price),
        minPrice: Number(r.min_price),
        maxPrice: Number(r.max_price),
        sampleCount: r.sample_count,
      }));

      return reply.send({
        marketId: id,
        market: {
          sport: market.sport,
          eventName: market.eventName,
          homeTeam: market.homeTeam,
          awayTeam: market.awayTeam,
          startsAt: market.startsAt,
          marketKey: market.marketKey,
        },
        bucket: q.bucket,
        from: from.toISOString(),
        to: to.toISOString(),
        data: rows,
      });
    },
  );
};
