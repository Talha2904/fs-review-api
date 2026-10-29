import type { PermissionMatrix } from '@fs-review/shared';

import { validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import { requirePermission } from '../identity/authorize.js';
import type { CheckRuleConfig, CheckRuleConfigRepository } from '../ports/CheckRuleConfigRepository.js';
import type { Clock } from '../ports/Clock.js';

/** Accepts the current { rules, overrides, custom } shape and the earliest rules-only save. */
export function normalizeCheckRuleConfig(v: unknown): CheckRuleConfig {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const has = (k: string) => src[k] !== undefined;
  if (!has('rules') && !has('overrides') && !has('custom')) return { rules: src as CheckRuleConfig['rules'], overrides: {}, custom: [] };
  const rules = (src.rules && typeof src.rules === 'object' ? src.rules : {}) as CheckRuleConfig['rules'];
  const overrides = (src.overrides && typeof src.overrides === 'object' ? src.overrides : {}) as CheckRuleConfig['overrides'];
  const custom = Array.isArray(src.custom) ? (src.custom as Record<string, unknown>[]) : [];
  for (const r of custom)
    if (!/^CHK-\d{2,3}$/.test(String(r.id ?? ''))) throw validationFailed('Every custom rule needs an id like CHK-15.');
  return { rules, overrides, custom };
}

/** Anyone signed in reads the template (every engagement starts from it); Administrators save it. */
export class GetCheckRuleConfig {
  constructor(private readonly repo: CheckRuleConfigRepository) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix): Promise<CheckRuleConfig | null> {
    requirePermission(actor, 'activity.write', matrix);
    return this.repo.get();
  }
}

export class SaveCheckRuleConfig {
  constructor(
    private readonly repo: CheckRuleConfigRepository,
    private readonly clock: Clock
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, body: unknown): Promise<CheckRuleConfig> {
    const by = requirePermission(actor, 'users.manage', matrix);
    const clean = { ...normalizeCheckRuleConfig(body), savedAt: this.clock.nowIso() };
    await this.repo.save(clean, by.id, clean.savedAt);
    return clean;
  }
}
