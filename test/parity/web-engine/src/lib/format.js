export const fmt = (v, dp = 0) => {
  if (v === null || v === undefined || v === '') return '—';
  const a = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `(${a})` : a;
};
// Each fund has a presentation currency; the review workspace sets it when a fund is in review, and
// every amount in the review is shown in it. (Billing uses the firm's own invoicing currency.)
export const CURRENCIES = {
  GBP: { sym: '£', name: 'Pound sterling' }, EUR: { sym: '€', name: 'Euro' }, USD: { sym: '$', name: 'US dollar' },
  CHF: { sym: 'CHF ', name: 'Swiss franc' }, JPY: { sym: '¥', name: 'Japanese yen' }, CAD: { sym: 'C$', name: 'Canadian dollar' },
  AUD: { sym: 'A$', name: 'Australian dollar' }, HKD: { sym: 'HK$', name: 'Hong Kong dollar' }, SGD: { sym: 'S$', name: 'Singapore dollar' },
  SEK: { sym: 'SEK ', name: 'Swedish krona' }, NOK: { sym: 'NOK ', name: 'Norwegian krone' }, DKK: { sym: 'DKK ', name: 'Danish krone' }
};
let current = 'GBP';
export const setCurrency = c => { current = CURRENCIES[c] ? c : 'GBP'; };
export const currencyCode = () => current;
export const sym = (c = current) => CURRENCIES[c]?.sym ?? `${c} `;
export const gbp = v => (v == null ? '—' : sym() + fmt(v));            // kept name: formats in the fund's currency
export const money = gbp;
export const signedGbp = v => (v >= 0 ? '+' : '−') + sym() + fmt(Math.abs(v));
export const pctLabel = p => (p == null ? 'n/a' : (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%');
export const sum = a => (a || []).reduce((x, y) => x + (y || 0), 0);
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const stamp = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// A stored time (ISO) shown in the reader's own time zone; text saved by older versions is shown as it was.
export const whenOf = v => {
  if (!v) return '';
  const d = new Date(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(String(v)) && !isNaN(d) ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(v);
};
export const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};
