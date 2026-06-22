import type { OddsApiResponse, OddsApiSport } from "./types.js";

const BASE_URL = "https://api.the-odds-api.com/v4";
const TIMEOUT_MS = 15_000;

export interface OddsApiClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FetchOddsParams {
  sport: string;
  regions?: string;
  markets?: string;
  /** "american" (default) or "decimal" */
  oddsFormat?: "american" | "decimal";
  /** ISO 8601 – only return events after this date */
  commenceTimeFrom?: string;
  /** ISO 8601 – only return events before this date */
  commenceTimeTo?: string;
}

export class OddsApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: OddsApiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? BASE_URL;
  }

  async fetchOdds(params: FetchOddsParams): Promise<OddsApiResponse> {
    const url = this.buildUrl(`sports/${params.sport}/odds`, {
      regions: params.regions ?? "us",
      markets: params.markets ?? "h2h,spreads,totals",
      oddsFormat: params.oddsFormat ?? "american",
      ...(params.commenceTimeFrom ? { commenceTimeFrom: params.commenceTimeFrom } : {}),
      ...(params.commenceTimeTo ? { commenceTimeTo: params.commenceTimeTo } : {}),
    });

    return this.get<OddsApiResponse>(url);
  }

  async fetchSports(all = false): Promise<OddsApiSport[]> {
    const url = this.buildUrl("sports", all ? { all: "true" } : {});
    return this.get<OddsApiSport[]>(url);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(`${this.baseUrl}/${path}`);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  private async get<T>(url: URL): Promise<T> {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      throw new OddsApiError(res.status, body);
    }

    // Surface remaining quota from response headers
    const requestsUsed = res.headers.get("x-requests-used");
    const requestsRemaining = res.headers.get("x-requests-remaining");
    if (requestsUsed !== null && requestsRemaining !== null) {
      console.debug(`[OddsApiClient] quota used=${requestsUsed} remaining=${requestsRemaining}`);
    }

    return res.json() as Promise<T>;
  }
}

export class OddsApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: string,
  ) {
    super(`Odds API HTTP ${statusCode}: ${body}`);
    this.name = "OddsApiError";
  }
}
