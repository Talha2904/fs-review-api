// A fund's year-end review engagement. The whole document is what the screens edit and save; the api
// validates the fields that matter and indexes them beside the document.

export interface TeamMember {
  id?: string;
  name?: string;
}

export interface EngagementDocument {
  id: string;
  entityId?: string;
  fund: {
    name: string;
    /** ISO date */
    yearEnd: string;
    currency?: string;
    preparer?: string | TeamMember;
    reviewer?: string | TeamMember;
    manager?: string | TeamMember;
    partner?: string | TeamMember;
    [extra: string]: unknown;
  };
  threshold?: number;
  highMultiple?: number;
  ruleOverrides?: Record<string, unknown>;
  tbMap?: unknown;
  tbMapBy?: TeamMember | null;
  tbMapAt?: string | null;
  umbrellaName?: string;
  partnerSignoff?: string;
  umbrella?: string;
  aiOff?: boolean;
  aiOffBasis?: string;
  createdAt?: string;
  savedAt?: string;
  [extra: string]: unknown;
}

export const CURRENCIES = ['GBP', 'EUR', 'USD', 'CHF', 'JPY', 'CAD', 'AUD', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK'] as const;

/** The web app stores `fund.preparerId` beside the name; older records held an object or only a name. */
const personId = (fund: EngagementDocument['fund'], role: 'preparer' | 'reviewer' | 'manager' | 'partner'): string | null => {
  const id = fund?.[`${role}Id`];
  if (typeof id === 'string' && id) return id;
  const p = fund?.[role];
  return p && typeof p === 'object' && p.id ? String(p.id) : null;
};

/** Indexed copies of the fields the api searches on. */
export function engagementIndex(e: EngagementDocument) {
  return {
    entityId: e.entityId || null,
    fundName: String(e.fund?.name ?? '').trim(),
    yearEnd: String(e.fund?.yearEnd ?? ''),
    currency: String(e.fund?.currency || 'GBP'),
    preparerId: personId(e.fund, 'preparer'),
    reviewerId: personId(e.fund, 'reviewer'),
    managerId: personId(e.fund, 'manager'),
    partnerId: personId(e.fund, 'partner')
  };
}

/** The first problem with an engagement document, or an empty string. */
export function engagementProblem(e: Partial<EngagementDocument>): string {
  if (!e.fund || typeof e.fund !== 'object') return 'The fund details are missing.';
  if (!String(e.fund.name ?? '').trim()) return 'Enter the fund’s name.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.fund.yearEnd ?? ''))) return 'Enter the year end as a date.';
  if (e.fund.currency && !(CURRENCIES as readonly string[]).includes(String(e.fund.currency)))
    return 'Choose a presentation currency from the list.';
  if (e.threshold !== undefined && !(Number(e.threshold) >= 0)) return 'The review threshold must be zero or more.';
  if (e.aiOff && !String(e.aiOffBasis ?? '').trim()) return 'Give the reason for turning AI off for this fund.';
  return '';
}
