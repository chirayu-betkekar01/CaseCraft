/** Mirrors the Pydantic models in backend/models.py. */

export type Category = "Cost Savings" | "Productivity Gains" | "Risk Reduction";

export const CATEGORIES: Category[] = [
  "Cost Savings",
  "Productivity Gains",
  "Risk Reduction",
];

/** Categorical slots 1-3 of the validated palette, in fixed order. */
export const CATEGORY_HUE: Record<Category, string> = {
  "Cost Savings": "var(--series-1)",
  "Productivity Gains": "var(--series-2)",
  "Risk Reduction": "var(--series-3)",
};

export type Unit =
  | "count"
  | "USD"
  | "USD/year"
  | "USD/hour"
  | "USD/GB"
  | "hours"
  | "minutes"
  | "days"
  | "GB"
  | "FTE"
  | "percent";

export interface GlobalInput {
  key: string;
  label: string;
  unit: Unit;
  defaultValue: number;
  notes: string;
}

export interface Variable {
  key: string;
  label: string;
  unit: Unit;
  /** Either "driverInput" or "globalInput:<key>". */
  source: string;
  defaultValue: number | null;
  notes: string;
}

export interface Driver {
  id: string;
  category: Category;
  name: string;
  shortDescription: string;
  narrative: string;
  formula: { display: string; variables: Variable[] };
  outputUnit: string;
  illustrativeExample: { assumptions: string; calculatedValue: number };
}

export interface OverlapGroup {
  id: string;
  label: string;
  exclusive: string;
  conflictsWith: string[];
  guidance: string;
}

export interface Library {
  globalInputs: GlobalInput[];
  drivers: Driver[];
  overlapGroups: OverlapGroup[];
}

export interface Deal {
  companyName: string;
  domain: string | null;
  annualCost: number;
  oneTimeCost: number;
  termYears: number;
}

export interface DriverResult {
  driverId: string;
  name: string;
  category: Category;
  annualValue: number;
  oneTimeValue: number;
  formulaDisplay: string;
  narrative: string;
  inputsUsed: Record<string, number>;
}

export interface CaseMetrics {
  drivers: DriverResult[];
  totalAnnualValue: number;
  totalOneTimeValue: number;
  valueByCategory: Record<string, number>;
  annualCost: number;
  oneTimeCost: number;
  termYears: number;
  totalValue: number;
  tco: number;
  netValue: number;
  roiPct: number | null;
  /** null when the deal never pays back inside the term. */
  paybackMonths: number | null;
}

export interface CaseResponse {
  metrics: CaseMetrics;
  cashFlow: { month: number; net: number }[];
}

/** driver id -> that driver's input overrides. */
export type Selections = Record<string, Record<string, number>>;

/** How strongly the call supports a driver. Three levels, not a score. */
export type Confidence = "high" | "medium" | "low";

export interface DriverSuggestion {
  driverId: string;
  name: string;
  category: Category;
  confidence: Confidence;
  /** Verbatim from the transcript, or "" when the quote could not be found. */
  evidence: string;
  rationale: string;
  quoteVerified: boolean;
}

export interface GlobalProposal {
  key: string;
  label: string;
  unit: Unit;
  value: number;
  currentDefault: number;
  evidence: string;
  quoteVerified: boolean;
}

export interface TranscriptAnalysis {
  suggestions: DriverSuggestion[];
  globalProposals: GlobalProposal[];
  /** What the server dropped on the way through, so the filtering is visible. */
  discarded: string[];
}

export const globalKeyOf = (variable: Variable): string | null =>
  variable.source.startsWith("globalInput:")
    ? variable.source.slice("globalInput:".length)
    : null;

export const isDriverInput = (variable: Variable): boolean =>
  globalKeyOf(variable) === null;
