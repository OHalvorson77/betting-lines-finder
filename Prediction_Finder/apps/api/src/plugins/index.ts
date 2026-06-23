import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyWebSocket from "@fastify/websocket";
import { type FastifyInstance } from "fastify";

export async function registerPlugins(app: FastifyInstance) {
  await app.register(helmet, {
    global: true,
    // Allow WebSocket upgrade requests and the /docs UI assets
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  });

  await app.register(cors, {
    origin:
      process.env["NODE_ENV"] === "production"
        ? (process.env["ALLOWED_ORIGINS"]?.split(",") ?? true)
        : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // WebSocket support — must be registered before any ws routes
  await app.register(fastifyWebSocket);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Prediction Finder API",
        description: "REST API for the Prediction Finder platform",
        version: "1.0.0",
      },
      tags: [
        { name: "predictions", description: "Prediction endpoints" },
        { name: "markets", description: "Odds markets and best-line endpoints" },
        { name: "arbitrage", description: "Arbitrage opportunity detection" },
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
