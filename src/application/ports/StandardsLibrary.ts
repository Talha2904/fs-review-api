/** One numbered paragraph of an accounting standard, as the review cites it ("FRS 102 33.9", "IAS 24 18"). */
export interface StandardPassage {
  ref: string;
  /** "FRS 102 Section 33", "IAS 24" */
  std: string;
  /** the section title or heading it sits under */
  topic: string;
  text: string;
}

export type StandardsFramework = 'FRS 102' | 'IFRS';

/** The standards the firm supplied (FRS 102 and IFRS), split into passages (scripts/build-standards.ts). */
export interface StandardsLibrary {
  /** Every passage of one framework; empty when that framework's index is not available. */
  passages(framework: StandardsFramework): Promise<StandardPassage[]>;
}
