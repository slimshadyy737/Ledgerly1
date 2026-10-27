/**
 * ---------------------------------------------------------------------------
 * Canonical REST contract for the Spend API (mirrors server/src/services/*).
 * ---------------------------------------------------------------------------
 * These are pure types — no runtime imports — so they can be shared by the
 * server routes, the services AND the React components without pulling any
 * server-only module into the browser bundle.
 *
 * Money is always integer cents; every `*Display` field is a pre-formatted
 * string for direct rendering.
 */

export interface SpendCompany {
  id: number;
  name: string;
  domain: string;
  currency: string;
  headcount: number;
}

export interface SpendWindows {
  staleLicenseDays: number;
  activeSeatDays: number;
}

export interface SeatStats {
  paid: number;
  assigned: number;
  active: number;
  stale: number;
  idle: number;
  adoptionPct: number | null;
  averageDaysSinceLogin: number | null;
  staleCostCents: number;
}

export interface SubscriptionDTO {
  id: number;
  companyId: number;
  vendor: string;
  product: string | null;
  category: string;
  categoryGroup: string;
  billingModel: "per_seat" | "flat" | "usage";
  status: "active" | "paused" | "cancelled" | "consolidated";
  currency: string;
  seatsPaid: number;
  unitCostCents: number;
  unitCostDisplay: string;
  monthlyCostCents: number;
  monthlyCostDisplay: string;
  annualizedCostCents: number;
  seats: SeatStats;
  wasteCents: number;
  healthScore: number;
  isZombie: boolean;
  hasOverlappingVendors: boolean;
  overlappingVendorCount: number;
  contractOwner: string | null;
  nextRenewalAt: string | null;
  daysUntilRenewal: number | null;
  startedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeatMappingDTO {
  seatMappingId: number;
  userId: number;
  userName: string;
  userEmail: string;
  department: string;
  userStatus: "active" | "terminated";
  seatStatus: "active" | "revoked";
  seatCostCents: number;
  assignedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  lastLoginAt: string | null;
  loginsLast30d: number;
  daysSinceLogin: number | null;
  isStale: boolean;
}

export interface SubscriptionDetailDTO extends SubscriptionDTO {
  seatMappings: SeatMappingDTO[];
  consolidationTargets: {
    id: number;
    vendor_name: string;
    product_name: string | null;
    category_group: string;
    seats_paid: number;
    healthy_seats: number;
    recurring_cost_cents: number;
  }[];
  optimizationHistory: OptimizationEventDTO[];
}

export interface SubscriptionsListResponse {
  ok: true;
  company: { id: number; name: string; currency: string };
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean };
  sort: { key: string; order: "asc" | "desc" };
  filters: { status: string | null; categoryGroup: string | null; search: string | null; wastefulOnly: boolean };
  count: number;
  data: SubscriptionDTO[];
}

export interface WasteBucket {
  key: "stale_licenses" | "duplicate_categories" | "idle_seats" | "zombie_subscriptions";
  label: string;
  monthlyCents: number;
  monthlyDisplay: string;
  annualizedCents: number;
  shareOfWastePct: number;
  seats: number;
  detector: string;
}

export interface StaleLicenseDTO {
  subscriptionId: number;
  vendorName: string;
  productName: string | null;
  category: string;
  categoryGroup: string;
  seatMappingId: number;
  userId: number;
  userName: string;
  userEmail: string;
  department: string;
  userStatus: "active" | "terminated";
  reason: "offboarded_holder" | "never_logged_in" | "inactive_beyond_window";
  daysSinceLogin: number | null;
  lastLoginAt: string | null;
  loginsLast30d: number;
  seatCostCents: number;
  seatCostDisplay: string;
}

export interface WasteOffenderDTO {
  subscriptionId: number;
  vendorName: string;
  productName: string | null;
  category: string;
  categoryGroup: string;
  billingModel: "per_seat" | "flat" | "usage";
  seatsPaid: number;
  activeSeats: number;
  staleSeats: number;
  idleSeats: number;
  isZombie: boolean;
  isDuplicateOfCategory: boolean;
  monthlyCents: number;
  monthlyDisplay: string;
  wasteCents: number;
  wasteDisplay: string;
  wasteAnnualizedCents: number;
  wasteSources: { staleLicencesCents: number; duplicateCategoryCents: number; idleSeatsCents: number };
}

