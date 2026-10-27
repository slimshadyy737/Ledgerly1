/**
 * seedData.js — the simulated source systems for the Spend API.
 *
 * In production these rows arrive from four integrations:
 *   • HRIS      (BambooHR/Workday)      -> users
 *   • Contracts (vendor admin consoles) -> subscriptions
 *   • SSO/IdP   (Google Workspace/Okta) -> seat_mappings.last_login_at
 *   • Card/G/L  (Plaid/Ramp)            -> subscriptions.recurring_cost_cents
 *
 * Here they are generated locally from a small deterministic PRNG so the demo
 * company ("Northwind Analytics", 80 employees, 21 vendors) looks identical on
 * every run. Change SEED to reshuffle the story.
 */
"use strict";

const SEED = 20260101;
const DAY_MS = 86_400_000;

/** mulberry32 — tiny deterministic PRNG. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-key score used to order employees inside a vendor. */
function scoreFor(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1_000_000;
}

const COMPANY = {
  name: "Northwind Analytics",
  domain: "northwind.io",
  // Detector windows, stored per-tenant (mirrors companies.stale_license_days).
  staleLicenseDays: 60,
  activeSeatDays: 30,
};

const FIRST_NAMES = ["Aarav", "Priya", "Daniel", "Sofia", "Kenji", "Emily", "Rohan", "Grace", "Tobias", "Hana", "Lucas", "Amara", "Nora", "Diego", "Yuki", "Chloe", "Arjun", "Isabel", "Peter", "Fatima"];
const LAST_NAMES = ["Mehta", "Nair", "Okafor", "Almeida", "Tanaka", "Carter", "Iyer", "Sullivan", "Krause", "Kim", "Ferreira", "Abiola", "Lindqvist", "Ramos", "Nakamura", "Bennett", "Verma", "Moreau", "Novak", "Zahra"];

const DEPARTMENTS = [
  { name: "Engineering", size: 28, titles: ["Software Engineer II", "Senior Backend Engineer", "Staff Engineer", "Platform Engineer", "SRE", "Engineering Manager"] },
  { name: "Sales", size: 12, titles: ["Account Executive", "Sales Development Rep", "Enterprise AE", "Solutions Engineer"] },
  { name: "Marketing", size: 9, titles: ["Content Strategist", "Growth Marketer", "Demand Gen Lead", "Marketing Ops"] },
  { name: "Design", size: 7, titles: ["Product Designer", "Senior Product Designer", "Design Lead"] },
  { name: "Product", size: 8, titles: ["Product Manager", "Senior PM", "Group PM"] },
  { name: "Customer Success", size: 6, titles: ["CSM", "Senior CSM", "Support Engineer"] },
  { name: "Finance", size: 4, titles: ["Financial Analyst", "Controller", "AP Specialist"] },
  { name: "People Ops", size: 3, titles: ["People Partner", "Recruiter", "HR Generalist"] },
  { name: "Operations", size: 3, titles: ["Business Ops Analyst", "IT Administrator", "Facilities Lead"] },
];

/**
 * Contract register. `seats`, `unitCents`, `flatCents` mirror the real invoices.
 * `channels` = departments that hold a seat; ghost knobs force the detector to
 * produce a believable set of findings.
 *
 * categoryGroup is the *normalised* bucket used by the duplicate-category
 * detector — several display categories can share one bucket (e.g. Dropbox and
 * Google Workspace both live under "Productivity & Storage").
 */
