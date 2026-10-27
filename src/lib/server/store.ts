/**
 * ---------------------------------------------------------------------------
 * DATA LAYER — sandbox ingestion + write-back actions
 * ---------------------------------------------------------------------------
 *   ensureSeeded()   : idempotently loads the mock company into PostgreSQL
 *                      (this is the "ingestion job" of the prototype)
 *   reseedSandbox()  : drops the loaded rows and re-runs the generator
 *   getSnapshot()    : reads all four source tables and runs the detective
 *   applyAction()    : write-back — reclaims seats / cancels / consolidates and
 *                      records the decision in optimization_actions (audit log)
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  ingestRuns,
  optimizationActions,
  seatAssignments,
  ssoEvents,
  transactions,
  vendors,
} from "@/db/schema";
import { runDetective, daysSince } from "@/lib/engine";
import type { ActionRequestPayload, AppliedActionDTO, Snapshot } from "@/lib/types";
import { buildSandboxDataset, type SandboxDataset } from "@/lib/sandbox/generator";

const CHUNK = 300;

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/* ------------------------------- ingestion -------------------------------- */

export async function reseedSandbox(): Promise<{ dataset: SandboxDataset; durationMs: number }> {
  const startedAt = Date.now();
  const dataset = buildSandboxDataset(new Date());

  // Clean slate (order matters because of the FK-less but logical relationships).
  await db.delete(optimizationActions);
  await db.delete(seatAssignments);
  await db.delete(ssoEvents);
  await db.delete(transactions);
  await db.delete(vendors);
  await db.delete(employees);
  await db.delete(ingestRuns);

  /* 1. Source A — HRIS roster */
  const insertedEmployees = await db
    .insert(employees)
    .values(
      dataset.employees.map((e) => ({
        fullName: e.fullName,
        email: e.email,
        department: e.department,
        jobTitle: e.jobTitle,
        status: e.status,
        hiredAt: e.hiredAt,
        offboardedAt: e.offboardedAt,
      })),
    )
    .returning({ id: employees.id, email: employees.email });
  const employeeIdByEmail = new Map(insertedEmployees.map((e) => [e.email, e.id]));

  /* 2. Vendor / contract register */
  const insertedVendors = await db
    .insert(vendors)
    .values(
      dataset.vendors.map((v) => ({
        vendorKey: v.vendorKey,
        name: v.name,
        category: v.category,
        categoryGroup: v.categoryGroup,
        billingModel: v.billingModel,
        seatUnitCostCents: v.seatUnitCostCents,
        seatsPaid: v.seatsPaid,
        idleSeats: v.idleSeats,
        flatMonthlyCents: v.flatMonthlyCents,
        monthlyCostCents: v.monthlyCostCents,
        contractOwner: v.contractOwner,
        renewalDate: v.renewalDate,
        logoEmoji: v.logoEmoji,
        notes: v.notes,
      })),
    )
    .returning({ id: vendors.id, vendorKey: vendors.vendorKey });
  const vendorIdByKey = new Map(insertedVendors.map((v) => [v.vendorKey, v.id]));

  /* 3. Licence register (who holds a seat) */
  const seatRows = dataset.seats.flatMap((s) => {
    const vendorKey = dataset.vendors[s.vendorIndex].vendorKey;
    const employeeEmail = dataset.employees[s.employeeIndex].email;
    const vendorId = vendorIdByKey.get(vendorKey);
    const employeeId = employeeIdByEmail.get(employeeEmail);
    if (!vendorId || !employeeId) return [];
    return [
      {
        vendorId,
        employeeId,
        seatCostCents: s.seatCostCents,
        status: "active" as const,
        assignedAt: s.assignedAt,
        lastLoginAt: s.lastLoginAt,
        loginsLast30d: s.loginsLast30d,
      },
    ];
  });
  for (const rows of chunk(seatRows)) await db.insert(seatAssignments).values(rows);

  /* 4. Google Workspace SSO export */
  const ssoRows = dataset.ssoEvents.flatMap((row) => {
    const employeeId = employeeIdByEmail.get(row.employeeEmail);
    if (!employeeId) return [];
    return [
      {
        appName: row.appName,
        employeeId,
        employeeEmail: row.employeeEmail,
        lastLoginAt: row.lastLoginAt,
        loginsLast30d: row.loginsLast30d,
        totalLogins90d: row.totalLogins90d,
        samlApp: row.samlApp,
      },
    ];
  });
  for (const rows of chunk(ssoRows)) await db.insert(ssoEvents).values(rows);

  /* 5. Corporate card / accounting statement */
  const txRows = dataset.transactions.flatMap((t) => {
    const vendorId = t.vendorKey ? (vendorIdByKey.get(t.vendorKey) ?? null) : null;
    return [
      {
        statementPeriod: t.statementPeriod,
        postedAt: t.postedAt,
        merchantDescriptor: t.merchantDescriptor,
        vendorId,
        vendorKey: t.vendorKey,
        category: t.category,
        amountCents: t.amountCents,
        cardLast4: t.cardLast4,
        cardholderEmail: t.cardholderEmail,
        isRecurring: t.isRecurring,
        matchConfidence: t.matchConfidence,
        anomaly: t.anomaly,
      },
    ];
  });
  for (const rows of chunk(txRows)) await db.insert(transactions).values(rows);

  const durationMs = Date.now() - startedAt;
  await db.insert(ingestRuns).values({
    startedAt: new Date(startedAt),
    finishedAt: new Date(),
    sourceNote: "sandbox-engine",
    employeesIngested: dataset.employees.length,
    vendorsIngested: dataset.vendors.length,
    seatsIngested: seatRows.length,
    ssoEventsIngested: ssoRows.length,
    transactionsIngested: txRows.length,
    durationMs,
    status: "succeeded",
  });

  return { dataset, durationMs };
}

