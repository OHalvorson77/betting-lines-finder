import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DbClient = ReturnType<typeof createDbClient>;

export function createDbClient(connectionString?: string) {
  const url = connectionString ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const queryClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(queryClient, { schema, logger: process.env["NODE_ENV"] === "development" });
}

// Singleton client for application use
let _db: DbClient | null = null;

export function getDb(): DbClient {
  if (!_db) {
    _db = createDbClient();
  }
  return _db;
}
