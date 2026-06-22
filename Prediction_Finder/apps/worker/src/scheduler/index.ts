import type { FetchOddsApiJobData, OddsIngestionJobData, OddsIngestionJobName, ScrapeBookJobData } from "@prediction-finder/shared";
import type { Queue } from "bullmq";

// ─── Config types ─────────────────────────────────────────────────────────────

export interface SportScheduleEntry {
  /** Odds API sport key, e.g. "americanfootball_nfl" */
  key: string;
  /** Poll interval in ms */
  intervalMs: number;
  regions?: string;
  markets?: string;
}

export interface BookScheduleEntry {
  /** Internal identifier / slug, e.g. "draftkings" */
  slug: string;
  sport: string;
  /** URL to scrape */
  url: string;
  /** Scrape interval in ms */
  intervalMs: number;
}

export interface SchedulerConfig {
  sports?: SportScheduleEntry[];
  books?: BookScheduleEntry[];
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

type OddsQueue = Queue<OddsIngestionJobData, void, OddsIngestionJobName>;

export class Scheduler {
  private readonly queue: OddsQueue;
  private readonly config: SchedulerConfig;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(queue: OddsQueue, config: SchedulerConfig) {
    this.queue = queue;
    this.config = config;
  }

  /** Enqueue all configured jobs immediately, then on their respective intervals. */
  start(): void {
    for (const sport of this.config.sports ?? []) {
      void this.enqueueFetchOddsApi(sport);
      this.timers.push(setInterval(() => void this.enqueueFetchOddsApi(sport), sport.intervalMs));
    }

    for (const book of this.config.books ?? []) {
      void this.enqueueScrapeBook(book);
      this.timers.push(setInterval(() => void this.enqueueScrapeBook(book), book.intervalMs));
    }

    const s = this.config.sports?.length ?? 0;
    const b = this.config.books?.length ?? 0;
    console.log(`[Scheduler] Started — ${s} sport schedule(s), ${b} book schedule(s)`);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    console.log("[Scheduler] Stopped");
  }

  // ─── Enqueue helpers ────────────────────────────────────────────────────

  private async enqueueFetchOddsApi(sport: SportScheduleEntry): Promise<void> {
    const data: FetchOddsApiJobData = {
      sport: sport.key,
      ...(sport.regions ? { regions: sport.regions } : {}),
      ...(sport.markets ? { markets: sport.markets } : {}),
    };

    await this.queue.add("fetchOddsApi", data, {
      // Unique per sport+tick so bursts don't stack identical jobs
      jobId: `fetchOddsApi:${sport.key}:${Date.now()}`,
    });

    console.log(`[Scheduler] ↑ fetchOddsApi sport=${sport.key}`);
  }

  private async enqueueScrapeBook(book: BookScheduleEntry): Promise<void> {
    const data: ScrapeBookJobData = {
      bookSlug: book.slug,
      sport: book.sport,
      url: book.url,
    };

    await this.queue.add("scrapeBook", data, {
      jobId: `scrapeBook:${book.slug}:${book.sport}:${Date.now()}`,
    });

    console.log(`[Scheduler] ↑ scrapeBook book=${book.slug} sport=${book.sport}`);
  }
}

// ─── Config loader ────────────────────────────────────────────────────────────

/**
 * Build SchedulerConfig from environment variables.
 *
 * ODDS_API_SPORTS          Comma-separated sport keys (e.g. "americanfootball_nfl,basketball_nba")
 * ODDS_API_POLL_INTERVAL_MS  Milliseconds between polls (default: 30 000)
 * ODDS_API_REGIONS         Comma-separated regions (default: "us")
 * ODDS_API_MARKETS         Comma-separated market types (default: "h2h,spreads,totals")
 *
 * SCRAPE_BOOKS             Semicolon-separated entries, each: "slug,sport,url,intervalSecs"
 *                          e.g. "draftkings,americanfootball_nfl,https://sportsbook.draftkings.com/...,60"
 */
export function loadSchedulerConfig(): SchedulerConfig {
  const pollIntervalMs = Number(process.env["ODDS_API_POLL_INTERVAL_MS"] ?? 30_000);
  const regions = process.env["ODDS_API_REGIONS"] ?? "us";
  const markets = process.env["ODDS_API_MARKETS"] ?? "h2h,spreads,totals";

  const sports: SportScheduleEntry[] = (process.env["ODDS_API_SPORTS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((key) => ({ key, intervalMs: pollIntervalMs, regions, markets }));

  const books: BookScheduleEntry[] = (process.env["SCRAPE_BOOKS"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [slug = "", sport = "", url = "", intervalSecsStr = "60"] = entry
        .split(",")
        .map((p) => p.trim());
      return {
        slug,
        sport,
        url,
        intervalMs: Number(intervalSecsStr) * 1_000,
      };
    })
    .filter((b) => b.slug && b.sport && b.url);

  return { sports, books };
}
