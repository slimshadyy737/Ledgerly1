/**
 * ---------------------------------------------------------------------------
 * SANDBOX ENGINE — PART 1: the mock source systems
 * ---------------------------------------------------------------------------
 * Everything in this file replaces a live integration (Plaid, Ramp, Okta, HRIS).
 * For a college-grade prototype we simulate three raw exports:
 *
 *   A. HRIS roster            -> 80 employees (8 of whom have been offboarded)
 *   B. Corporate card / G/L   -> recurring SaaS charges for the last 6 months
 *   C. Google Workspace SSO   -> "app + employee + last_login_at" login telemetry
 *
 * A deterministic PRNG (mulberry32, seeded from the vendor key) is used so the
 * generated company looks identical on every run — important when demoing.
 */

export const COMPANY = {
  name: "Northwind Analytics",
  domain: "northwind.io",
  cfoEmail: "cfo@northwind.io",
  headcount: 80,
};

/* ------------------------------- PRNG utils ------------------------------- */

/** Deterministic 32-bit string hash (used to seed per-vendor randomness). */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, deterministic PRNG. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAY_MS = 86_400_000;

/* --------------------------- A. HRIS employee seed ------------------------- */

const ROSTER_NAMES = `Aarav Mehta, Priya Nair, Daniel Okafor, Sofia Almeida, Kenji Tanaka, Emily Carter, Rohan Iyer, Grace Sullivan, Tobias Krause, Hana Kim,
Lucas Ferreira, Amara Abiola, Nora Lindqvist, Diego Ramos, Yuki Nakamura, Chloe Bennett, Arjun Verma, Isabel Moreau, Peter Novak, Fatima Zahra,
Ethan Brooks, Ananya Rao, Marta Kowalski, Samuel Adeyemi, Lena Fischer, Rafael Costa, Mei Chen, Oliver Grant, Kirti Deshmukh, Jonas Weber,
Hannah Whitfield, Vikram Sethi, Camille Dubois, Noah Patterson, Aditi Sharma, Marcus Lindgren, Zara Ahmed, Felix Braun, Natalie Ortiz, Sanjay Kulkarni,
Beatrice Romano, Isaac Newton Jr., Pooja Bhatt, Anders Holm, Julia Novak, Kyle Fernandez, Riya Kapoor, Simon Leclerc, Tara Osei, Ben Mitchell,
Neha Joshi, Gabriel Santos, Astrid Larsen, Omar Haddad, Lucy Zhang, Devansh Gupta, Ines Barbosa, Theo Vermeulen, Maya Krishnan, Aaron Feld,
Sara Lindberg, Nikhil Chopra, Elena Petrova, Jack Reynolds, Deepika Menon, Louis Garnier, Rachel Kim, Mateo Silva, Anika Bose, Connor Walsh,
Simran Kaur, Victor Hugo Lima, Mia Johansson, Rahul Nambiar, Grace Osei, Erik Lindstrom, Tanvi Shah, Peter Kimani, Aisha Bello, Robert Chen`;

/** Department quotas sum to exactly 80 employees. */
const DEPARTMENT_QUOTAS: { department: string; count: number }[] = [
  { department: "Engineering", count: 28 },
  { department: "Sales", count: 12 },
  { department: "Marketing", count: 9 },
  { department: "Design", count: 7 },
  { department: "Product", count: 8 },
  { department: "Customer Success", count: 6 },
  { department: "Finance", count: 4 },
  { department: "People Ops", count: 3 },
  { department: "Operations", count: 3 },
];

