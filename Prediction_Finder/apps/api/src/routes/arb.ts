import { getDb } from "@prediction-finder/db";
import { sql } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";

// ─── Validation ───────────────────────────────────────────────────────────────

const arbQuerySchema = z.object({
  /**
   * How far back to scan for odds snapshots when computing best lines.
   * Defaults to 10 minutes — wide enough to catch the latest poll cycle.
   */
  window: z.coerce.number().int().positive().max(60).default(10),
  sport: z.string().optional(),
});

// ─── Result types ─────────────────────────────────────────────────────────────

interface ArbOutcome {
  outcome: string;
  bestPrice: number;
  impliedProbability: number;
  sportsbookId: string;
  sportsbookName: string;
}

interface ArbOpportunity {
  market: {
    id: string;
    sport: string;
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    startsAt: Date;
    marketKey: string;
  };
  outcomes: ArbOutcome[];
  /** Sum of best implied probabilities across all outcomes. Always < 1.0 for arbitrage. */
  totalImplied: number;
  /** Guaranteed profit margin as a fraction of total stake (1 − totalImplied). */
  margin: number;
  /** margin expressed as a percentage. */
  marginPct: number;
}

// Raw row returned by the SQL query
interface ArbRow extends Record<string, unknown> {
  id: string;
  sport: string;
  event_name: string;
  home_team: string;
  away_team: string;
  starts_at: Date;
  market_key: string;
  outcomes: Array<{
    outcome: string;
    best_price: number;
    implied_prob: number;
    sportsbook_id: string;
    sportsbook_name: string;
  }>;
  total_implied: string;
  margin: string;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const arbRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // ── GET /arb ──────────────────────────────────────────────────────────────

  app.get(
    "/arb",
    {
      schema: {
        tags: ["arbitrage"],
        summary: "Current arbitrage opportunities",
        description:
          "Scans recent odds snapshots in TimescaleDB and returns markets where the sum " +
          "of best implied probabilities across all outcomes is below 1.0, indicating a " +
          "risk-free profit is achievable by covering all sides in the correct proportions.",
        querystring: {
          type: "object",
          properties: {
            window: {
              type: "number",
              default: 10,
              description: "Look-back window in minutes for recent snapshot data (max 60)",
            },
            sport: {
              type: "string",
              description: "Restrict search to a single sport key",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const query = arbQuerySchema.parse(req.query);

      // ── Query logic ────────────────────────────────────────────────────────
      //
      // 1. latest_per_book   — most recent snapshot per (market, outcome, book)
      //                        within the look-back window.
      // 2. best_per_outcome  — highest decimal price per (market, outcome)
      //                        across all books, with the winning sportsbook.
      // 3. market_summary    — per-market aggregation: sum of implied probs,
      //                        filtered to only those below 1.0 (arbitrage).
      // 4. Final SELECT      — join back to markets for display metadata,
      //                        optionally filtered by sport.
      //
      // Note: DISTINCT ON is PostgreSQL-specific. TimescaleDB runs on top of
      // Postgres so this is safe.

      const sportClause = query.sport
        ? sql`AND m.sport = ${query.sport}`
        : sql``;

      const result = await db.execute<ArbRow>(sql`
        WITH latest_per_book AS (
          SELECT DISTINCT ON (o.market_id, o.outcome, o.sportsbook_id)
            o.market_id,
            o.outcome,
            o.sportsbook_id,
            s.name  AS sportsbook_name,
            o.price_decimal
          FROM odds_snapshots o
          JOIN sportsbooks s ON s.id = o.sportsbook_id
          WHERE o.recorded_at > NOW() - (${query.window} || ' minutes')::interval
          ORDER BY o.market_id, o.outcome, o.sportsbook_id, o.recorded_at DESC
        ),
        best_per_outcome AS (
          SELECT DISTINCT ON (market_id, outcome)
            market_id,
            outcome,
            sportsbook_id,
            sportsbook_name,
            price_decimal                              AS best_price,
            ROUND((1.0 / price_decimal)::numeric, 6)  AS implied_prob
          FROM latest_per_book
          ORDER BY market_id, outcome, price_decimal DESC
        ),
        market_summary AS (
          SELECT
            market_id,
            jsonb_agg(
              jsonb_build_object(
                'outcome',        outcome,
                'best_price',     best_price,
                'implied_prob',   implied_prob,
                'sportsbook_id',  sportsbook_id,
                'sportsbook_name', sportsbook_name
              )
              ORDER BY outcome
            )                                         AS outcomes,
            ROUND(SUM(implied_prob)::numeric, 6)      AS total_implied,
            ROUND((1.0 - SUM(implied_prob))::numeric, 6) AS margin
          FROM best_per_outcome
          GROUP BY market_id
          HAVING SUM(implied_prob) < 1.0
             AND COUNT(*) >= 2
        )
        SELECT
          m.id,
          m.sport,
          m.event_name,
          m.home_team,
          m.away_team,
          m.starts_at,
          m.market_key,
          ms.outcomes,
          ms.total_implied,
          ms.margin
        FROM market_summary ms
        JOIN markets m ON m.id = ms.market_id
        WHERE 1 = 1
          ${sportClause}
        ORDER BY ms.total_implied ASC
        LIMIT 100
      `);

      const opportunities: ArbOpportunity[] = [...result].map((row) => {
        const totalImplied = Number(row.total_implied);
        const margin = Number(row.margin);

        return {
          market: {
            id: row.id,
            sport: row.sport,
            eventName: row.event_name,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            startsAt: row.starts_at,
            marketKey: row.market_key,
          },
          outcomes: row.outcomes.map((o) => ({
            outcome: o.outcome,
            bestPrice: Number(o.best_price),
            impliedProbability: Number(o.implied_prob),
            sportsbookId: o.sportsbook_id,
            sportsbookName: o.sportsbook_name,
          })),
          totalImplied,
          margin,
          marginPct: +(margin * 100).toFixed(3),
        };
      });

      return reply.send({
        data: opportunities,
        count: opportunities.length,
        windowMinutes: query.window,
        updatedAt: new Date().toISOString(),
      });
    },
  );
};
