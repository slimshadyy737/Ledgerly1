/**
 * ---------------------------------------------------------------------------
 * SANDBOX ENGINE — PART 2: the generator
 * ---------------------------------------------------------------------------
 * `buildSandboxDataset()` is a pure function: (now) => dataset.
 * It performs the same three "imports" a production system would do:
 *
 *   1. HRIS roster                 -> employees
 *   2. Licence register + SSO logs -> seat assignments + sso_events
 *   3. Card statement (6 months)   -> transactions
 *
 * No external API is called: the login timeline is synthesised with a seeded
 * PRNG so demos are reproducible, and every synthetic value is explained with a
 * comment you can point at during your evaluation walkthrough.
 */
import {
  COMPANY,
  DAY_MS,
  SHADOW_IT_APPS,
  VENDOR_BLUEPRINTS,
  buildRawEmployees,
  makeRng,
  type VendorBlueprint,
} from "./catalog";

export interface GeneratedEmployee {
  fullName: string;
  email: string;
  department: string;
  jobTitle: string;
  status: "active" | "offboarded";
  hiredAt: Date;
  offboardedAt: Date | null;
}

export interface GeneratedVendor {
  vendorKey: string;
  name: string;
  category: string;
  categoryGroup: string;
  billingModel: "per_seat" | "flat" | "usage";
  seatUnitCostCents: number;
  seatsPaid: number;
  idleSeats: number;
  flatMonthlyCents: number;
  monthlyCostCents: number;
  contractOwner: string;
  renewalDate: Date;
  logoEmoji: string;
  notes: string;
}

export interface GeneratedSeat {
  vendorIndex: number;
  employeeIndex: number;
  seatCostCents: number;
  assignedAt: Date;
  lastLoginAt: Date | null;
  loginsLast30d: number;
  totalLogins90d: number;
}

export interface GeneratedSsoEvent {
  appName: string;
  employeeIndex: number | null;
  employeeEmail: string;
  lastLoginAt: Date | null;
  loginsLast30d: number;
  totalLogins90d: number;
  samlApp: boolean;
}

export interface GeneratedTransaction {
  statementPeriod: string;
  postedAt: Date;
  merchantDescriptor: string;
  vendorIndex: number | null;
  vendorKey: string | null;
  category: string;
  amountCents: number;
  cardLast4: string;
  cardholderEmail: string;
  isRecurring: boolean;
  matchConfidence: number;
  anomaly: string | null;
}

export interface SandboxDataset {
  generatedAt: Date;
  employees: GeneratedEmployee[];
  vendors: GeneratedVendor[];
  seats: GeneratedSeat[];
  ssoEvents: GeneratedSsoEvent[];
  transactions: GeneratedTransaction[];
  shadowIt: { appName: string; users: number; lastLoginAt: Date; note: string }[];
  meta: {
    company: string;
    headcount: number;
    offboardedCount: number;
    periodMonths: number;
    narrative: string;
  };
}