const TITLES: Record<string, string[]> = {
  Engineering: ["Software Engineer II", "Senior Backend Engineer", "Staff Engineer", "Platform Engineer", "QA Engineer", "Engineering Manager", "Data Engineer", "SRE"],
  Sales: ["Account Executive", "Sales Development Rep", "Enterprise AE", "Sales Manager", "Solutions Engineer"],
  Marketing: ["Content Strategist", "Growth Marketer", "Demand Gen Lead", "Brand Designer", "Marketing Ops"],
  Design: ["Product Designer", "Senior Product Designer", "Design Lead", "UX Researcher"],
  Product: ["Product Manager", "Senior PM", "Group PM", "Technical PM"],
  "Customer Success": ["CSM", "Senior CSM", "Support Engineer", "Onboarding Specialist"],
  Finance: ["Financial Analyst", "Controller", "AP Specialist", "FP&A Manager"],
  "People Ops": ["People Partner", "Recruiter", "HR Generalist"],
  Operations: ["Business Ops Analyst", "IT Administrator", "Facilities Lead"],
};

/** Roster indices that have LEFT the company (their seats may still be billed). */
export const OFFBOARDED_ROSTER_INDEX = [7, 19, 33, 44, 52, 61, 66, 71];
/** How many days ago each of the above was offboarded. */
const OFFBOARDED_DAYS_AGO = [210, 168, 141, 121, 96, 74, 41, 18];

export interface RawEmployee {
  fullName: string;
  email: string;
  department: string;
  jobTitle: string;
  status: "active" | "offboarded";
  hiredAtOffsetDays: number;
  offboardedDaysAgo: number | null;
  isManager: boolean;
}

export function buildRawEmployees(): RawEmployee[] {
  const names = ROSTER_NAMES.split(",").map((n) => n.trim()).filter(Boolean);
  const departments: string[] = [];
  for (const quota of DEPARTMENT_QUOTAS) {
    for (let i = 0; i < quota.count; i += 1) departments.push(quota.department);
  }

  const usedEmails = new Set<string>();
  return names.slice(0, COMPANY.headcount).map((fullName, index) => {
    const department = departments[index] ?? "Operations";
    const titles = TITLES[department] ?? ["Analyst"];
    const slug = fullName
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(".");
    let email = `${slug}@${COMPANY.domain}`;
    let suffix = 2;
    while (usedEmails.has(email)) {
      email = `${slug}${suffix}@${COMPANY.domain}`;
      suffix += 1;
    }
    usedEmails.add(email);

    const offIndex = OFFBOARDED_ROSTER_INDEX.indexOf(index);
    const isManager = index % 9 === 0;

    return {
      fullName,
      email,
      department,
      jobTitle: isManager && index % 18 === 0 ? `${department} Manager` : titles[index % titles.length],
      status: offIndex >= 0 ? "offboarded" : "active",
      hiredAtOffsetDays: 120 + ((index * 47) % 1400),
      offboardedDaysAgo: offIndex >= 0 ? OFFBOARDED_DAYS_AGO[offIndex] : null,
      isManager,
    };
  });
}

/* ------------------------ B. Vendor / contract register -------------------- */

export interface VendorBlueprint {
  key: string;
  name: string;
  category: string;
  /** Normalised bucket used by the Overlap Detector */
  categoryGroup: string;
  billingModel: "per_seat" | "flat" | "usage";
  seatUnitCostCents: number;
  seatsPaid: number;
  idleSeats: number;
  flatMonthlyCents: number;
  /** Departments that typically hold a seat */
  channels: string[];
  ghostOffboarded: number;
  ghostStale: number;
  warmSeats: number;
  zombie: boolean;
  contractOwner: string;
  renewalInDays: number;
  logoEmoji: string;
  merchantDescriptor: string;
  cardLast4: string;
  notes: string;
}

/**
 * 27 live subscriptions. Numbers are hand-tuned so the detector produces a rich,
 * explainable set of findings (ghost seats, zombie tools, duplicate categories).
 */
