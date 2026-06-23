import Fastify from "fastify";
import { env } from "./env.js";
import { registerPlugins } from "./plugins/index.js";
import { healthRoutes } from "./routes/health.js";
import { predictionRoutes } from "./routes/predictions.js";
import { marketRoutes } from "./routes/markets.js";
import { arbRoutes } from "./routes/arb.js";
import { bestLinesWsRoutes, closeBestLinesSubscriber } from "./ws/bestLines.js";

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : {}),
    },
  });

  await registerPlugins(app);

  await app.register(healthRoutes);
  await app.register(predictionRoutes, { prefix: "/api/v1" });
  await app.register(marketRoutes, { prefix: "/api/v1" });
  await app.register(arbRoutes, { prefix: "/api/v1" });
  await app.register(bestLinesWsRoutes, { prefix: "/api/v1", redisUrl: env.REDIS_URL });

  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? "INTERNAL_ERROR",
        message: statusCode >= 500 ? "Internal server error" : error.message,
      },
    });
  });

  // Graceful shutdown — close Redis subscriber before exiting
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down…`);
    await closeBestLinesSubscriber();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(`Docs available at http://${env.HOST}:${env.PORT}/docs`);
    app.log.info(`WebSocket at ws://${env.HOST}:${env.PORT}/api/v1/ws/best-lines`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void bootstrap();
