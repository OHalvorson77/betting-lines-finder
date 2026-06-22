import { type AnalyzeJobData, type ResolveJobData, type ScrapeJobData } from "@prediction-finder/shared";
import { Worker } from "bullmq";
import { analyzeProcessor } from "./processors/analyze.js";
import { resolveProcessor } from "./processors/resolve.js";
import { scrapeProcessor } from "./processors/scrape.js";
import { QUEUE_NAMES, createRedisConnection } from "./queues.js";

const CONCURRENCY = Number(process.env["WORKER_CONCURRENCY"] ?? 5);

function bootstrap() {
  const connection = createRedisConnection();

  connection.on("connect", () => console.log("[redis] Connected"));
  connection.on("error", (err: Error) => console.error("[redis] Error:", err.message));

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

  const workers = [scrapeWorker, analyzeWorker, resolveWorker];

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

  console.log(`Worker started. Concurrency: ${CONCURRENCY}`);
  console.log(`Listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`);

  async function shutdown(signal: string) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap();
