import {
  type AnalyzeJobData,
  type ResolveJobData,
  type ScrapeJobData,
} from "@prediction-finder/shared";
import { Worker } from "bullmq";
import { getDb } from "@prediction-finder/db";
import { analyzeProcessor } from "./processors/analyze.js";
import { resolveProcessor } from "./processors/resolve.js";
import { scrapeProcessor } from "./processors/scrape.js";
import { OddsProcessor } from "./processor/OddsProcessor.js";
import { createOddsIngestionWorker } from "./queues/odds-ingestion.js";
import { QUEUE_NAMES, createQueues, createRedisConnection } from "./queues.js";
import { Scheduler, loadSchedulerConfig } from "./scheduler/index.js";

const CONCURRENCY = Number(process.env["WORKER_CONCURRENCY"] ?? 5);

function bootstrap() {
  // connection      — BullMQ job-queue workers
  // streamConnection — Redis Stream XADD (producer)
  // processorConnection — OddsProcessor XREADGROUP + PUBLISH (consumer)
  const connection = createRedisConnection();
  const streamConnection = createRedisConnection();
  const processorConnection = createRedisConnection();

  connection.on("connect", () => console.log("[redis] Connected"));
  connection.on("error", (err: Error) => console.error("[redis] Error:", err.message));

  // ─── Existing prediction workers ─────────────────────────────────────────

  const scrapeWorker = new Worker<ScrapeJobData>(QUEUE_NAMES.SCRAPE, scrapeProcessor, {
    connection,
    concurrency: CONCURRENCY,
  });

  const analyzeWorker = new Worker<AnalyzeJobData>(QUEUE_NAMES.ANALYZE, analyzeProcessor, {
    connection,
    concurrency: CONCURRENCY,
  });

  const resolveWorker = new Worker<ResolveJobData>(QUEUE_NAMES.RESOLVE, resolveProcessor, {
    connection,
    concurrency: 2,
  });

  // ─── Odds-ingestion worker ────────────────────────────────────────────────

  const oddsIngestionWorker = createOddsIngestionWorker(connection, streamConnection);

  // ─── OddsProcessor (stream consumer → TimescaleDB + pub/sub) ─────────────

  const oddsProcessor = new OddsProcessor({ redis: processorConnection, db: getDb() });

  // ─── Scheduler ────────────────────────────────────────────────────────────

  const { oddsIngestionQueue } = createQueues(connection);
  const scheduler = new Scheduler(oddsIngestionQueue, loadSchedulerConfig());

  // ─── Shared event logging ─────────────────────────────────────────────────

  const workers = [scrapeWorker, analyzeWorker, resolveWorker, oddsIngestionWorker];

  for (const worker of workers) {
    worker.on("completed", (job) => {
      console.log(`[${worker.name}] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err: Error) => {
      console.error(`[${worker.name}] Job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err: Error) => {
      console.error(`[${worker.name}] Worker error:`, err.message);
    });
  }

  // ─── Start ────────────────────────────────────────────────────────────────

  scheduler.start();
  void oddsProcessor.start();

  console.log(`Worker started. Concurrency: ${CONCURRENCY}`);
  console.log(`Listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`);

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    scheduler.stop();
    oddsProcessor.stop();
    await Promise.all(workers.map((w) => w.close()));
    await oddsIngestionQueue.close();
    await connection.quit();
    await streamConnection.quit();
    await processorConnection.quit();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap();