let seedPromise: Promise<void> | null = null;

/** Loads the sandbox only when the database is empty (safe to call per request). */
export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(vendors);
    if (!row || row.count === 0) {
      await reseedSandbox();
    }
  })().finally(() => {
    // Allow a later request to re-check (e.g. after a manual reseed).
    setTimeout(() => {
      seedPromise = null;
    }, 1_000);
  });
  return seedPromise;
}

/* -------------------------------- read path -------------------------------- */

export async function getSnapshot(): Promise<Snapshot> {
  await ensureSeeded();
  const now = new Date();

  const [employeeRows, vendorRows, seatRows, ssoRows, txRows, actionRows, runRows] = await Promise.all([
    db.select().from(employees),
    db.select().from(vendors),
    db.select().from(seatAssignments),
    db.select().from(ssoEvents),
    db.select().from(transactions),
    db.select().from(optimizationActions),
    db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(1),
  ]);

  const { snapshot } = runDetective({
    now,
    employees: employeeRows,
    vendors: vendorRows,
    seats: seatRows,
    ssoEvents: ssoRows,
    transactions: txRows,
    actions: actionRows,
    lastIngestAt: runRows[0]?.finishedAt ?? runRows[0]?.startedAt ?? null,
    ingestDurationMs: runRows[0]?.durationMs ?? 0,
  });

  return snapshot;
}

/* ------------------------------- write path -------------------------------- */

