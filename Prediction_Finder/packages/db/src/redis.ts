import { Redis as IORedis } from "ioredis";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Best available price for a single outcome across all tracked sportsbooks. */
export interface BestLineData {
  marketId: string;
  outcome: string;
  priceDecimal: number;
  sportsbookId: string;
  sportsbookName: string;
  recordedAt: string; // ISO 8601
}

// ─── Constants ─────────────────────────────────────────────────────────────

const BEST_LINE_PREFIX = "best-line" as const;
/** Default TTL for best-line cache entries (60 seconds). */
const BEST_LINE_TTL_SECONDS = 60;

// ─── RedisClient ────────────────────────────────────────────────────────────

export class RedisClient {
  readonly raw: IORedis;

  constructor(url?: string) {
    const redisUrl = url ?? process.env["REDIS_URL"] ?? "redis://localhost:6379";
    this.raw = new IORedis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  // ─── Generic typed helpers ───────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.raw.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds !== undefined) {
      await this.raw.set(key, serialized, "EX", ttlSeconds);
    } else {
      await this.raw.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.raw.del(key);
  }

  // ─── Best-line cache helpers ─────────────────────────────────────────────

  private bestLineKey(marketId: string, outcome: string): string {
    return `${BEST_LINE_PREFIX}:${marketId}:${outcome}`;
  }

  /**
   * Retrieve the cached best line for a specific market + outcome pair.
   * Returns null if no entry exists or it has expired.
   */
  async getBestLine(marketId: string, outcome: string): Promise<BestLineData | null> {
    return this.get<BestLineData>(this.bestLineKey(marketId, outcome));
  }

  /**
   * Cache the best line for a market + outcome pair.
   * @param ttlSeconds Expiry in seconds (default: 60).
   */
  async setBestLine(
    marketId: string,
    outcome: string,
    data: BestLineData,
    ttlSeconds = BEST_LINE_TTL_SECONDS,
  ): Promise<void> {
    await this.set(this.bestLineKey(marketId, outcome), data, ttlSeconds);
  }

  /** Remove a single best-line cache entry. */
  async deleteBestLine(marketId: string, outcome: string): Promise<void> {
    await this.del(this.bestLineKey(marketId, outcome));
  }

  /**
   * Retrieve all cached best lines for every outcome in a market.
   * Uses KEYS scan — prefer only in low-traffic or admin contexts.
   */
  async getBestLinesForMarket(marketId: string): Promise<BestLineData[]> {
    const keys = await this.raw.keys(`${BEST_LINE_PREFIX}:${marketId}:*`);
    if (keys.length === 0) return [];
    const values = await this.raw.mget(keys);
    return values
      .filter((v: string | null): v is string => v !== null)
      .map((v: string) => JSON.parse(v) as BestLineData);
  }

  /** Invalidate all best-line entries for a market (e.g. after a bulk odds update). */
  async invalidateBestLinesForMarket(marketId: string): Promise<void> {
    const keys = await this.raw.keys(`${BEST_LINE_PREFIX}:${marketId}:*`);
    if (keys.length > 0) {
      await this.raw.del(keys);
    }
  }

  async quit(): Promise<void> {
    await this.raw.quit();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _redis: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!_redis) {
    _redis = new RedisClient();
  }
  return _redis;
}
