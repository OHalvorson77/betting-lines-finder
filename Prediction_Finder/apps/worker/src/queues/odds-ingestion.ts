import {
  type FetchOddsApiJobData,
  type OddsIngestionJobData,
  type OddsIngestionJobName,
  type ScrapeBookJobData,
} from "@prediction-finder/shared";
import { Queue, Worker } from "bullmq";
import type { Redis as IORedis } from "ioredis";
import { OddsApiIngester } from "../ingester/OddsApiIngester.js";
import { OddsApiClient } from "../lib/odds-api/client.js";

export const ODDS_INGESTION_QUEUE = "odds-ingestion" as const;

type OddsQueue = Queue<OddsIngestionJobData, void, OddsIngestionJobName>;
type OddsWorker = Worker<OddsIngestionJobData, void, OddsIngestionJobName>;

// ─── Queue factory ────────────────────────────────────────────────────────────

export function createOddsIngestionQueue(connection: IORedis): OddsQueue {
  return new Queue<OddsIngestionJobData, void, OddsIngestionJobName>(ODDS_INGESTION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: { age: 24 * 3_600 },
    },
  });
}

// ─── Worker factory ───────────────────────────────────────────────────────────

/**
 * @param connection     BullMQ IORedis connection (maxRetriesPerRequest: null)
 * @param streamRedis    IORedis connection used for XADD to the odds stream
 */
export function createOddsIngestionWorker(
  connection: IORedis,
  streamRedis: IORedis,
): OddsWorker {
  return new Worker<OddsIngestionJobData, void, OddsIngestionJobName>(
    ODDS_INGESTION_QUEUE,
    async (job) => {
      if (job.name === "fetchOddsApi") {
        await handleFetchOddsApi(job.data as FetchOddsApiJobData, streamRedis);
      } else if (job.name === "scrapeBook") {
        await handleScrapeBook(job.data as ScrapeBookJobData);
      } else {
        throw new Error(`Unknown job name: ${String(job.name)}`);
      }
    },
    { connection, concurrency: 3 },
  );
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

async function handleFetchOddsApi(
  data: FetchOddsApiJobData,
  streamRedis: IORedis,
): Promise<void> {
  const apiKey = process.env["ODDS_API_KEY"];
  if (!apiKey) throw new Error("ODDS_API_KEY environment variable is not set");

  const client = new OddsApiClient({ apiKey });
  const ingester = new OddsApiIngester({
    client,
    redis: streamRedis,
    sports: [data.sport],
    ...(data.regions !== undefined ? { regions: data.regions } : {}),
    ...(data.markets !== undefined ? { markets: data.markets } : {}),
  });

  const { events, lines } = await ingester.poll(data.sport);
  console.log(`[odds-ingestion/fetchOddsApi] sport=${data.sport} events=${events} lines=${lines}`);
}

async function handleScrapeBook(data: ScrapeBookJobData): Promise<void> {
  console.log(
    `[odds-ingestion/scrapeBook] book=${data.bookSlug} sport=${data.sport} url=${data.url}`,
  );
  // Concrete scrapers extend PlaywrightScraper and register here via a registry map.
  // This stub surfaces a clear error so the queue fails gracefully until implementations land.
  throw new Error(
    `No scraper registered for bookSlug="${data.bookSlug}". ` +
      `Create a class extending PlaywrightScraper<T> and register it in this handler.`,
  );
}