export interface DuplicateVendorDTO {
  subscriptionId: number;
  vendorName: string;
  productName: string | null;
  category: string;
  billingModel: "per_seat" | "flat" | "usage";
  monthlyCents: number;
  monthlyDisplay: string;
  seatsPaid: number;
  healthySeats: number;
  staleSeats: number;
  adoptionPct: number | null;
  categoryRank: number;
  isIncumbent: boolean;
  isDuplicateCandidate: boolean;
  duplicateWasteCents: number;
  duplicateWasteDisplay: string;
  isZombie: boolean;
}

export interface DuplicateCategoryDTO {
  categoryGroup: string;
  vendorCount: number;
  categoryMonthlyCents: number;
  categoryMonthlyDisplay: string;
  duplicateWasteCents: number;
  duplicateWasteDisplay: string;
  savingsCountedElsewhere: boolean;
  note: string | null;
  vendors: DuplicateVendorDTO[];
}

export interface CategorySpendDTO {
  categoryGroup: string;
  vendorCount: number;
  monthlyCents: number;
  monthlyDisplay: string;
  wasteCents: number;
  seatsPaid: number;
  overlappingVendorCount: number;
  sharePct: number;
}

export interface RenewalDTO {
  subscriptionId: number;
  vendorName: string;
  categoryGroup: string;
  monthlyCents: number;
  monthlyDisplay: string;
  nextRenewalAt: string;
  daysUntilRenewal: number;
}

export interface DetectorDTO {
  id: "STALE_LICENSE" | "DUPLICATE_CATEGORY" | "IDLE_SEAT" | "ZOMBIE_SOFTWARE";
  rule: string;
  waste: string;
  monthlyCents: number;
  hits: number;
}

export interface AnalyticsResponse {
  ok: true;
  generatedAt: string;
  asOf: string;
  company: SpendCompany;
  windows: SpendWindows;
  totalSpend: {
    monthlyCents: number;
    monthlyDisplay: string;
    annualizedCents: number;
    annualizedDisplay: string;
    activeSubscriptions: number;
    seatsPaid: number;
    assignedSeats: number;
    activeSeats: number;
    seatUtilisationPct: number;
    averageHealthScore: number;
  };
  totalWaste: {
    monthlyCents: number;
    monthlyDisplay: string;
    annualizedCents: number;
    annualizedDisplay: string;
    wasteRatePct: number;
    countingPolicy: string;
    breakdown: WasteBucket[];
    staleSeatCount: number;
    idleSeatCount: number;
    zombieCount: number;
    duplicateVendorCount: number;
    duplicateCategoryGroupCount: number;
  };
  estate: {
    subscriptionsTotal: number;
    subscriptionsActive: number;
    subscriptionsCancelled: number;
    subscriptionsConsolidated: number;
    subscriptionsPaused: number;
  };
  detectors: DetectorDTO[];
  duplicateCategories: DuplicateCategoryDTO[];
  staleLicences: StaleLicenseDTO[];
  topWasteOffenders: WasteOffenderDTO[];
  categorySpend: CategorySpendDTO[];
  upcomingRenewals: RenewalDTO[];
}

export interface OptimizationEventDTO {
  id: number;
  subscriptionId: number;
  vendorName: string;
  action: "reclaim_seats" | "cancel" | "consolidate" | "update_contract";
  seatsReclaimed: number;
  previousCostCents: number;
  newCostCents: number;
  savingsCents: number;
  savingsDisplay: string;
  performedBy: string;
  createdAt: string;
  detail: string | null;
}

export interface OptimizationsResponse {
  ok: true;
  company: { id: number; name: string };
  count: number;
  totals: { seatsReclaimed: number; monthlySavingsCents: number; annualizedSavingsCents: number };
  data: OptimizationEventDTO[];
}

export type OptimizeAction = "reclaim_seats" | "cancel" | "consolidate" | "update_contract";

export interface OptimizeResponse {
  ok: true;
  message: string;
  data: {
    subscription: SubscriptionDTO | null;
    action: OptimizeAction;
    seatsReclaimed: number;
    revokedSeats: { seatMappingId: number; userId: number; seatCostCents: number }[];
    savings: {
      monthlyCents: number;
      monthlyDisplay: string;
      annualizedCents: number;
      annualizedDisplay: string;
      previousMonthlyCents: number;
      newMonthlyCents: number;
    };
    auditEventId: number;
    analytics: AnalyticsResponse;
  };
}

export interface CompaniesResponse {
  ok: true;
  count: number;
  data: {
    id: number;
    name: string;
    domain: string;
    headcount: number;
    currency: string;
    stale_license_days: number;
    active_seat_days: number;
    users_count: number;
    active_subscriptions: number;
  }[];
}

export interface ApiErrorResponse {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId?: string;
  timestamp?: string;
}