const CARDHOLDERS = [
  "finance-ops@northwind.io",
  "ap@northwind.io",
  "controller@northwind.io",
];

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function monthPeriod(now: Date, offsetBack: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Current monthly cost of a subscription in cents (single source of truth). */
export function vendorMonthlyCostCents(vendor: VendorBlueprint): number {
  if (vendor.billingModel === "per_seat") return vendor.seatsPaid * vendor.seatUnitCostCents;
  return vendor.flatMonthlyCents;
}

/** Which "kind" of seat should be created for a given ordinal position. */
type SeatKind = "offboarded_ghost" | "stale_ghost" | "warm" | "fresh";

function buildSeatPlan(vendor: VendorBlueprint): SeatKind[] {
  const assignable = Math.max(0, vendor.seatsPaid - vendor.idleSeats);
  const plan: SeatKind[] = [];

  if (vendor.zombie) {
    // Zombie tool: EVERY seat holder went silent 30+ days ago.
    for (let i = 0; i < assignable; i += 1) plan.push(i < vendor.ghostOffboarded ? "offboarded_ghost" : "stale_ghost");
    return plan;
  }

  const push = (kind: SeatKind, count: number) => {
    for (let i = 0; i < count && plan.length < assignable; i += 1) plan.push(kind);
  };
  push("offboarded_ghost", vendor.ghostOffboarded);
  push("stale_ghost", vendor.ghostStale);
  push("warm", vendor.warmSeats);
  push("fresh", assignable - plan.length); // remainder = healthy, actively used seats

  // Guarantee we always return exactly `assignable` entries.
  while (plan.length < assignable) plan.push("fresh");
  return plan.slice(0, assignable);
}

export function buildSandboxDataset(now: Date = new Date()): SandboxDataset {
  const rawEmployees = buildRawEmployees();

  const employees: GeneratedEmployee[] = rawEmployees.map((e) => ({
    fullName: e.fullName,
    email: e.email,
    department: e.department,
    jobTitle: e.jobTitle,
    status: e.status,
    hiredAt: daysAgo(now, e.hiredAtOffsetDays),
    offboardedAt: e.offboardedDaysAgo === null ? null : daysAgo(now, e.offboardedDaysAgo),
  }));

  const vendors: GeneratedVendor[] = VENDOR_BLUEPRINTS.map((v) => ({
    vendorKey: v.key,
    name: v.name,
    category: v.category,
    categoryGroup: v.categoryGroup,
    billingModel: v.billingModel,
    seatUnitCostCents: v.seatUnitCostCents,
    seatsPaid: v.seatsPaid,
    idleSeats: v.idleSeats,
    flatMonthlyCents: v.flatMonthlyCents,
    monthlyCostCents: vendorMonthlyCostCents(v),
    contractOwner: v.contractOwner,
    renewalDate: new Date(now.getTime() + v.renewalInDays * DAY_MS),
    logoEmoji: v.logoEmoji,
    notes: v.notes,
  }));

  const activeEmployees = rawEmployees.filter((e) => e.status === "active");
  const offboardedEmployees = rawEmployees
    .filter((e) => e.status === "offboarded")
    .sort((a, b) => (b.offboardedDaysAgo ?? 0) - (a.offboardedDaysAgo ?? 0));

  const seats: GeneratedSeat[] = [];
  const ssoEvents: GeneratedSsoEvent[] = [];

  VENDOR_BLUEPRINTS.forEach((vendor, vendorIndex) => {
    if (vendor.billingModel !== "per_seat" || vendor.seatsPaid === 0) return;

    const rng = makeRng(vendor.key.length * 7919 + vendor.seatsPaid * 131 + vendorIndex);
    const plan = buildSeatPlan(vendor);

    // Deterministic "who gets a seat" ordering: channel members first, then everyone.
    const channelMembers = activeEmployees.filter((e) => vendor.channels.includes(e.department));
    const others = activeEmployees.filter((e) => !vendor.channels.includes(e.department));
    const shuffle = (list: typeof activeEmployees) =>
      [...list].sort(
        (a, b) => (rngScore(vendor.key, a.email) % 10_000) - (rngScore(vendor.key, b.email) % 10_000),
      );
    const candidatePool = [...shuffle(channelMembers), ...shuffle(others)];

    let activeCursor = 0;
    let offboardCursor = 0;
    const usedEmployeeIds = new Set<number>();

    const nextActive = (): number => {
      // Advance until we find an employee who does not already hold a seat here.
      while (activeCursor < candidatePool.length) {
        const candidate = candidatePool[activeCursor];
        activeCursor += 1;
        const idx = rawEmployees.indexOf(candidate);
        if (!usedEmployeeIds.has(idx)) {
          usedEmployeeIds.add(idx);
          return idx;
        }
      }
      // Pool exhausted (very wide seating) — wrap around deterministically.
      return rawEmployees.indexOf(candidatePool[(activeCursor++) % candidatePool.length]);
    };

    plan.forEach((kind, seatOrdinal) => {
      let employeeIndex: number;
      let lastLoginDays: number | null;
      let logins30d: number;

      if (kind === "offboarded_ghost") {
        // Real-world cause of ghost seats: the human left, the licence stayed.
        const offb = offboardedEmployees[offboardCursor % offboardedEmployees.length];
        offboardCursor += 1;
        employeeIndex = rawEmployees.indexOf(offb);
        lastLoginDays = Math.max((offb.offboardedDaysAgo ?? 60) + 2, 12); // one final login before leaving
        logins30d = 0;
      } else if (kind === "stale_ghost") {
        employeeIndex = nextActive();
        lastLoginDays = 61 + Math.floor(rng() * 90); // 61-150 days: passes the 60-day ghost rule
        logins30d = 0;
      } else if (kind === "warm") {
        employeeIndex = nextActive();
        lastLoginDays = 31 + Math.floor(rng() * 29); // 31-59 days: not a ghost, but "cold"
        logins30d = rng() > 0.6 ? 1 : 0;
      } else {
        employeeIndex = nextActive();
        lastLoginDays = Math.floor(rng() * 21); // 0-20 days: healthy
        logins30d = 4 + Math.floor(rng() * 24);
      }

      const lastLoginAt = lastLoginDays === null ? null : daysAgo(now, lastLoginDays);
      seats.push({
        vendorIndex,
        employeeIndex,
        seatCostCents: vendor.seatUnitCostCents,
        assignedAt: daysAgo(now, 30 + Math.floor(rng() * 400)),
        lastLoginAt,
        loginsLast30d: logins30d,
        totalLogins90d: logins30d + Math.floor(rng() * 60),
      });

      // Every provisioned seat produces exactly one SSO record (the join key is email).
      const employee = rawEmployees[employeeIndex];
      ssoEvents.push({
        appName: vendor.name,
        employeeIndex,
        employeeEmail: employee.email,
        lastLoginAt,
        loginsLast30d: logins30d,
        totalLogins90d: logins30d + Math.floor(rng() * 40),
        samlApp: true,
      });
    });
  });

  // Shadow IT: apps with SSO activity but no corporate-card transaction.
  const shadowIt = SHADOW_IT_APPS.map((app) => {
    const rng = makeRng(app.appName.length * 3571);
    activeEmployees.forEach((employee, i) => {
      if (i % Math.max(2, Math.floor(COMPANY.headcount / app.users)) !== 0) return;
      const days = Math.max(1, Math.round(app.daysSinceLogin + rng() * 12));
      ssoEvents.push({
        appName: app.appName,
        employeeIndex: rawEmployees.indexOf(employee),
        employeeEmail: employee.email,
        lastLoginAt: daysAgo(now, days),
        loginsLast30d: 1 + Math.floor(rng() * 18),
        totalLogins90d: 5 + Math.floor(rng() * 50),
        samlApp: false,
      });
    });
    return {
      appName: app.appName,
      users: app.users,
      lastLoginAt: daysAgo(now, app.daysSinceLogin),
      note: app.note,
    };
  });

  /* ----------------------- Card / accounting statement ---------------------- */
  const statements: GeneratedTransaction[] = [];
  const MONTHS = 6;

  VENDOR_BLUEPRINTS.forEach((vendor, vendorIndex) => {
    const rng = makeRng(vendor.key.length * 104_729 + vendorIndex * 17);
    const currentCost = vendorMonthlyCostCents(vendor);

    for (let back = MONTHS - 1; back >= 0; back -= 1) {
      const period = monthPeriod(now, back);
      const monthsElapsed = MONTHS - 1 - back; // 0 for the oldest statement
      let amountCents = currentCost;

      if (vendor.billingModel === "per_seat") {
        // Seats ramp up over the year: the current month equals the register value.
        const growthPerMonth = Math.max(1, Math.round(vendor.seatsPaid * 0.02));
        const seatsThatMonth = Math.max(1, vendor.seatsPaid - growthPerMonth * back);
        amountCents = seatsThatMonth * vendor.seatUnitCostCents;
      } else if (vendor.billingModel === "usage") {
        // Usage vendors drift +/- with traffic; the latest month is the real bill.
        if (back !== 0) amountCents = Math.round(currentCost * (0.82 + rng() * 0.3) / 100) * 100;
      }

      const postedDay = 2 + ((vendorIndex * 3 + monthsElapsed) % 12);
      const postedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, postedDay, 9, 30));

      statements.push({
        statementPeriod: period,
        postedAt,
        merchantDescriptor: vendor.merchantDescriptor,
        vendorIndex,
        vendorKey: vendor.key,
        category: vendor.category,
        amountCents,
        cardLast4: vendor.cardLast4,
        cardholderEmail: CARDHOLDERS[vendorIndex % CARDHOLDERS.length],
        isRecurring: true,
        // Fuzzy matcher confidence: legacy/foreign descriptors score lower (a nice
        // detail to explain how descriptor -> vendor normalisation works).
        matchConfidence: /LEGACY|B\.V\.|LTD|IE|NL/.test(vendor.merchantDescriptor) ? 92 : 100,
        anomaly:
          back === 0 && vendor.zombie
            ? "No SSO activity in 30+ days — billing still active"
            : back === 0 && vendor.billingModel === "usage"
              ? "Usage-based spend up 14% MoM — review host/seat footprint"
              : null,
      });
    }
  });

  return {
    generatedAt: now,
    employees,
    vendors,
    seats,
    ssoEvents,
    transactions: statements.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()),
    shadowIt,
    meta: {
      company: COMPANY.name,
      headcount: employees.length,
      offboardedCount: employees.filter((e) => e.status === "offboarded").length,
      periodMonths: MONTHS,
      narrative:
        "Northwind Analytics is an 80-person Series-B SaaS company paying 27 vendors from two corporate cards. " +
        "The roster, licence register, SSO logins and six months of card statements are simulated locally.",
    },
  };
}

/** Stable pseudo-random score used to order candidate employees per vendor. */
function rngScore(vendorKey: string, email: string): number {
  let h = 2166136261;
  const input = `${vendorKey}:${email}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10_000;
}