export async function applyAction(payload: ActionRequestPayload): Promise<{
  snapshot: Snapshot;
  action: AppliedActionDTO;
  message: string;
}> {
  await ensureSeeded();
  const now = new Date();

  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, payload.vendorId)).limit(1);
  if (!vendor) throw new Error(`Vendor ${payload.vendorId} not found`);
  if (vendor.status !== "active") throw new Error(`${vendor.name} is already ${vendor.status}`);

  let seatsAffected = 0;
  let monthlySavingsCents = 0;
  let title = "";
  let detail = "";

  if (payload.actionType === "reclaim_seats") {
    if (vendor.billingModel !== "per_seat") {
      throw new Error(`${vendor.name} is ${vendor.billingModel}-priced; there are no seats to reclaim`);
    }
    const requested = Math.max(1, payload.seats ?? 0);
    const revocable = Math.min(requested, vendor.seatsPaid);
    const isIdleReclaim = payload.findingKind === "idle_seats";

    if (!isIdleReclaim) {
      /* Pick the worst seats first: offboarded holders, then longest inactivity. */
      const rows = await db
        .select({ seat: seatAssignments, employee: employees, sso: ssoEvents })
        .from(seatAssignments)
        .innerJoin(employees, eq(employees.id, seatAssignments.employeeId))
        .leftJoin(
          ssoEvents,
          and(eq(ssoEvents.employeeId, seatAssignments.employeeId), eq(ssoEvents.appName, vendor.name)),
        )
        .where(and(eq(seatAssignments.vendorId, vendor.id), eq(seatAssignments.status, "active")));

      const ranked = rows
        .map((row) => ({
          id: row.seat.id,
          email: row.employee.email,
          offboarded: row.employee.status === "offboarded",
          dsl: daysSince(row.sso?.lastLoginAt ?? row.seat.lastLoginAt, now) ?? 999,
        }))
        .sort((a, b) => {
          if (a.offboarded !== b.offboarded) return a.offboarded ? -1 : 1;
          return b.dsl - a.dsl;
        })
        .slice(0, revocable);

      // Revoke the chosen seats.
      const ids = ranked.map((r) => r.id);
      if (ids.length > 0) {
        await db
          .update(seatAssignments)
          .set({
            status: "revoked",
            revokedAt: now,
            revokedReason: `Reclaimed by CFO dashboard (${payload.findingKind ?? "ghost_seats"})`,
          })
          .where(inArray(seatAssignments.id, ids));
      }
      seatsAffected = ids.length;
      monthlySavingsCents = seatsAffected * vendor.seatUnitCostCents;
      title = `Reclaimed ${seatsAffected} ${vendor.name} seat${seatsAffected === 1 ? "" : "s"}`;
      detail =
        `Revoked ${seatsAffected} licence${seatsAffected === 1 ? "" : "s"} (departed users / 60-day inactive accounts). ` +
        `Licence count ${vendor.seatsPaid} -> ${vendor.seatsPaid - seatsAffected}.`;
    } else {
      /* Paid-but-never-provisioned capacity: just remove the phantom seats. */
      seatsAffected = Math.min(requested, vendor.idleSeats > 0 ? vendor.idleSeats : requested);
      monthlySavingsCents = seatsAffected * vendor.seatUnitCostCents;
      title = `Downgraded ${vendor.name} by ${seatsAffected} unprovisioned seat${seatsAffected === 1 ? "" : "s"}`;
      detail = `Removed ${seatsAffected} paid seat(s) that never appeared in the licence register.`;
    }

    const nextSeats = Math.max(0, vendor.seatsPaid - seatsAffected);
    await db
      .update(vendors)
      .set({
        seatsPaid: nextSeats,
        idleSeats: isIdleReclaim ? Math.max(0, vendor.idleSeats - seatsAffected) : vendor.idleSeats,
        monthlyCostCents: nextSeats * vendor.seatUnitCostCents,
        notes: `${vendor.notes ?? ""} · ${seatsAffected} seat(s) reclaimed on ${now.toISOString().slice(0, 10)}`.trim(),
      })
      .where(eq(vendors.id, vendor.id));
  } else {
    /* cancel_subscription | consolidate — remove the whole line item from the estate */
    const group = await db
      .select()
      .from(vendors)
      .where(and(eq(vendors.categoryGroup, vendor.categoryGroup), eq(vendors.status, "active")));
    const mergeTarget = group
      .filter((v) => v.id !== vendor.id)
      .sort((a, b) => b.monthlyCostCents - a.monthlyCostCents)[0];

    seatsAffected = vendor.seatsPaid;
    monthlySavingsCents = vendor.monthlyCostCents;
    title =
      payload.actionType === "consolidate"
        ? `Consolidated ${vendor.name} into ${mergeTarget?.name ?? "the primary tool"}`
        : `Cancelled ${vendor.name}`;
    detail =
      payload.actionType === "consolidate"
        ? `${vendor.seatsPaid} seats migrated to ${mergeTarget?.name ?? "primary vendor"}; the $${(vendor.monthlyCostCents / 100).toFixed(2)}/month contract was terminated.`
        : `Zero-usage subscription terminated before renewal; ${vendor.seatsPaid} idle licence${vendor.seatsPaid === 1 ? "" : "s"} were revoked.`;

    await db
      .update(seatAssignments)
      .set({ status: "revoked", revokedAt: now, revokedReason: `${payload.actionType} on ${now.toISOString().slice(0, 10)}` })
      .where(and(eq(seatAssignments.vendorId, vendor.id), eq(seatAssignments.status, "active")));

    await db
      .update(vendors)
      .set({
        status: payload.actionType === "consolidate" ? "consolidated" : "cancelled",
        statusReason: mergeTarget
          ? `Consolidated into ${mergeTarget.name} by CFO dashboard`
          : "Cancelled via CFO dashboard",
        monthlyCostCents: 0,
      })
      .where(eq(vendors.id, vendor.id));
  }

  const [inserted] = await db
    .insert(optimizationActions)
    .values({
      vendorId: vendor.id,
      vendorName: vendor.name,
      actionType: payload.actionType,
      title,
      detail,
      seatsAffected,
      monthlySavingsCents,
      status: "applied",
      triggeredBy: "cfo@northwind.io",
      createdAt: now,
      payload: { findingKind: payload.findingKind ?? null, requestedSeats: payload.seats ?? null },
    })
    .returning();

  const snapshot = await getSnapshot();

  const action: AppliedActionDTO = {
    id: inserted.id,
    vendorId: inserted.vendorId,
    vendorName: inserted.vendorName,
    actionType: inserted.actionType as AppliedActionDTO["actionType"],
    title: inserted.title,
    detail: inserted.detail,
    seatsAffected: inserted.seatsAffected,
    monthlySavingsCents: inserted.monthlySavingsCents,
    annualizedSavingsCents: inserted.monthlySavingsCents * 12,
    triggeredBy: inserted.triggeredBy,
    createdAt: inserted.createdAt.toISOString(),
  };

  return {
    snapshot,
    action,
    message: `${title} · $${(monthlySavingsCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month recovered ($${((monthlySavingsCents * 12) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}/year).`,
  };
}

/** Raw, un-ingested mock payload — handy when explaining the pipeline to evaluators. */
export async function getRawSandboxPreview() {
  const dataset = buildSandboxDataset(new Date());
  return {
    statementSample: dataset.transactions.slice(0, 8),
    ssoSample: dataset.ssoEvents.slice(0, 8),
    counts: {
      employees: dataset.employees.length,
      vendors: dataset.vendors.length,
      seatAssignments: dataset.seats.length,
      ssoEvents: dataset.ssoEvents.length,
      transactions: dataset.transactions.length,
    },
    meta: dataset.meta,
  };
}
