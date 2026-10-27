/**
 * Shared DTOs for the Spend Intelligence API.
 * These types are imported by BOTH the server (engine + routes) and the client
 * (React dashboard) so the contract can never drift.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type FindingKind =
  | "ghost_seats"
  | "zombie_software"
  | "overlap_duplication"
  | "idle_seats"
  | "shadow_it";

export type ActionType =
  | "reclaim_seats"
  | "cancel_subscription"
  | "consolidate"
  | "update_contract";

export interface SeatEvidence {
  employeeName: string;
  employeeEmail: string;
  department: string;
  employeeStatus: "active" | "offboarded";
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  loginsLast30d: number;
  seatCostCents: number;
  flag: "offboarded" | "inactive_60d" | "inactive_30d" | "healthy";
}

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  vendorId: number | null;
  vendorName: string;
  category: string;
  title: string;
  detail: string;
  detectionRule: string;
  impactCents: number;
  seatsAffected: number;
  confidence: number;
  recommendedAction: string;
  actionType: ActionType | "review_contract";
  evidence: SeatEvidence[];
}

export interface InventoryRow {
  vendorId: number;
  vendorName: string;
  logoEmoji: string;
  category: string;
  categoryGroup: string;
  billingModel: "per_seat" | "flat" | "usage";
  seatsPaid: number;
  activeUsers: number;
  ghostSeats: number;
  idleSeats: number;
  monthlyCostCents: number;
  unitCostCents: number;
  healthScore: number;
  healthGrade: string;
  healthLabel: string;
  utilizationPct: number;
  avgDaysSinceLogin: number | null;
  annualizedCostCents: number;
  wastedCents: number;
  wasteReason: string | null;
  renewalDate: string;
  renewalInDays: number;
  contractOwner: string;
  status: "active" | "paused" | "cancelled" | "consolidated";
  overlapGroup: string | null;
  monthsTrend: number[];
}

export interface WasteLedgerRow {
  vendorId: number;
  vendorName: string;
  category: string;
  reason: "ghost_seats" | "zombie_software" | "duplicate_tooling" | "idle_seats";
  label: string;
  seats: number;
  monthlyCents: number;
  countedOnce: boolean;
}

export interface TransactionDTO {
  id: number;
  statementPeriod: string;
  postedAt: string;
  merchantDescriptor: string;
  vendorName: string | null;
  category: string;
  amountCents: number;
  cardLast4: string;
  cardholderEmail: string;
  isRecurring: boolean;
  matchConfidence: number;
  anomaly: string | null;
}

export interface SsoRecordDTO {
  id: number;
  appName: string;
  employeeEmail: string;
  employeeName: string;
  department: string;
  employeeStatus: "active" | "offboarded";
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
  loginsLast30d: number;
  billed: boolean;
  vendorName: string | null;
  seatStatus: "active" | "revoked" | "no_seat";
}

export interface EmployeeDTO {
  id: number;
  fullName: string;
  email: string;
  department: string;
  jobTitle: string;
  status: "active" | "offboarded";
  hiredAt: string;
  offboardedAt: string | null;
  appsAssigned: number;
  staleApps: number;
  seatSpendCents: number;
  lastActivityAt: string | null;
}

export interface AppliedActionDTO {
  id: number;
  vendorId: number | null;
  vendorName: string;
  actionType: ActionType;
  title: string;
  detail: string;
  seatsAffected: number;
  monthlySavingsCents: number;
  annualizedSavingsCents: number;
  triggeredBy: string;
  createdAt: string;
}

export interface Metrics {
  monthlySpendCents: number;
  annualizedSpendCents: number;
  activeSubscriptions: number;
  cancelledSubscriptions: number;
  wastedCents: number;
  wasteRatePct: number;
  recoverableCents: number;
  recoveredCents: number;
  recoveredAnnualizedCents: number;
  ghostSeatCount: number;
  zombieCount: number;
  overlapCount: number;
  idleSeatCount: number;
  shadowItCount: number;
  seatsPaid: number;
  activeUsers: number;
  seatUtilizationPct: number;
  avgHealthScore: number;
  openFindings: number;
  vendorCount: number;
}

export interface SpendTrendPoint {
  period: string;
  label: string;
  totalCents: number;
  seatCents: number;
  usageCents: number;
}

export interface CategorySlice {
  categoryGroup: string;
  monthlyCents: number;
  sharePct: number;
  vendorCount: number;
  overlap: boolean;
}

export interface ShadowItApp {
  appName: string;
  users: number;
  lastLoginAt: string | null;
  daysSinceLogin: number | null;
}

export interface IngestSource {
  name: string;
  format: string;
  rows: number;
  purpose: string;
  status: string;
}

export interface Snapshot {
  generatedAt: string;
  lastIngestAt: string | null;
  ingestDurationMs: number;
  ingestSources: IngestSource[];
  detectionRules: { name: string; rule: string; threshold: string; severity: Severity }[];
  metrics: Metrics;
  findings: Finding[];
  history: AppliedActionDTO[];
  inventory: InventoryRow[];
  wasteLedger: WasteLedgerRow[];
  categorySpend: CategorySlice[];
  spendTrend: SpendTrendPoint[];
  employees: EmployeeDTO[];
  transactions: TransactionDTO[];
  ssoLog: SsoRecordDTO[];
  shadowIt: ShadowItApp[];
}

export interface ActionResultPayload {
  ok: true;
  message: string;
  action: AppliedActionDTO;
  snapshot: Snapshot;
}

export interface ActionRequestPayload {
  vendorId: number;
  actionType: ActionType;
  seats?: number;
  /** Which detector raised this item — decides how the write-back is applied */
  findingKind?: FindingKind;
  mergeTargetVendorId?: number;
}
