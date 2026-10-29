export interface ChecklistItem {
  id: string;
  ref: string;
  section: string;
  text: string;
  keywords: string[];
}

export interface ChecklistTemplate {
  framework: string;
  version: string;
  items: ChecklistItem[];
  savedBy: string | null;
  savedAt: string;
}

export interface ChecklistTemplateRepository {
  /** The current checklist for every framework that has one. */
  list(): Promise<ChecklistTemplate[]>;
  get(framework: string): Promise<ChecklistTemplate | null>;
  /** Replaces the current checklist and appends it to the version history. */
  save(template: ChecklistTemplate, versionId: string): Promise<void>;
}
