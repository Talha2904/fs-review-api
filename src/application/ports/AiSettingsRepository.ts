import type { AiSettings } from '@fs-review/shared';

export interface AiSettingsRepository {
  /** Null when an Administrator has never saved settings. */
  get(): Promise<AiSettings | null>;
  save(settings: AiSettings, updatedBy: string, at: string): Promise<void>;
}
