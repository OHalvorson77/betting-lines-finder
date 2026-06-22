import { getDb, predictionMetrics, predictions } from "@prediction-finder/db";
import { type AnalyzeJobData } from "@prediction-finder/shared";
import { type Job } from "bullmq";
import { eq } from "drizzle-orm";

export async function analyzeProcessor(job: Job<AnalyzeJobData>) {
  const { predictionId } = job.data;
  const db = getDb();

  await job.log(`Analyzing prediction: ${predictionId}`);

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
    .set({ status: "processing" })
    .where(eq(predictions.id, predictionId));

  await job.updateProgress(25);

  // Placeholder: real implementation would call an LLM or ML model
  const confidence = await simulateAnalysis(prediction.content);

  await job.updateProgress(75);

  await db.insert(predictionMetrics).values({
    predictionId,
    metricName: "confidence_score",
    value: confidence,
    metadata: { analyzedAt: new Date().toISOString() },
  });

  await db
    .update(predictions)
    .set({ status: "completed", confidence })
    .where(eq(predictions.id, predictionId));

  await job.updateProgress(100);
  await job.log(`Analysis complete. Confidence: ${confidence}`);

  return { predictionId, confidence };
}

async function simulateAnalysis(_content: string): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return Math.random();
}