const VENDORS = [
  { vendor: "Slack", product: "Business+", category: "Team Communication", group: "Team Communication", billing: "per_seat", seats: 78, unitCents: 875, channels: "ALL", idle: 4, ghostTerminated: 3, ghostStale: 0, cold: 4, owner: "people-ops@northwind.io", renewalInDays: 47 },
  { vendor: "Zoom", product: "Workplace Pro", category: "Video Conferencing", group: "Video Conferencing", billing: "per_seat", seats: 72, unitCents: 1500, channels: "ALL", idle: 0, ghostTerminated: 8, ghostStale: 6, cold: 6, owner: "it-ops@northwind.io", renewalInDays: 12 },
  { vendor: "Google Workspace", product: "Business Plus", category: "Productivity Suite", group: "Productivity & Storage", billing: "per_seat", seats: 80, unitCents: 1200, channels: "ALL", idle: 0, ghostTerminated: 2, ghostStale: 0, cold: 3, owner: "it-ops@northwind.io", renewalInDays: 84 },
  { vendor: "Dropbox", product: "Business", category: "Cloud Storage", group: "Productivity & Storage", billing: "per_seat", seats: 24, unitCents: 1199, channels: ["Marketing", "Sales", "Operations", "Finance"], idle: 0, ghostTerminated: 4, ghostStale: 1, cold: 3, owner: "it-ops@northwind.io", renewalInDays: 29 },
  { vendor: "Figma", product: "Organization", category: "Design & Prototyping", group: "Design & Prototyping", billing: "per_seat", seats: 26, unitCents: 1500, channels: ["Design", "Product", "Marketing", "Engineering"], idle: 0, ghostTerminated: 1, ghostStale: 2, cold: 2, owner: "design-lead@northwind.io", renewalInDays: 63 },
  { vendor: "Sketch", product: "Legacy licence", category: "Design (legacy)", group: "Design & Prototyping", billing: "per_seat", seats: 8, unitCents: 1200, channels: ["Design", "Product", "Engineering"], idle: 0, ghostTerminated: 1, ghostStale: 7, cold: 0, owner: "design-lead@northwind.io", renewalInDays: 9, zombie: true },
  { vendor: "Asana", product: "Premium", category: "Project Management", group: "Project Management", billing: "per_seat", seats: 44, unitCents: 1349, channels: ["Marketing", "Customer Success", "Operations", "Product", "People Ops"], idle: 0, ghostTerminated: 4, ghostStale: 1, cold: 4, owner: "bizops@northwind.io", renewalInDays: 31 },
  { vendor: "Monday.com", product: "Pro", category: "Project Management", group: "Project Management", billing: "per_seat", seats: 22, unitCents: 1400, channels: ["Customer Success", "Operations", "Sales"], idle: 0, ghostTerminated: 2, ghostStale: 3, cold: 5, owner: "bizops@northwind.io", renewalInDays: 26 },
  { vendor: "Atlassian", product: "Jira + Confluence", category: "Issue Tracking", group: "Project Management", billing: "per_seat", seats: 52, unitCents: 815, channels: ["Engineering", "Product", "Design", "Operations"], idle: 0, ghostTerminated: 2, ghostStale: 0, cold: 3, owner: "eng-ops@northwind.io", renewalInDays: 118 },
  { vendor: "Salesforce", product: "Sales Cloud", category: "CRM", group: "CRM", billing: "per_seat", seats: 14, unitCents: 16500, channels: ["Sales", "Customer Success"], idle: 0, ghostTerminated: 2, ghostStale: 1, cold: 2, owner: "revops@northwind.io", renewalInDays: 58 },
  { vendor: "HubSpot", product: "Sales Hub Pro", category: "CRM (marketing)", group: "CRM", billing: "per_seat", seats: 9, unitCents: 9000, channels: ["Marketing", "Sales", "Customer Success"], idle: 0, ghostTerminated: 1, ghostStale: 2, cold: 3, owner: "marketing-ops@northwind.io", renewalInDays: 21 },
  { vendor: "AWS", product: "EC2 + S3", category: "Cloud Infrastructure", group: "Cloud Infrastructure", billing: "usage", seats: 0, unitCents: 0, flatCents: 945_000, channels: ["Engineering"], idle: 0, ghostTerminated: 0, ghostStale: 0, cold: 0, owner: "eng-ops@northwind.io", renewalInDays: 365 },
  { vendor: "Datadog", product: "Pro (23 hosts)", category: "Observability", group: "Observability", billing: "usage", seats: 0, unitCents: 0, flatCents: 218_000, channels: ["Engineering"], idle: 0, ghostTerminated: 0, ghostStale: 0, cold: 0, owner: "eng-ops@northwind.io", renewalInDays: 96 },
  { vendor: "Sentry", product: "Team", category: "Error Monitoring", group: "Observability", billing: "per_seat", seats: 30, unitCents: 2600, channels: ["Engineering"], idle: 0, ghostTerminated: 1, ghostStale: 1, cold: 4, owner: "eng-ops@northwind.io", renewalInDays: 88 },
  { vendor: "Mixpanel", product: "Growth", category: "Product Analytics", group: "Product Analytics", billing: "per_seat", seats: 12, unitCents: 2800, channels: ["Product", "Engineering", "Marketing"], idle: 0, ghostTerminated: 1, ghostStale: 2, cold: 2, owner: "product-lead@northwind.io", renewalInDays: 74 },
  { vendor: "Amplitude", product: "Growth", category: "Product Analytics", group: "Product Analytics", billing: "per_seat", seats: 9, unitCents: 6100, channels: ["Product", "Marketing", "Engineering"], idle: 0, ghostTerminated: 1, ghostStale: 8, cold: 0, owner: "product-lead@northwind.io", renewalInDays: 5, zombie: true },
  { vendor: "1Password", product: "Business", category: "Password Manager", group: "Password & Secrets", billing: "per_seat", seats: 80, unitCents: 799, channels: "ALL", idle: 0, ghostTerminated: 2, ghostStale: 0, cold: 3, owner: "security@northwind.io", renewalInDays: 132 },
  { vendor: "LastPass", product: "Teams", category: "Password Manager (legacy)", group: "Password & Secrets", billing: "per_seat", seats: 30, unitCents: 600, channels: ["Engineering", "Sales", "Operations", "People Ops"], idle: 0, ghostTerminated: 3, ghostStale: 27, cold: 0, owner: "security@northwind.io", renewalInDays: 17, zombie: true },
  { vendor: "Zendesk", product: "Suite Growth", category: "Customer Support", group: "Customer Support", billing: "per_seat", seats: 12, unitCents: 5500, channels: ["Customer Success", "Operations"], idle: 2, ghostTerminated: 1, ghostStale: 1, cold: 2, owner: "cs-lead@northwind.io", renewalInDays: 39 },
  { vendor: "Intercom", product: "Advanced", category: "Live Chat", group: "Customer Support", billing: "per_seat", seats: 6, unitCents: 7400, channels: ["Customer Success", "Sales"], idle: 0, ghostTerminated: 1, ghostStale: 2, cold: 2, owner: "cs-lead@northwind.io", renewalInDays: 14 },
  { vendor: "Mailchimp", product: "Standard (24.5k contacts)", category: "Email Marketing", group: "Email Marketing", billing: "flat", seats: 0, unitCents: 0, flatCents: 35_000, channels: ["Marketing"], idle: 0, ghostTerminated: 0, ghostStale: 0, cold: 0, owner: "marketing-ops@northwind.io", renewalInDays: 23 },
];

