/** The firm's check-rule template: defaults, the Administrator's edits to built-in rules, and custom rules. */
export interface CheckRuleConfig {
  rules: Record<string, { on: boolean; tol: number | null; tolKind: string }>;
  overrides: Record<string, Record<string, unknown>>;
  custom: Record<string, unknown>[];
  savedAt?: string;
}

export interface CheckRuleConfigRepository {
  /** Null when the Administrator has never saved the template. */
  get(): Promise<CheckRuleConfig | null>;
  save(config: CheckRuleConfig, updatedBy: string, at: string): Promise<void>;
}
