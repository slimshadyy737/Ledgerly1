/** Presentation helpers shared by every dashboard component. */

export function usd(cents: number, decimals = false): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

export function usdExact(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** $26,793 -> "$26.8k" for compact KPI captions. */
export function usdCompact(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeDays(days: number | null): string {
  if (days === null) return "never";
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 45) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${(days / 365).toFixed(1)} yr ago`;
}

export function severityStyle(severity: "critical" | "high" | "medium" | "low") {
  switch (severity) {
    case "critical":
      return {
        chip: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
        dot: "bg-rose-400",
        bar: "bg-rose-400",
        border: "border-l-rose-400/70",
      };
    case "high":
      return {
        chip: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
        dot: "bg-amber-400",
        bar: "bg-amber-400",
        border: "border-l-amber-400/70",
      };
    case "medium":
      return {
        chip: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
        dot: "bg-sky-400",
        bar: "bg-sky-400",
        border: "border-l-sky-400/70",
      };
    default:
      return {
        chip: "bg-slate-500/15 text-slate-300 ring-slate-400/30",
        dot: "bg-slate-400",
        bar: "bg-slate-400",
        border: "border-l-slate-500/60",
      };
  }
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "ghost_seats":
      return "Ghost Seats";
    case "zombie_software":
      return "Zombie Software";
    case "overlap_duplication":
      return "Overlap Duplication";
    case "idle_seats":
      return "Idle Seats";
    case "shadow_it":
      return "Shadow IT";
    default:
      return kind;
  }
}

export const CATEGORY_COLORS = [
  "#34d399",
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#fb7185",
  "#4ade80",
  "#38bdf8",
  "#c084fc",
];

export function healthColor(score: number): string {
  if (score >= 85) return "#34d399";
  if (score >= 70) return "#a3e635";
  if (score >= 55) return "#fbbf24";
  if (score >= 40) return "#fb923c";
  return "#fb7185";
}
