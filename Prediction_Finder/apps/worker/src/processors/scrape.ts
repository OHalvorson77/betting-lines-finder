import { getDb, predictions, sources } from "@prediction-finder/db";
import { type ScrapeJobData } from "@prediction-finder/shared";
import { type Job } from "bullmq";
import { eq } from "drizzle-orm";

export async function scrapeProcessor(job: Job<ScrapeJobData>) {
  const { url, source } = job.data;
  const db = getDb();

  await job.log(`Scraping ${url} for source: ${source}`);
  await job.updateProgress(10);

  const [sourceRow] = await db
    .select()
    .from(sources)
    .where(eq(sources.name, source))
    .limit(1);

  if (!sourceRow) {
    throw new Error(`Source not found: ${source}`);
  }

  await job.updateProgress(30);

  // Placeholder: real implementation would use a scraping library
  // (e.g. Playwright, Cheerio, or a dedicated scraping service)
  const scrapedData = await simulateScrape(url);

  await job.updateProgress(70);

  const [created] = await db
    .insert(predictions)
    .values({
      subject: scrapedData.subject,
      content: scrapedData.content,
      source,
      sourceUrl: url,
      predictedAt: scrapedData.predictedAt,
      status: "pending",
    })
    .returning({ id: predictions.id });

  await db
    .update(sources)
    .set({ lastScrapedAt: new Date() })
    .where(eq(sources.name, source));

  await job.updateProgress(100);
  await job.log(`Created prediction ${created?.id ?? "unknown"}`);

  return { predictionId: created?.id };
}

async function simulateScrape(_url: string) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    subject: "Placeholder subject",
    content: "Placeholder content from scrape",
    predictedAt: new Date(),
  };
}
