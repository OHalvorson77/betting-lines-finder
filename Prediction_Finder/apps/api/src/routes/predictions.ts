import { getDb, predictions } from "@prediction-finder/db";
import { count, eq } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { z } from "zod";

const createPredictionSchema = z.object({
  subject: z.string().min(1).max(500),
  content: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  predictedAt: z.coerce.date(),
  resolveAt: z.coerce.date().optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const predictionRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();

  // GET /predictions
  app.get(
    "/predictions",
    {
      schema: {
        tags: ["predictions"],
        summary: "List predictions",
        querystring: {
          type: "object",
          properties: {
            page: { type: "number" },
            limit: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const query = paginationSchema.parse(req.query);
      const offset = (query.page - 1) * query.limit;

      const [rows, countResult] = await Promise.all([
        db.select().from(predictions).limit(query.limit).offset(offset),
        db.select({ value: count() }).from(predictions),
      ]);

      const total = Number(countResult[0]?.value ?? 0);
      return reply.send({
        data: rows,
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      });
    },
  );

  // GET /predictions/:id
  app.get<{ Params: { id: string } }>(
    "/predictions/:id",
    {
      schema: {
        tags: ["predictions"],
        summary: "Get prediction by ID",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(predictions)
        .where(eq(predictions.id, req.params.id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Prediction not found" } });
      }

      return reply.send({ success: true, data: row });
    },
  );

  // POST /predictions
  app.post(
    "/predictions",
    {
      schema: {
        tags: ["predictions"],
        summary: "Create a prediction",
        body: {
          type: "object",
          required: ["subject", "content", "source", "predictedAt"],
          properties: {
            subject: { type: "string" },
            content: { type: "string" },
            source: { type: "string" },
            sourceUrl: { type: "string" },
            predictedAt: { type: "string" },
            resolveAt: { type: "string" },
            confidence: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const input = createPredictionSchema.parse(req.body);

      const [created] = await db
        .insert(predictions)
        .values({
          subject: input.subject,
          content: input.content,
          source: input.source,
          sourceUrl: input.sourceUrl ?? null,
          predictedAt: input.predictedAt,
          resolveAt: input.resolveAt ?? null,
          confidence: input.confidence ?? null,
          tags: input.tags ?? [],
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    },
  );

  // DELETE /predictions/:id
  app.delete<{ Params: { id: string } }>(
    "/predictions/:id",
    {
      schema: {
        tags: ["predictions"],
        summary: "Delete a prediction",
        params: { type: "object", properties: { id: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const [deleted] = await db
        .delete(predictions)
        .where(eq(predictions.id, req.params.id))
        .returning({ id: predictions.id });

      if (!deleted) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Prediction not found" } });
      }

      return reply.status(204).send();
    },
  );
};
