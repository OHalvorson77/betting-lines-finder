import { and, eq } from "drizzle-orm";
import { Redis as IORedis } from "ioredis";
import { type DbClient, markets, oddsSnapshots, sportsbooks } from "@prediction-finder/db";
import { ODDS_STREAM } from "../ingester/OddsApiIngester.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CONSUMER_GROUP = "odds-processor";
const CONSUMER_NAME = `odds-processor-${process.pid}`;
const BATCH_SIZE = 100;
/** Block up to this many ms waiting for new stream entries before looping. */
const BLOCK_MS = 5_000;
const BEST_LINES_CHANNEL = "best-lines";
const BEST_LINE_TTL_SECS = 60;
const SNAPSHOT_CHUNK_SIZE = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

type XReadGroupReply = Array<[string, Array<[string, string[]]>]> | null;

interface ParsedEntry {
  /** Redis Stream message ID — used for XACK. */
  id: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  bookmakerKey: string;
  bookmakerTitle: string;
  marketKey: string;
  outcome: string;
  /** Decimal odds (e.g. 1.9091 for -110 American). */
  priceDecimal: number;
  /** Implied probability = 1 / priceDecimal. */
  impliedProbability: number;
  point?: number;
  recordedAt: Date;
  /** Populated by resolveMarkets(). Undefined when DB resolution fails. */
  marketId: string | undefined;
  /** Populated by resolveSportsbooks(). Undefined when DB resolution fails. */
  sportsbookId: string | undefined;
}

/** An entry whose market and sportsbook IDs have been fully resolved. */
type ResolvedEntry = ParsedEntry & { marketId: string; sportsbookId: string };

/** Best price available for a single (marketId, outcome) pair across all books. */
interface BestOutcomeLine {
  outcome: string;
  priceDecimal: number;
  impliedProbability: number;
  bookmakerKey: string;
  bookmakerTitle: string;
  sportsbookId: string;
  point?: number;
  recordedAt: string;
}

/** Published to the "best-lines" pub/sub channel after each batch. */
interface MarketBestLines {
  marketId: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  outcomes: BestOutcomeLine[];
  /**
   * True when the sum of best implied probabilities across all outcomes is < 1.0,
   * meaning a risk-free profit is theoretically available by covering every side.
   */
  isArbitrage: boolean;
  /**
   * When isArbitrage is true: 1 − Σ(implied probabilities), i.e. the guaranteed
   * profit margin as a fraction of stake. Null otherwise.
   */
  arbitrageMargin: number | null;
  processedAt: string;
}

export interface OddsProcessorConfig {
  /** IORedis connection — must have maxRetriesPerRequest: null for BLOCK commands. */
  redis: IORedis;
  db: DbClient;
}

// ─── OddsProcessor ────────────────────────────────────────────────────────────

export class OddsProcessor {
  private readonly redis: IORedis;
  private readonly db: DbClient;
  private running = false;

  /** eventId:marketKey → market UUID — prevents redundant upsert queries. */
  private readonly marketIdCache = new Map<string, string>();
  /** bookmakerKey → sportsbook UUID — prevents redundant upsert queries. */
  private readonly sportsbookIdCache = new Map<string, string>();

  constructor(config: OddsProcessorConfig) {
    this.redis = config.redis;
    this.db = config.db;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.initConsumerGroup();
    this.running = true;
    console.log(
      `[OddsProcessor] Started — stream=${ODDS_STREAM} group=${CONSUMER_GROUP} consumer=${CONSUMER_NAME}`,
    );
    void this.loop();
  }

  stop(): void {
    this.running = false;
    console.log("[OddsProcessor] Stopping after current batch completes…");
  }

  // ─── Consumer group init ───────────────────────────────────────────────────

