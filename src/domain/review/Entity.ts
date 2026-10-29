// The legal entity funds belong to (an ICAV, SICAV, unit trust and so on). The screens work with the
// whole document; the api keeps it intact and indexes the fields it needs beside it.

export interface EntityAiDecision {
  aiPermitted: boolean | null;
  aiBasis: string;
  aiDecidedBy: { id: string; name: string } | null;
  aiDecidedAt: string | null;
}

export interface EntityDocument extends EntityAiDecision {
  id: string;
  name: string;
  client: string;
  legalForm: string;
  jurisdiction: string;
  yearEnd: string;
  administrator: string;
  auditor: string;
  framework: string;
  ruleOverrides: Record<string, unknown>;
  partnerSignoff: boolean;
  umbrella: boolean;
  billingEmail: string;
  createdAt?: string;
  savedAt?: string;
  [extra: string]: unknown;
}

export const ENTITY_DEFAULTS: Omit<EntityDocument, 'id'> = {
  name: '',
  client: '',
  legalForm: '',
  jurisdiction: '',
  yearEnd: '',
  administrator: '',
  auditor: '',
  aiPermitted: null,
  aiBasis: '',
  aiDecidedBy: null,
  aiDecidedAt: null,
  framework: '',
  ruleOverrides: {},
  partnerSignoff: false,
  umbrella: false,
  billingEmail: ''
};

/** Case-insensitive, spacing-insensitive key for uniqueness of entity names. */
export const entityNameKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '');

/** The first problem with an entity document, or an empty string. */
export function entityProblem(e: Partial<EntityDocument>): string {
  if (!String(e.name ?? '').trim()) return 'Enter the entity’s name.';
  if (e.aiDecidedAt && typeof e.aiPermitted !== 'boolean') return 'Record whether the client permits AI.';
  if (e.aiDecidedAt && !String(e.aiBasis ?? '').trim()) return 'Give the basis for the AI decision, for example the engagement letter.';
  if (e.billingEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e.billingEmail))) return 'Enter a valid billing email address.';
  if (e.yearEnd && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.yearEnd))) return 'Enter the year end as a date.';
  return '';
}
