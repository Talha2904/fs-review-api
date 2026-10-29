/**
 * What the portfolio needs about every fund, read with aggregate queries (counts and latest times per fund)
 * instead of loading each fund's whole review. Only funds with review activity appear; a fund with none is
 * "Not started".
 */
export interface FundActivity {
  engagementId: string;
  /** at least one slot has a current (not removed) version */
  hasDocuments: boolean;
  workflowState: string;
  signoffState: string;
  analysed: boolean;
  openPoints: number;
  respondedPoints: number;
  /** open points whose due date is before `today` */
  overduePoints: number;
  /** the latest upload, workflow or sign-off change, analysis or message */
  lastActivityAt: string | null;
}

export interface PortfolioReadModel {
  activity(today: string): Promise<FundActivity[]>;
}
