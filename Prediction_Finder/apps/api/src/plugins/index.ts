import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { type FastifyInstance } from "fastify";

export async function registerPlugins(app: FastifyInstance) {
  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: process.env["NODE_ENV"] === "production" ? process.env["ALLOWED_ORIGINS"]?.split(",") : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Prediction Finder API",
        description: "REST API for the Prediction Finder platform",
        version: "1.0.0",
      },
      tags: [
        { name: "predictions", description: "Prediction endpoints" },
        { name: "sources", description: "Source endpoints" },
        { name: "health", description: "Health check endpoints" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });
}
