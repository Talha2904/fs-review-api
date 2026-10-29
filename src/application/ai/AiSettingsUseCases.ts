import { AI_STEPS, DEFAULT_AI, normalizeAi, type AiSettings, type PermissionMatrix } from '@fs-review/shared';

import { aiUnavailable, validationFailed } from '../../domain/errors.js';
import type { Actor } from '../../domain/identity/User.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import { requirePermission } from '../identity/authorize.js';
import type { AiGateway } from '../ports/AiGateway.js';
import type { AiSettingsRepository } from '../ports/AiSettingsRepository.js';
import type { Clock } from '../ports/Clock.js';

import { plainAiError } from './aiErrors.js';

/** Current settings, or the defaults with the configured model when nothing was ever saved. */
export class LoadAiSettings {
  constructor(
    private readonly repo: AiSettingsRepository,
    private readonly defaultModel: string
  ) {}
  async execute(): Promise<AiSettings> {
    return (await this.repo.get()) ?? normalizeAi({ ...DEFAULT_AI, model: this.defaultModel });
  }
}

/** For everyone signed in: whether a key exists and what is switched on. */
export class GetAiStatus {
  constructor(
    private readonly load: LoadAiSettings,
    private readonly gateway: AiGateway
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix) {
    requirePermission(actor, 'activity.write', matrix);
    return { serverKey: this.gateway.keyStatus().configured, ...(await this.load.execute()) };
  }
}

/** Administrators only: settings plus the key's status (never the key). */
export class GetAiSettings {
  constructor(
    private readonly load: LoadAiSettings,
    private readonly gateway: AiGateway
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix) {
    requirePermission(actor, 'users.manage', matrix);
    return { settings: await this.load.execute(), key: this.gateway.keyStatus() };
  }
}

export class SaveAiSettings {
  constructor(
    private readonly repo: AiSettingsRepository,
    private readonly load: LoadAiSettings,
    private readonly gateway: AiGateway,
    private readonly clock: Clock,
    private readonly activity: ActivityRecorder
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, body: unknown, ip?: string) {
    const by = requirePermission(actor, 'users.manage', matrix);
    const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (src.enabled && !src.acknowledgement) throw validationFailed('Confirm the firm’s AI policy before turning AI on.');
    const before = await this.load.execute();
    const after = normalizeAi(src);
    await this.repo.save(after, by.id, this.clock.nowIso());
    const changes = [
      before.enabled !== after.enabled && `AI ${after.enabled ? 'turned on' : 'turned off'}`,
      before.model !== after.model && `model ${after.model}`,
      ...AI_STEPS.filter((s) => before.steps[s.id] !== after.steps[s.id]).map((s) => `${s.label} ${after.steps[s.id] ? 'on' : 'off'}`)
    ].filter((x): x is string => typeof x === 'string');
    if (changes.length)
      await this.activity.record({
        actor: by,
        category: 'AI',
        summary: 'Changed the AI settings',
        details: changes.join(' · '),
        ip: ip ?? ''
      });
    return { settings: after, key: this.gateway.keyStatus() };
  }
}

export class TestAiConnection {
  constructor(
    private readonly load: LoadAiSettings,
    private readonly gateway: AiGateway,
    private readonly activity: ActivityRecorder
  ) {}
  async execute(actor: Actor | null, matrix: PermissionMatrix, ip?: string): Promise<{ ok: true; model: string; ms: number }> {
    const by = requirePermission(actor, 'users.manage', matrix);
    if (!this.gateway.keyStatus().configured) throw validationFailed('No Claude API key is configured on the server.');
    const { model } = await this.load.execute();
    try {
      const r = await this.gateway.ping(model);
      await this.activity.record({
        actor: by,
        category: 'AI',
        summary: 'Tested the AI connection',
        details: `${r.model} · ${r.ms} ms`,
        ip: ip ?? ''
      });
      return { ok: true, ...r };
    } catch (e) {
      throw aiUnavailable(plainAiError(e));
    }
  }
}
