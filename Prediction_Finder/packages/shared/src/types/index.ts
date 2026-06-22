// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Prediction Domain ────────────────────────────────────────────────────────

export type PredictionStatus = "pending" | "processing" | "completed" | "failed";

export interface Prediction {
  id: string;
  subject: string;
  content: string;
  source: string;
  sourceUrl?: string;
  predictedAt: Date;
  resolveAt?: Date;
  status: PredictionStatus;
  confidence?: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePredictionInput {
  subject: string;
  content: string;
  source: string;
  sourceUrl?: string;
  predictedAt: Date;
  resolveAt?: Date;
  confidence?: number;
  tags?: string[];
}

export interface PredictionMetric {
  predictionId: string;
  timestamp: Date;
  metricName: string;
  value: number;
  metadata?: Record<string, unknown>;
}

// ─── Job Queue ────────────────────────────────────────────────────────────────

export type JobName =
  | "scrape-prediction"
  | "analyze-prediction"
  | "resolve-prediction"
  | "odds-ingestion";

export interface ScrapeJobData {
  url: string;
  source: string;
}

export interface AnalyzeJobData {
  predictionId: string;
}

export interface ResolveJobData {
  predictionId: string;
  outcome: boolean;
  resolvedAt: Date;
}

export interface FetchOddsApiJobData {
  sport: string;
  regions?: string;
  markets?: string;
}

export interface ScrapeBookJobData {
  bookSlug: string;
  sport: string;
  url: string;
}

export type OddsIngestionJobName = "fetchOddsApi" | "scrapeBook";
export type OddsIngestionJobData = FetchOddsApiJobData | ScrapeBookJobData;

export type JobData = ScrapeJobData | AnalyzeJobData | ResolveJobData | OddsIngestionJobData;
