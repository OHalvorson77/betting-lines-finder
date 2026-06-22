import {
  type AnalyzeJobData,
  type JobName,
  type OddsIngestionJobData,
  type OddsIngestionJobName,
  type ResolveJobData,
  type ScrapeJobData,
} from "@prediction-finder/shared";
import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";

export const QUEUE_NAMES = {
  SCRAPE: "scrape-prediction",
  ANALYZE: "analyze-prediction",
  RESOLVE: "resolve-prediction",
  ODDS_INGESTION: "odds-ingestion",
} as const satisfies Record<string, JobName>;

export function createRedisConnection() {
  const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function createQueues(connection: IORedis) {
  const defaultJobOptions = {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 24 * 3600 },
  };

  return {
    scrapeQueue: new Queue<ScrapeJobData>(QUEUE_NAMES.SCRAPE, { connection, defaultJobOptions }),
    analyzeQueue: new Queue<AnalyzeJobData>(QUEUE_NAMES.ANALYZE, { connection, defaultJobOptions }),
    resolveQueue: new Queue<ResolveJobData>(QUEUE_NAMES.RESOLVE, { connection, defaultJobOptions }),
    oddsIngestionQueue: new Queue<OddsIngestionJobData, void, OddsIngestionJobName>(
      QUEUE_NAMES.ODDS_INGESTION,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 500 },
          removeOnFail: { age: 24 * 3_600 },
        },
      },
    ),
  };
}

export type Queues = ReturnType<typeof createQueues>;
