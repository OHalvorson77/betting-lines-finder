import { getDb, predictionMetrics, predictions } from "@prediction-finder/db";
import { type ResolveJobData } from "@prediction-finder/shared";
import { type Job } from "bullmq";
import { eq } from "drizzle-orm";

export async function resolveProcessor(job: Job<ResolveJobData>) {
  const { predictionId, outcome, resolvedAt } = job.data;
  const db = getDb();

  await job.log(`Resolving prediction: ${predictionId} → outcome=${outcome}`);

  const [prediction] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.id, predictionId))
    .limit(1);

  if (!prediction) {
    throw new Error(`Prediction not found: ${predictionId}`);
  }

  await db
    .update(predictions)
    .set({ outcome, resolvedAt, status: "completed" })
    .where(eq(predictions.id, predictionId));

  await db.insert(predictionMetrics).values({
    predictionId,
    timestamp: resolvedAt,
    metricName: "outcome",
    value: outcome ? 1 : 0,
    metadata: { resolvedAt: resolvedAt.toISOString() },
  });

  await job.log("Resolution recorded successfully");
  return { predictionId, outcome };
}