export const VENDOR_BLUEPRINTS: VendorBlueprint[] = [
  {
    key: "slack", name: "Slack Business+", category: "Team Communication", categoryGroup: "Team Communication",
    billingModel: "per_seat", seatUnitCostCents: 875, seatsPaid: 78, idleSeats: 4, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Marketing", "Design", "Product", "Customer Success", "Finance", "People Ops", "Operations"],
    ghostOffboarded: 3, ghostStale: 0, warmSeats: 6, zombie: false, contractOwner: "people-ops@northwind.io",
    renewalInDays: 47, logoEmoji: "💬", merchantDescriptor: "SLACK *TECHNOLOGIES 415-555-0192 CA",
    cardLast4: "4401", notes: "Company-wide default comms tool. 4 seats appear unprovisioned.",
  },
  {
    key: "zoom", name: "Zoom Workplace Pro", category: "Video Conferencing", categoryGroup: "Video Conferencing",
    billingModel: "per_seat", seatUnitCostCents: 1500, seatsPaid: 72, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Marketing", "Design", "Product", "Customer Success", "Finance", "People Ops", "Operations"],
    ghostOffboarded: 8, ghostStale: 6, warmSeats: 10, zombie: false, contractOwner: "it-ops@northwind.io",
    renewalInDays: 12, logoEmoji: "🎥", merchantDescriptor: "ZOOM.US 888-799-9666 CA",
    cardLast4: "4401", notes: "Auto-renews in 12 days. Team moved most meetings into Google Meet.",
  },
  {
    key: "google-workspace", name: "Google Workspace Business Plus", category: "Productivity Suite", categoryGroup: "Productivity Suite",
    billingModel: "per_seat", seatUnitCostCents: 1200, seatsPaid: 80, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Marketing", "Design", "Product", "Customer Success", "Finance", "People Ops", "Operations"],
    ghostOffboarded: 2, ghostStale: 0, warmSeats: 4, zombie: false, contractOwner: "it-ops@northwind.io",
    renewalInDays: 84, logoEmoji: "🟢", merchantDescriptor: "GOOGLE *WORKSPACE GSUITE CA",
    cardLast4: "8821", notes: "IdP of record — every SSO login event in this dataset comes from here.",
  },
  {
    key: "figma", name: "Figma Organization", category: "Design & Prototyping", categoryGroup: "Design & Prototyping",
    billingModel: "per_seat", seatUnitCostCents: 1500, seatsPaid: 26, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Design", "Product", "Marketing", "Engineering"],
    ghostOffboarded: 1, ghostStale: 2, warmSeats: 3, zombie: false, contractOwner: "design-lead@northwind.io",
    renewalInDays: 63, logoEmoji: "🎨", merchantDescriptor: "FIGMA INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Core design tool — healthy adoption.",
  },
  {
    key: "sketch", name: "Sketch (legacy)", category: "Design & Prototyping", categoryGroup: "Design & Prototyping",
    billingModel: "per_seat", seatUnitCostCents: 1200, seatsPaid: 8, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Design", "Product", "Engineering"],
    ghostOffboarded: 1, ghostStale: 7, warmSeats: 0, zombie: true, contractOwner: "design-lead@northwind.io",
    renewalInDays: 9, logoEmoji: "💎", merchantDescriptor: "SKETCH B.V. AMSTERDAM NL",
    cardLast4: "4401", notes: "Superseded by Figma in Q2 — subscription was never cancelled.",
  },
  {
    key: "asana", name: "Asana Premium", category: "Project Management", categoryGroup: "Project Management",
    billingModel: "per_seat", seatUnitCostCents: 1349, seatsPaid: 44, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Marketing", "Customer Success", "Operations", "Product", "People Ops"],
    ghostOffboarded: 4, ghostStale: 1, warmSeats: 5, zombie: false, contractOwner: "bizops@northwind.io",
    renewalInDays: 31, logoEmoji: "📋", merchantDescriptor: "ASANA *SUBSCR SAN FRANCISCO CA",
    cardLast4: "8821", notes: "Marketing runs campaigns here; Eng standardised on Jira.",
  },
  {
    key: "monday", name: "Monday.com Pro", category: "Project Management", categoryGroup: "Project Management",
    billingModel: "per_seat", seatUnitCostCents: 1400, seatsPaid: 22, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Customer Success", "Operations", "Sales"],
    ghostOffboarded: 2, ghostStale: 3, warmSeats: 6, zombie: false, contractOwner: "bizops@northwind.io",
    renewalInDays: 26, logoEmoji: "🗂️", merchantDescriptor: "MONDAY.COM LTD TEL AVIV IL",
    cardLast4: "8821", notes: "Trialed by CS during Q1 restructure, never fully rolled out.",
  },
  {
    key: "jira", name: "Atlassian Jira + Confluence", category: "Project Management", categoryGroup: "Project Management",
    billingModel: "per_seat", seatUnitCostCents: 815, seatsPaid: 52, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Product", "Design", "Operations"],
    ghostOffboarded: 2, ghostStale: 0, warmSeats: 4, zombie: false, contractOwner: "eng-ops@northwind.io",
    renewalInDays: 118, logoEmoji: "🧭", merchantDescriptor: "ATLASSIAN CLOUD 800-986-0051",
    cardLast4: "4401", notes: "Primary engineering tracker and spec wiki.",
  },
  {
    key: "salesforce", name: "Salesforce Sales Cloud", category: "CRM - Sales", categoryGroup: "CRM",
    billingModel: "per_seat", seatUnitCostCents: 16500, seatsPaid: 14, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Sales", "Customer Success"],
    ghostOffboarded: 2, ghostStale: 1, warmSeats: 2, zombie: false, contractOwner: "revops@northwind.io",
    renewalInDays: 58, logoEmoji: "☁️", merchantDescriptor: "SALESFORCE.COM 415-901-7000",
    cardLast4: "8821", notes: "System of record for pipeline. Highest cost per seat in the estate.",
  },
  {
    key: "hubspot", name: "HubSpot Sales Hub Pro", category: "CRM - Sales", categoryGroup: "CRM",
    billingModel: "per_seat", seatUnitCostCents: 9000, seatsPaid: 9, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Marketing", "Sales", "Customer Success"],
    ghostOffboarded: 1, ghostStale: 2, warmSeats: 3, zombie: false, contractOwner: "marketing-ops@northwind.io",
    renewalInDays: 21, logoEmoji: "🧲", merchantDescriptor: "HUBSPOT INC DUBLIN IE",
    cardLast4: "8821", notes: "Marketing purchased for campaign attribution; Sales never adopted the Sales Hub seats.",
  },
  {
    key: "aws", name: "AWS (usage based)", category: "Cloud Infrastructure", categoryGroup: "Cloud Infrastructure",
    billingModel: "usage", seatUnitCostCents: 0, seatsPaid: 0, idleSeats: 0, flatMonthlyCents: 945000,
    channels: ["Engineering"], ghostOffboarded: 0, ghostStale: 0, warmSeats: 0, zombie: false,
    contractOwner: "eng-ops@northwind.io", renewalInDays: 365, logoEmoji: "☁️",
    merchantDescriptor: "AMAZON WEB SERVICES AWS.AMAZON.CO WA", cardLast4: "4401",
    notes: "Usage based — no seat telemetry, monitored for spend drift instead.",
  },
  {
    key: "datadog", name: "Datadog Pro", category: "Observability", categoryGroup: "Observability",
    billingModel: "usage", seatUnitCostCents: 0, seatsPaid: 0, idleSeats: 0, flatMonthlyCents: 218000,
    channels: ["Engineering"], ghostOffboarded: 0, ghostStale: 0, warmSeats: 0, zombie: false,
    contractOwner: "eng-ops@northwind.io", renewalInDays: 96, logoEmoji: "📈",
    merchantDescriptor: "DATADOG INC NEW YORK NY", cardLast4: "4401",
    notes: "Host-based pricing (23 hosts @ $23).",
  },
  {
    key: "mixpanel", name: "Mixpanel Growth", category: "Product Analytics", categoryGroup: "Product Analytics",
    billingModel: "per_seat", seatUnitCostCents: 2800, seatsPaid: 12, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Product", "Engineering", "Marketing"],
    ghostOffboarded: 1, ghostStale: 2, warmSeats: 2, zombie: false, contractOwner: "product-lead@northwind.io",
    renewalInDays: 74, logoEmoji: "🔍", merchantDescriptor: "MIXPANEL INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Charting still references Mixpanel — do not cancel before migration.",
  },
  {
    key: "amplitude", name: "Amplitude Growth", category: "Product Analytics", categoryGroup: "Product Analytics",
    billingModel: "per_seat", seatUnitCostCents: 6100, seatsPaid: 9, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Product", "Marketing", "Engineering"],
    ghostOffboarded: 1, ghostStale: 8, warmSeats: 0, zombie: true, contractOwner: "product-lead@northwind.io",
    renewalInDays: 5, logoEmoji: "📉", merchantDescriptor: "AMPLITUDE INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Paid renewal in 5 days. Zero SSO logins in the last 30 days.",
  },
  {
    key: "onepassword", name: "1Password Business", category: "Password & Secrets", categoryGroup: "Password & Secrets",
    billingModel: "per_seat", seatUnitCostCents: 799, seatsPaid: 80, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Marketing", "Design", "Product", "Customer Success", "Finance", "People Ops", "Operations"],
    ghostOffboarded: 2, ghostStale: 0, warmSeats: 4, zombie: false, contractOwner: "security@northwind.io",
    renewalInDays: 132, logoEmoji: "🔐", merchantDescriptor: "1PASSWORD TORONTO ON",
    cardLast4: "4401", notes: "Security-mandated for all staff. Migration target for LastPass.",
  },
  {
    key: "lastpass", name: "LastPass Teams", category: "Password & Secrets", categoryGroup: "Password & Secrets",
    billingModel: "per_seat", seatUnitCostCents: 600, seatsPaid: 30, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Operations", "People Ops"],
    ghostOffboarded: 3, ghostStale: 27, warmSeats: 0, zombie: true, contractOwner: "security@northwind.io",
    renewalInDays: 17, logoEmoji: "🧱", merchantDescriptor: "LASTPASS.COM FAIRFAX VA",
    cardLast4: "4401", notes: "Duplicate of 1Password. Vaults migrated, licence still billing.",
  },
  {
    key: "zendesk", name: "Zendesk Suite Growth", category: "Customer Support", categoryGroup: "Customer Support",
    billingModel: "per_seat", seatUnitCostCents: 5500, seatsPaid: 12, idleSeats: 2, flatMonthlyCents: 0,
    channels: ["Customer Success", "Operations"],
    ghostOffboarded: 1, ghostStale: 1, warmSeats: 3, zombie: false, contractOwner: "cs-lead@northwind.io",
    renewalInDays: 39, logoEmoji: "🎧", merchantDescriptor: "ZENDESK INC SAN FRANCISCO CA",
    cardLast4: "8821", notes: "Primary ticketing system. 2 paid agent seats never provisioned.",
  },
  {
    key: "intercom", name: "Intercom Advanced", category: "Customer Support", categoryGroup: "Customer Support",
    billingModel: "per_seat", seatUnitCostCents: 7400, seatsPaid: 6, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Customer Success", "Sales"],
    ghostOffboarded: 1, ghostStale: 2, warmSeats: 3, zombie: false, contractOwner: "cs-lead@northwind.io",
    renewalInDays: 14, logoEmoji: "💬", merchantDescriptor: "INTERCOM INC SAN FRANCISCO CA",
    cardLast4: "8821", notes: "Purchased for live chat pilot; tickets consolidated into Zendesk in Q3.",
  },
  {
    key: "loom", name: "Loom Business", category: "Async Video", categoryGroup: "Async Video",
    billingModel: "per_seat", seatUnitCostCents: 1250, seatsPaid: 18, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Sales", "Marketing", "Product", "Customer Success"],
    ghostOffboarded: 2, ghostStale: 2, warmSeats: 5, zombie: false, contractOwner: "marketing-ops@northwind.io",
    renewalInDays: 68, logoEmoji: "🎬", merchantDescriptor: "LOOM INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Adoption concentrated in Sales enablement.",
  },
  {
    key: "notion", name: "Notion Plus", category: "Docs & Knowledge", categoryGroup: "Docs & Knowledge",
    billingModel: "per_seat", seatUnitCostCents: 1000, seatsPaid: 64, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Product", "Design", "Marketing", "People Ops", "Operations", "Sales", "Engineering"],
    ghostOffboarded: 3, ghostStale: 1, warmSeats: 6, zombie: false, contractOwner: "product-lead@northwind.io",
    renewalInDays: 52, logoEmoji: "📓", merchantDescriptor: "NOTION LABS INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Second brain for product + design. Consider bundling with Confluence review.",
  },
  {
    key: "github", name: "GitHub Enterprise", category: "Developer Tools", categoryGroup: "Developer Tools",
    billingModel: "per_seat", seatUnitCostCents: 2100, seatsPaid: 58, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Product", "Design"],
    ghostOffboarded: 2, ghostStale: 0, warmSeats: 3, zombie: false, contractOwner: "eng-ops@northwind.io",
    renewalInDays: 143, logoEmoji: "🐙", merchantDescriptor: "GITHUB INC 415-735-4488 CA",
    cardLast4: "4401", notes: "High utilisation — engineering core dependency.",
  },
  {
    key: "sentry", name: "Sentry Team", category: "Error & Uptime Monitoring", categoryGroup: "Error Monitoring",
    billingModel: "per_seat", seatUnitCostCents: 2600, seatsPaid: 30, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering"],
    ghostOffboarded: 1, ghostStale: 1, warmSeats: 4, zombie: false, contractOwner: "eng-ops@northwind.io",
    renewalInDays: 88, logoEmoji: "🛡️", merchantDescriptor: "FUNCTIONAL SOFTWARE SENTRY. CA",
    cardLast4: "4401", notes: "Error monitoring for platform services.",
  },
  {
    key: "bamboohr", name: "BambooHR", category: "HR & People", categoryGroup: "HR & People",
    billingModel: "per_seat", seatUnitCostCents: 800, seatsPaid: 80, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Engineering", "Sales", "Marketing", "Design", "Product", "Customer Success", "Finance", "People Ops", "Operations"],
    ghostOffboarded: 1, ghostStale: 0, warmSeats: 2, zombie: false, contractOwner: "people-ops@northwind.io",
    renewalInDays: 105, logoEmoji: "🌴", merchantDescriptor: "BAMBOOHR LLC LINDON UT",
    cardLast4: "8821", notes: "HRIS of record (roster + termination dates come from here).",
  },
  {
    key: "mailchimp", name: "Mailchimp Standard", category: "Email Marketing", categoryGroup: "Email Marketing",
    billingModel: "flat", seatUnitCostCents: 0, seatsPaid: 0, idleSeats: 0, flatMonthlyCents: 35000,
    channels: ["Marketing"], ghostOffboarded: 0, ghostStale: 0, warmSeats: 0, zombie: false,
    contractOwner: "marketing-ops@northwind.io", renewalInDays: 23, logoEmoji: "📨",
    merchantDescriptor: "MAILCHIMP *MONTHLY ATL GA", cardLast4: "8821",
    notes: "Flat-rate plan based on contact count (24,500 contacts).",
  },
  {
    key: "airtable", name: "Airtable Team", category: "No-Code Database", categoryGroup: "No-Code Database",
    billingModel: "per_seat", seatUnitCostCents: 2400, seatsPaid: 10, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Operations", "Marketing", "People Ops", "Finance"],
    ghostOffboarded: 2, ghostStale: 2, warmSeats: 2, zombie: false, contractOwner: "bizops@northwind.io",
    renewalInDays: 44, logoEmoji: "🧱", merchantDescriptor: "AIRTABLE INC SAN FRANCISCO CA",
    cardLast4: "8821", notes: "Ops workflows and vendor tracker base.",
  },
  {
    key: "miro", name: "Miro Business", category: "Whiteboarding", categoryGroup: "Whiteboarding",
    billingModel: "per_seat", seatUnitCostCents: 800, seatsPaid: 40, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Product", "Design", "Engineering", "Marketing", "Operations"],
    ghostOffboarded: 3, ghostStale: 3, warmSeats: 8, zombie: false, contractOwner: "product-lead@northwind.io",
    renewalInDays: 61, logoEmoji: "🖼️", merchantDescriptor: "MIRO.COM INC SAN FRANCISCO CA",
    cardLast4: "4401", notes: "Workshop tooling. 3 seats still attached to offboarded accounts.",
  },
  {
    key: "dropbox", name: "Dropbox Business", category: "Cloud Storage", categoryGroup: "Cloud Storage",
    billingModel: "per_seat", seatUnitCostCents: 1199, seatsPaid: 24, idleSeats: 0, flatMonthlyCents: 0,
    channels: ["Marketing", "Sales", "Operations", "Finance"],
    ghostOffboarded: 4, ghostStale: 1, warmSeats: 4, zombie: false, contractOwner: "it-ops@northwind.io",
    renewalInDays: 29, logoEmoji: "📦", merchantDescriptor: "DROPBOX *BUSINESS DBN CA",
    cardLast4: "8821", notes: "Overlaps with Google Workspace Drive shared drives (unlimited storage).",
  },
];

