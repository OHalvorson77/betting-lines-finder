import type { Redis as IORedis } from "ioredis";
import type { OddsApiClient } from "../lib/odds-api/client.js";
import type { NormalizedOddsLine, OddsApiEvent } from "../lib/odds-api/types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const ODDS_STREAM = "stream:odds-events" as const;
/** Approximate cap on stream length; older entries are trimmed by Redis. */
const STREAM_MAX_LEN = 50_000;

// ─── Conversion ───────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american > 0) {
    return Math.round((american / 100 + 1) * 10_000) / 10_000;
  }
  return Math.round((100 / Math.abs(american) + 1) * 10_000) / 10_000;
}

function normalizeEvent(event: OddsApiEvent, recordedAt: Date): NormalizedOddsLine[] {
  const lines: NormalizedOddsLine[] = [];
  const commenceTime = new Date(event.commence_time);

  for (const bk of event.bookmakers) {
    for (const mkt of bk.markets) {
      for (const oc of mkt.outcomes) {
        lines.push({
          eventId: event.id,
          sport: event.sport_key,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime,
          bookmakerKey: bk.key,
          bookmakerTitle: bk.title,
          marketKey: mkt.key,
          outcome: oc.name,
          priceAmerican: oc.price,
          priceDecimal: americanToDecimal(oc.price),
          ...(oc.point !== undefined ? { point: oc.point } : {}),
          recordedAt,
        });
      }
    }
  }

  return lines;
}

// ─── Ingester ─────────────────────────────────────────────────────────────────

export interface OddsApiIngesterConfig {
  client: OddsApiClient;
  redis: IORedis;
  sports: string[];
  /** Milliseconds between polls per sport (default: 30 000) */
  pollIntervalMs?: number;
  regions?: string | undefined;
  markets?: string | undefined;
}

export class OddsApiIngester {
  private readonly client: OddsApiClient;
  private readonly redis: IORedis;
  private readonly sports: readonly string[];
  private readonly pollIntervalMs: number;
  private readonly regions: string;
  private readonly markets: string;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(config: OddsApiIngesterConfig) {
    this.client = config.client;
    this.redis = config.redis;
    this.sports = config.sports;
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.regions = config.regions ?? "us";
    this.markets = config.markets ?? "h2h,spreads,totals";
  }

  /** Begin polling each sport immediately, then on the configured interval. */
  start(): void {
    for (const sport of this.sports) {
      void this.poll(sport);
      const timer = setInterval(() => void this.poll(sport), this.pollIntervalMs);
      this.timers.push(timer);
    }
    console.log(
      `[OddsApiIngester] Polling ${this.sports.length} sport(s) every ${this.pollIntervalMs}ms`,
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    console.log("[OddsApiIngester] Stopped");
  }

  /** Single fetch-and-publish cycle for one sport. Safe to call directly (e.g. from BullMQ). */
  async poll(sport: string): Promise<{ events: number; lines: number }> {
    const events = await this.client.fetchOdds({
      sport,
      regions: this.regions,
      markets: this.markets,
    });

    const recordedAt = new Date();
    let lineCount = 0;

    for (const event of events) {
      const lines = normalizeEvent(event, recordedAt);
      for (const line of lines) {
        await this.publishLine(line);
        lineCount++;
      }
    }

    console.log(
      `[OddsApiIngester] sport=${sport} events=${events.length} lines=${lineCount} at=${recordedAt.toISOString()}`,
    );
    return { events: events.length, lines: lineCount };
  }

  // ─── Stream publishing ──────────────────────────────────────────────────

  private async publishLine(line: NormalizedOddsLine): Promise<void> {
    const fields: string[] = [
      "eventId",
      line.eventId,
      "sport",
      line.sport,
      "homeTeam",
      line.homeTeam,
      "awayTeam",
      line.awayTeam,
      "commenceTime",
      line.commenceTime.toISOString(),
      "bookmakerKey",
      line.bookmakerKey,
      "bookmakerTitle",
      line.bookmakerTitle,
      "marketKey",
      line.marketKey,
      "outcome",
      line.outcome,
      "priceAmerican",
      String(line.priceAmerican),
      "priceDecimal",
      String(line.priceDecimal),
      "recordedAt",
      line.recordedAt.toISOString(),
    ];

    if (line.point !== undefined) {
      fields.push("point", String(line.point));
    }

    // XADD stream:odds-events MAXLEN ~ 50000 * field value ...
    await (this.redis as IORedis).call(
      "XADD",
      ODDS_STREAM,
      "MAXLEN",
      "~",
      String(STREAM_MAX_LEN),
      "*",
      ...fields,
    );
  }
}