  private async initConsumerGroup(): Promise<void> {
    try {
      // "$" = start from now (skip historical messages already in the stream).
      // MKSTREAM creates the stream key if it does not yet exist.
      await (this.redis as IORedis).call(
        "XGROUP",
        "CREATE",
        ODDS_STREAM,
        CONSUMER_GROUP,
        "$",
        "MKSTREAM",
      );
      console.log(`[OddsProcessor] Consumer group "${CONSUMER_GROUP}" created`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("BUSYGROUP")) {
        // Group already exists — this is fine on restart.
        console.log(`[OddsProcessor] Consumer group "${CONSUMER_GROUP}" already exists`);
        return;
      }
      throw err;
    }
  }

  // ─── Processing loop ───────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.processBatch();
      } catch (err) {
        console.error("[OddsProcessor] Unhandled error in batch loop:", err);
        // Back off briefly to avoid hammering resources on persistent errors.
        await new Promise<void>((r) => setTimeout(r, 1_000));
      }
    }
    console.log("[OddsProcessor] Stopped");
  }

  private async processBatch(): Promise<void> {
    // Block for up to BLOCK_MS waiting for new messages from the stream.
    // ">" means: deliver only messages not yet delivered to this consumer group.
    const reply = (await (this.redis as IORedis).call(
      "XREADGROUP",
      "GROUP",
      CONSUMER_GROUP,
      CONSUMER_NAME,
      "COUNT",
      String(BATCH_SIZE),
      "BLOCK",
      String(BLOCK_MS),
      "STREAMS",
      ODDS_STREAM,
      ">",
    )) as XReadGroupReply;

    // null = BLOCK timeout elapsed with no new messages — just return.
    if (!reply) return;

    const [, rawEntries] = reply[0]!;
    if (!rawEntries || rawEntries.length === 0) return;

    const entries = rawEntries.map(([id, fields]) => this.parseEntry(id, fields));

    // ── Phase 1: Resolve DB IDs ─────────────────────────────────────────────
    // Run market and sportsbook resolution in parallel — they don't depend on each other.
    await Promise.all([this.resolveMarkets(entries), this.resolveSportsbooks(entries)]);

    const resolved = entries.filter(
      (e): e is ResolvedEntry => e.marketId !== undefined && e.sportsbookId !== undefined,
    );

    const unresolved = entries.length - resolved.length;
    if (unresolved > 0) {
      console.warn(`[OddsProcessor] ${unresolved} entries skipped — DB resolution failed`);
    }

    // ── Phase 2: Write raw snapshots to TimescaleDB ─────────────────────────
    if (resolved.length > 0) {
      await this.writeSnapshots(resolved);
    }

    // ── Phase 3: Aggregate best lines ──────────────────────────────────────
    const marketBestLines = this.aggregateBestLines(resolved);

    // ── Phase 4: Detect arbitrage, update cache, publish ───────────────────
    await this.publishBestLines(marketBestLines);

    // ── Phase 5: Acknowledge all messages ──────────────────────────────────
    // Acknowledge even entries that failed resolution — they won't be retried.
    // A dead-letter or PEL claim strategy can handle truly unprocessable messages.
    const ids = entries.map((e) => e.id);
    await (this.redis as IORedis).call("XACK", ODDS_STREAM, CONSUMER_GROUP, ...ids);

    const arbitrageCount = marketBestLines.filter((m) => m.isArbitrage).length;
    console.log(
      `[OddsProcessor] Batch done — entries=${resolved.length} markets=${marketBestLines.length}` +
        (arbitrageCount > 0 ? ` ARBITRAGE=${arbitrageCount}` : ""),
    );
  }

  // ─── Parsing ───────────────────────────────────────────────────────────────

  private parseEntry(id: string, fields: string[]): ParsedEntry {
    // Stream fields arrive as a flat [key, value, key, value, …] array.
    const f: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      f[fields[i]!] = fields[i + 1]!;
    }

    const priceDecimal = Number(f["priceDecimal"]);
    return {
      id,
      eventId: f["eventId"]!,
      sport: f["sport"]!,
      homeTeam: f["homeTeam"]!,
      awayTeam: f["awayTeam"]!,
      commenceTime: new Date(f["commenceTime"]!),
      bookmakerKey: f["bookmakerKey"]!,
      bookmakerTitle: f["bookmakerTitle"]!,
      marketKey: f["marketKey"]!,
      outcome: f["outcome"]!,
      priceDecimal,
      // Round to 6 decimal places to avoid floating-point noise in sums.
      impliedProbability: +(1 / priceDecimal).toFixed(6),
      ...(f["point"] !== undefined ? { point: Number(f["point"]) } : {}),
      recordedAt: new Date(f["recordedAt"]!),
      marketId: undefined,
      sportsbookId: undefined,
    };
  }

  // ─── Market resolution ─────────────────────────────────────────────────────

  private async resolveMarkets(entries: ParsedEntry[]): Promise<void> {
    // Collect unique (eventId, marketKey) pairs not yet in cache.
    const needsUpsert = new Map<string, ParsedEntry>();
    for (const e of entries) {
      const key = `${e.eventId}:${e.marketKey}`;
      if (!this.marketIdCache.has(key)) needsUpsert.set(key, e);
    }

    // Upsert each unique market; cache the returned UUID.
    for (const [key, e] of needsUpsert) {
      try {
        const id = await this.upsertMarket(e);
        this.marketIdCache.set(key, id);
      } catch (err) {
        console.error(
          `[OddsProcessor] Failed to upsert market eventId=${e.eventId} marketKey=${e.marketKey}:`,
          err,
        );
      }
    }

    // Stamp resolved IDs back onto every entry.
    for (const e of entries) {
      e.marketId = this.marketIdCache.get(`${e.eventId}:${e.marketKey}`);
    }
  }

  private async upsertMarket(e: ParsedEntry): Promise<string> {
    await this.db
      .insert(markets)
      .values({
        sport: e.sport,
        eventName: `${e.homeTeam} vs ${e.awayTeam}`,
        startsAt: e.commenceTime,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        eventId: e.eventId,
        marketKey: e.marketKey,
      })
      .onConflictDoNothing({ target: [markets.eventId, markets.marketKey] });

    const [row] = await this.db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.eventId, e.eventId), eq(markets.marketKey, e.marketKey)));

    if (!row) {
      throw new Error(
        `Market upsert failed: eventId=${e.eventId} marketKey=${e.marketKey}`,
      );
    }
    return row.id;
  }

  // ─── Sportsbook resolution ─────────────────────────────────────────────────

  private async resolveSportsbooks(entries: ParsedEntry[]): Promise<void> {
    const needsUpsert = new Map<string, ParsedEntry>();
    for (const e of entries) {
      if (!this.sportsbookIdCache.has(e.bookmakerKey)) needsUpsert.set(e.bookmakerKey, e);
    }

    for (const [key, e] of needsUpsert) {
      try {
        const id = await this.upsertSportsbook(e);
        this.sportsbookIdCache.set(key, id);
      } catch (err) {
        console.error(
          `[OddsProcessor] Failed to upsert sportsbook bookmakerKey=${e.bookmakerKey}:`,
          err,
        );
      }
    }

    for (const e of entries) {
      e.sportsbookId = this.sportsbookIdCache.get(e.bookmakerKey);
    }
  }

  private async upsertSportsbook(e: ParsedEntry): Promise<string> {
    await this.db
      .insert(sportsbooks)
      .values({
        name: e.bookmakerTitle,
        region: "us",
        baseUrl: `https://www.${e.bookmakerKey}.com`,
        isActive: true,
      })
      .onConflictDoNothing({ target: sportsbooks.name });

    const [row] = await this.db
      .select({ id: sportsbooks.id })
      .from(sportsbooks)
      .where(eq(sportsbooks.name, e.bookmakerTitle));

    if (!row) {
      throw new Error(`Sportsbook upsert failed: bookmakerKey=${e.bookmakerKey}`);
    }
    return row.id;
  }

  // ─── TimescaleDB snapshots ─────────────────────────────────────────────────

  private async writeSnapshots(entries: ResolvedEntry[]): Promise<void> {
    const rows = entries.map((e) => ({
      marketId: e.marketId,
      sportsbookId: e.sportsbookId,
      outcome: e.outcome,
      priceDecimal: e.priceDecimal,
      recordedAt: e.recordedAt,
    }));

    // Insert in chunks to keep individual query sizes manageable.
    for (let i = 0; i < rows.length; i += SNAPSHOT_CHUNK_SIZE) {
      await this.db.insert(oddsSnapshots).values(rows.slice(i, i + SNAPSHOT_CHUNK_SIZE));
    }
  }

  // ─── Best-line aggregation ─────────────────────────────────────────────────

  private aggregateBestLines(entries: ResolvedEntry[]): MarketBestLines[] {
    // Group all entries by marketId.
    const byMarket = new Map<string, ResolvedEntry[]>();
    for (const e of entries) {
      const group = byMarket.get(e.marketId) ?? [];
      group.push(e);
      byMarket.set(e.marketId, group);
    }

    const results: MarketBestLines[] = [];

    for (const [marketId, marketEntries] of byMarket) {
      // For each outcome, pick the bookmaker offering the highest decimal price
      // (= most favourable odds for the bettor).
      const bestPerOutcome = new Map<string, ResolvedEntry>();
      for (const e of marketEntries) {
        const current = bestPerOutcome.get(e.outcome);
        if (!current || e.priceDecimal > current.priceDecimal) {
          bestPerOutcome.set(e.outcome, e);
        }
      }

      const outcomes: BestOutcomeLine[] = Array.from(bestPerOutcome.values()).map((e) => ({
        outcome: e.outcome,
        priceDecimal: e.priceDecimal,
        impliedProbability: e.impliedProbability,
        bookmakerKey: e.bookmakerKey,
        bookmakerTitle: e.bookmakerTitle,
        sportsbookId: e.sportsbookId,
        ...(e.point !== undefined ? { point: e.point } : {}),
        recordedAt: e.recordedAt.toISOString(),
      }));

      // Arbitrage check: if Σ(implied probabilities) < 1.0 a risk-free profit
      // exists by placing bets covering all outcomes in the right proportions.
      const sumImplied = +outcomes.reduce((s, o) => s + o.impliedProbability, 0).toFixed(6);
      const isArbitrage = sumImplied < 1.0;

      const first = marketEntries[0]!;
      results.push({
        marketId,
        eventId: first.eventId,
        sport: first.sport,
        homeTeam: first.homeTeam,
        awayTeam: first.awayTeam,
        marketKey: first.marketKey,
        outcomes,
        isArbitrage,
        arbitrageMargin: isArbitrage ? +(1 - sumImplied).toFixed(6) : null,
        processedAt: new Date().toISOString(),
      });
    }

    return results;
  }

  // ─── Cache + pub/sub ────────────────────────────────────────────────────────

  private async publishBestLines(marketBestLines: MarketBestLines[]): Promise<void> {
    for (const market of marketBestLines) {
      if (market.isArbitrage) {
        console.log(
          `[OddsProcessor] *** ARBITRAGE *** ` +
            `"${market.homeTeam} vs ${market.awayTeam}" (${market.marketKey}) ` +
            `margin=${((market.arbitrageMargin ?? 0) * 100).toFixed(3)}% ` +
            `marketId=${market.marketId}`,
        );
      }

      // 1. Update the best-line Redis cache for every outcome in the market.
      //    Key: best-line:{marketId}:{outcome}  TTL: 60 s
      //    (Matches the BestLineData shape expected by RedisClient.getBestLine())
      for (const o of market.outcomes) {
        const cacheKey = `best-line:${market.marketId}:${o.outcome}`;
        await this.redis.set(
          cacheKey,
          JSON.stringify({
            marketId: market.marketId,
            outcome: o.outcome,
            priceDecimal: o.priceDecimal,
            sportsbookId: o.sportsbookId,
            sportsbookName: o.bookmakerTitle,
            recordedAt: o.recordedAt,
          }),
          "EX",
          BEST_LINE_TTL_SECS,
        );
      }

      // 2. Publish the full market snapshot to the "best-lines" channel so that
      //    any subscriber (API, alert service, etc.) can react in real time.
      await this.redis.publish(BEST_LINES_CHANNEL, JSON.stringify(market));
    }
  }
}
