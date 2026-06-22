// ─── Raw API response shapes (The Odds API v4) ────────────────────────────────

export interface OddsApiOutcome {
  name: string;
  /** American-format price (e.g. -110, +250) */
  price: number;
  /** Spread/total point, present for spreads/totals markets */
  point?: number;
}

export interface OddsApiMarket {
  /** "h2h" | "spreads" | "totals" | "outrights" */
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export type OddsApiResponse = OddsApiEvent[];

export interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

// ─── Normalised internal representation ───────────────────────────────────────

/** One flat line per event × bookmaker × market × outcome. */
export interface NormalizedOddsLine {
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  bookmakerKey: string;
  bookmakerTitle: string;
  marketKey: string;
  outcome: string;
  priceAmerican: number;
  priceDecimal: number;
  point?: number;
  recordedAt: Date;
}
