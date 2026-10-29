// Number and money formatting used in check details and point wording. Amounts are shown in the fund's
// presentation currency; callers pass the currency code (the web app keeps it in a module setting).

export const fmt = (v: number | null | undefined | '', dp = 0): string => {
  if (v === null || v === undefined || v === '') return '—';
  const a = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${a})` : a;
};

export const CURRENCIES: Record<string, { sym: string; name: string }> = {
  GBP: { sym: '£', name: 'Pound sterling' },
  EUR: { sym: '€', name: 'Euro' },
  USD: { sym: '$', name: 'US dollar' },
  CHF: { sym: 'CHF ', name: 'Swiss franc' },
  JPY: { sym: '¥', name: 'Japanese yen' },
  CAD: { sym: 'C$', name: 'Canadian dollar' },
  AUD: { sym: 'A$', name: 'Australian dollar' },
  HKD: { sym: 'HK$', name: 'Hong Kong dollar' },
  SGD: { sym: 'S$', name: 'Singapore dollar' },
  SEK: { sym: 'SEK ', name: 'Swedish krona' },
  NOK: { sym: 'NOK ', name: 'Norwegian krone' },
  DKK: { sym: 'DKK ', name: 'Danish krone' }
};

/** The fund's currency code, or GBP when it is not one the app knows (as the web app's setCurrency). */
export const currencyOf = (c: unknown): string => (typeof c === 'string' && CURRENCIES[c] ? c : 'GBP');
export const sym = (c = 'GBP'): string => CURRENCIES[c]?.sym ?? `${c} `;
export const pctLabel = (p: number | null | undefined): string => (p == null ? 'n/a' : (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%');
export const sum = (a: readonly (number | null | undefined)[] | null | undefined): number =>
  (a || []).reduce<number>((x, y) => x + (y || 0), 0);
