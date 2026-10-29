export interface FxRate {
  rate: number;
  /** ISO date the rate is for */
  date: string;
  source: string;
}

/** The daily USD to GBP reference rate. */
export interface FxRateSource {
  latestUsdToGbp(): Promise<FxRate>;
}
