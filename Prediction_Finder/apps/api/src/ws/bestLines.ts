import EventEmitter from "node:events";
import { Redis as IORedis } from "ioredis";
import { type FastifyPluginAsync, type FastifyRequest } from "fastify";

// ─── Constants ────────────────────────────────────────────────────────────────

const BEST_LINES_CHANNEL = "best-lines";

// ─── Payload shape (mirrors MarketBestLines from OddsProcessor) ───────────────

interface BestOutcomeLine {
  outcome: string;
  priceDecimal: number;
  impliedProbability: number;
  bookmakerKey: string;
  bookmakerTitle: string;
  sportsbookId: string;
  point?: number;
  recordedAt: string;
}

interface BestLinesPayload {
  marketId: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  outcomes: BestOutcomeLine[];
  isArbitrage: boolean;
  arbitrageMargin: number | null;
  processedAt: string;
}

// ─── Per-client filter ────────────────────────────────────────────────────────

interface ClientFilter {
  sport?: string;
  marketId?: string;
}

function matchesFilter(payload: BestLinesPayload, filter: ClientFilter): boolean {
  if (filter.sport && payload.sport !== filter.sport) return false;
  if (filter.marketId && payload.marketId !== filter.marketId) return false;
  return true;
}

// ─── Subscriber singleton ─────────────────────────────────────────────────────
//
// One IORedis connection is placed in subscribe mode per process. All WebSocket
// clients share it via an in-process EventEmitter, avoiding per-connection Redis
// subscriptions and the overhead they would incur.

declare interface BestLinesEmitter {
  on(event: "update", listener: (msg: string) => void): this;
  off(event: "update", listener: (msg: string) => void): this;
  emit(event: "update", msg: string): boolean;
}

class BestLinesEmitter extends EventEmitter {}

let _subscriberRedis: IORedis | null = null;
const emitter = new BestLinesEmitter();

/**
 * Ensure the shared Redis subscriber connection is established.
 * Safe to call multiple times — idempotent.
 */
async function ensureSubscriber(redisUrl: string): Promise<void> {
  if (_subscriberRedis) return;

  _subscriberRedis = new IORedis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  _subscriberRedis.on("error", (err: Error) =>
    console.error("[best-lines/sub] Redis error:", err.message),
  );

  await _subscriberRedis.connect();
  await _subscriberRedis.subscribe(BEST_LINES_CHANNEL);

  _subscriberRedis.on("message", (_channel: string, message: string) => {
    emitter.emit("update", message);
  });

  console.log(`[best-lines/sub] Subscribed to Redis channel "${BEST_LINES_CHANNEL}"`);
}

export async function closeBestLinesSubscriber(): Promise<void> {
  if (_subscriberRedis) {
    await _subscriberRedis.quit();
    _subscriberRedis = null;
  }
}

// ─── WebSocket route plugin ───────────────────────────────────────────────────

export const bestLinesWsRoutes: FastifyPluginAsync<{ redisUrl: string }> = async (
  app,
  opts,
) => {
  // Establish the shared subscriber once the plugin is registered
  await ensureSubscriber(opts.redisUrl);

  /**
   * WebSocket — GET /ws/best-lines
   *
   * Query params:
   *   sport    — only forward updates for this sport key
   *   marketId — only forward updates for this specific market UUID
   *
   * Each message is a JSON-stringified BestLinesPayload (identical to the object
   * the OddsProcessor publishes to the "best-lines" Redis pub/sub channel).
   */
  app.get(
    "/ws/best-lines",
    {
      websocket: true,
      schema: {
        tags: ["markets"],
        summary: "Real-time best-line updates via WebSocket",
        description:
          "Streams live odds updates from the 'best-lines' Redis pub/sub channel. " +
          "Filter by sport and/or marketId via query params. " +
          "Messages are JSON-encoded BestLinesPayload objects.",
        querystring: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Only receive updates for this sport key",
            },
            marketId: {
              type: "string",
              description: "Only receive updates for this market UUID",
            },
          },
        },
      },
    },
    (socket, req: FastifyRequest<{ Querystring: { sport?: string; marketId?: string } }>) => {
      const filter: ClientFilter = {};
      if (req.query.sport) filter.sport = req.query.sport;
      if (req.query.marketId) filter.marketId = req.query.marketId;

      const sportLabel = filter.sport ?? "*";
      const marketLabel = filter.marketId ?? "*";
      app.log.info(
        `[best-lines/ws] Client connected — sport=${sportLabel} market=${marketLabel}`,
      );

      // Send a welcome/handshake message so the client knows the connection is live
      socket.send(
        JSON.stringify({
          type: "connected",
          channel: BEST_LINES_CHANNEL,
          filter,
          connectedAt: new Date().toISOString(),
        }),
      );

      // Forward matching Redis messages to this client
      const handler = (message: string) => {
        // Skip parse if client is already closed
        if (socket.readyState !== 1 /* OPEN */) return;

        try {
          const payload = JSON.parse(message) as BestLinesPayload;
          if (matchesFilter(payload, filter)) {
            socket.send(message);
          }
        } catch {
          // Malformed message from Redis — discard silently
        }
      };

      emitter.on("update", handler);

      // Clean up when the client disconnects
      socket.on("close", () => {
        emitter.off("update", handler);
        app.log.info(
          `[best-lines/ws] Client disconnected — sport=${sportLabel} market=${marketLabel}`,
        );
      });

      socket.on("error", (err: Error) => {
        emitter.off("update", handler);
        app.log.warn(`[best-lines/ws] Socket error: ${err.message}`);
      });

      // Respond to ping frames with pong (ws library handles this automatically,
      // but explicitly handle text "ping" messages for browser clients that
      // can't send raw ping frames).
      socket.on("message", (data: Buffer) => {
        const text = data.toString();
        if (text === "ping") {
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      });
    },
  );
};