/** Employees who have left the company (index -> days since offboarding). */
const TERMINATED = [7, 19, 33, 44, 52, 61, 66, 71];

/** Builds the 80-person roster with deterministic names/emails. */
function buildUsers(now) {
  const rng = makeRng(SEED);
  const users = [];
  const usedEmails = new Set();
  let candidateIndex = 0;

  for (const department of DEPARTMENTS) {
    for (let i = 0; i < department.size; i += 1) {
      const first = FIRST_NAMES[candidateIndex % FIRST_NAMES.length];
      const last = LAST_NAMES[(candidateIndex * 7 + 3) % LAST_NAMES.length];
      const slugBase = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
      let email = `${slugBase}@${COMPANY.domain}`;
      let suffix = 2;
      while (usedEmails.has(email)) {
        email = `${slugBase}${suffix}@${COMPANY.domain}`;
        suffix += 1;
      }
      usedEmails.add(email);

      const terminatedIndex = TERMINATED.indexOf(candidateIndex);
      const terminated = terminatedIndex >= 0;
      const terminatedDaysAgo = terminated ? [210, 168, 141, 121, 96, 74, 41, 18][terminatedIndex] : 0;

      users.push({
        fullName: `${first} ${last}`,
        email,
        department: department.name,
        jobTitle: department.titles[Math.floor(rng() * department.titles.length) % department.titles.length],
        status: terminated ? "terminated" : "active",
        hiredAt: new Date(now.getTime() - (120 + Math.floor(rng() * 1_400)) * DAY_MS),
        terminatedAt: terminated ? new Date(now.getTime() - terminatedDaysAgo * DAY_MS) : null,
        terminatedDaysAgo,
      });
      candidateIndex += 1;
    }
  }
  return users;
}

/**
 * Builds seat_mappings for every per-seat vendor:
 *   ghost (held by a leaver) -> stale (60+ days idle) -> cold (30-59) -> healthy.
 * Zombie vendors get no healthy seats at all, by construction.
 */
