import type { FxRate, FxRateSource } from '../../application/ports/FxRateSource.js';

const DEFAULT_URL = 'https://api.frankfurter.app/latest?from=USD&to=GBP';

/** The European Central Bank's daily USD to GBP reference rate, via api.frankfurter.app (or FX_URL). */
export class FrankfurterRates implements FxRateSource {
  constructor(
    private readonly url: string = DEFAULT_URL,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async latestUsdToGbp(): Promise<FxRate> {
    const r = await this.fetchFn(this.url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`The rates service answered ${r.status}.`);
    const j = (await r.json()) as { rates?: { GBP?: number }; date?: string };
    const rate = j?.rates?.GBP;
    if (!(typeof rate === 'number' && rate > 0)) throw new Error('The rates service did not return a USD to GBP rate.');
    return { rate, date: j.date || new Date().toISOString().slice(0, 10), source: 'European Central Bank (daily reference rate)' };
  }
}
