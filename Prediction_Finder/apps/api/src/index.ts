import Fastify from "fastify";
import { env } from "./env.js";
import { registerPlugins } from "./plugins/index.js";
import { healthRoutes } from "./routes/health.js";
import { predictionRoutes } from "./routes/predictions.js";

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await registerPlugins(app);

  await app.register(healthRoutes);
  await app.register(predictionRoutes, { prefix: "/api/v1" });

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

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(`Docs available at http://${env.HOST}:${env.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void bootstrap();