function buildSeats(now, users, vendors) {
  const seats = [];
  const activeUsers = users.filter((user) => user.status === "active");
  const leavers = users.filter((user) => user.status === "terminated").sort((a, b) => b.terminatedDaysAgo - a.terminatedDaysAgo);
  let leaverCursor = 0;

  vendors.forEach((vendor, vendorIndex) => {
    if (vendor.billing !== "per_seat" || vendor.seats === 0) return;
    const rng = makeRng(SEED + vendorIndex * 7_919);
    const assignable = vendor.seats - vendor.idle;

    const inChannel = vendor.channels === "ALL"
      ? activeUsers
      : activeUsers.filter((user) => vendor.channels.includes(user.department));
    const outOfChannel = activeUsers.filter((user) => !inChannel.includes(user));
    const pool = [
      ...inChannel.sort((a, b) => scoreFor(`${vendor.vendor}:${a.email}`) - scoreFor(`${vendor.vendor}:${b.email}`)),
      ...outOfChannel.sort((a, b) => scoreFor(`${vendor.vendor}:${a.email}`) - scoreFor(`${vendor.vendor}:${b.email}`)),
    ];

    // A user can hold at most ONE seat per subscription (seat_mappings has a
    // unique (subscription_id, user_id) constraint). Some vendors sell more
    // seats than we have staff; those extra seats stay unassigned, which the
    // analytics layer reports as "idle / never provisioned" capacity.
    const usedEmails = new Set();
    let poolCursor = 0;
    const takeActive = () => {
      while (poolCursor < pool.length) {
        const candidate = pool[poolCursor];
        poolCursor += 1;
        if (!usedEmails.has(candidate.email)) {
          usedEmails.add(candidate.email);
          return candidate;
        }
      }
      return null; // pool exhausted -> leave the remaining paid seats unassigned
    };

    const plan = [];
    for (let i = 0; i < vendor.ghostTerminated; i += 1) plan.push("ghost_terminated");
    for (let i = 0; i < vendor.ghostStale && plan.length < assignable; i += 1) plan.push("ghost_stale");
    if (!vendor.zombie) {
      for (let i = 0; i < vendor.cold && plan.length < assignable; i += 1) plan.push("cold");
    }
    while (plan.length < assignable) plan.push(vendor.zombie ? "ghost_stale" : "healthy");

    plan.slice(0, assignable).forEach((kind) => {
      let user;
      let lastLoginAt;
      let loginsLast30d;

      if (kind === "ghost_terminated") {
        user = leavers[leaverCursor % leavers.length];
        leaverCursor += 1;
        // Guard against two vendors drawing the same leaver twice in one plan.
        if (usedEmails.has(user.email)) user = takeActive();
        usedEmails.add(user?.email);
        if (!user) return;
        // One final login shortly before the leaver's last day, then silence.
        lastLoginAt = new Date(now.getTime() - (user.terminatedDaysAgo + 2) * DAY_MS);
        loginsLast30d = 0;
      } else if (kind === "ghost_stale") {
        user = takeActive();
        if (!user) return;
        lastLoginAt = new Date(now.getTime() - (61 + Math.floor(rng() * 95)) * DAY_MS);
        loginsLast30d = 0;
      } else if (kind === "cold") {
        user = takeActive();
        if (!user) return;
        lastLoginAt = new Date(now.getTime() - (31 + Math.floor(rng() * 28)) * DAY_MS);
        loginsLast30d = rng() > 0.6 ? 1 : 0;
      } else {
        user = takeActive();
        if (!user) return;
        lastLoginAt = new Date(now.getTime() - Math.floor(rng() * 21) * DAY_MS);
        loginsLast30d = 4 + Math.floor(rng() * 24);
      }

      seats.push({
        vendorName: vendor.vendor,
        userEmail: user.email,
        seatCostCents: vendor.unitCents,
        lastLoginAt,
        loginsLast30d,
        assignedAt: new Date(now.getTime() - (30 + Math.floor(rng() * 400)) * DAY_MS),
      });
    });
  });

  return seats;
}

/**
 * Materialises the whole simulated company for a given instant.
 * @param {Date} [now]
 */
function buildSeedDataset(now = new Date()) {
  const users = buildUsers(now);
  const seats = buildSeats(now, users, VENDORS);

  const subscriptions = VENDORS.map((vendor) => {
    const recurringCostCents =
      vendor.billing === "per_seat" ? vendor.seats * vendor.unitCents : vendor.flatCents;
    return {
      vendorName: vendor.vendor,
      productName: vendor.product,
      category: vendor.category,
      categoryGroup: vendor.group,
      billingModel: vendor.billing,
      seatsPaid: vendor.seats,
      unitCostCents: vendor.unitCents,
      recurringCostCents,
      status: "active",
      contractOwnerEmail: vendor.owner,
      nextRenewalAt: new Date(now.getTime() + vendor.renewalInDays * DAY_MS),
      startedAt: new Date(now.getTime() - (200 + (vendor.renewalInDays % 90) * 4) * DAY_MS),
      notes: vendor.zombie
        ? "No SSO activity in 30+ days — billing still active. Candidate for cancellation."
        : null,
    };
  });

  return { company: COMPANY, users, subscriptions, seats };
}

module.exports = { buildSeedDataset, COMPANY, VENDORS, DEPARTMENTS };
