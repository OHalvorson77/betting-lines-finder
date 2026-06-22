function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const env = {
  NODE_ENV: (process.env["NODE_ENV"] ?? "development") as "development" | "production" | "test",
  HOST: process.env["API_HOST"] ?? "0.0.0.0",
  PORT: Number(process.env["API_PORT"] ?? 3001),
  DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://postgres:password@localhost:5432/prediction_finder",
  REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:6379",
} as const;

export type Env = typeof env;