/* ------------------------- C. Shadow-IT SSO apps --------------------------- */

/** Apps visible in the IdP that have NO matching corporate-card transaction. */
export const SHADOW_IT_APPS = [
  { appName: "ChatGPT Team", users: 18, daysSinceLogin: 2, note: "Employee-expensed AI assistant — no vendor contract on file." },
  { appName: "Notion AI", users: 7, daysSinceLogin: 9, note: "Add-on billed to a personal card, visible via SSO." },
  { appName: "Calendly", users: 11, daysSinceLogin: 4, note: "Free tier in use, no charge yet — monitor for paywall." },
  { appName: "Zapier", users: 5, daysSinceLogin: 21, note: "Ops automation via SSO app; invoice never ingested." },
];

export const DETECTION_RULES = [
  {
    name: "Ghost Seat Detector",
    rule: "Billed seat where the holder is offboarded OR sso.last_login_at is older than 60 days",
    threshold: "inactivity > 60 days or employment status = offboarded",
    severity: "high" as const,
  },
  {
    name: "Zombie Software Detector",
    rule: "Zero logins across every assigned seat for 30+ days while the card is still being charged",
    threshold: "max(logins_last_30d) = 0 AND min(seat age) >= 30 days",
    severity: "critical" as const,
  },
  {
    name: "Overlap Duplication Detector",
    rule: "Two or more active subscriptions share a normalised category group where the secondary tool has lower adoption",
    threshold: ">= 2 vendors in one category group, secondary monthly cost >= $100",
    severity: "medium" as const,
  },
  {
    name: "Idle Seat Detector",
    rule: "Paid seats that were never provisioned to an employee in the licence register",
    threshold: "seats_paid - active assignments > 0",
    severity: "medium" as const,
  },
  {
    name: "Shadow IT Detector",
    rule: "SSO app with real logins but no matching transaction in the accounting statement",
    threshold: "sso app exists AND no vendor row matched via descriptor fuzzy-match",
    severity: "low" as const,
  },
];
