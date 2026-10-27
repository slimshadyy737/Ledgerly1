"use client";

/**
 * MetricCard — a KPI module: value, optional period comparison, contextual
 * label, trend sparkline and an explanation tooltip. Savings cards can be
 * visually emphasised without making every metric compete.
 */
import type { ReactNode } from "react";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { Card, InfoHint, ProgressBar, Sparkline, type BadgeTone } from "./ui";

export function MetricCard({
  label,
  value,
  unit,
  explanation,
  caption,
  comparison,
  trend,
  trendTone = "brand",
  progress,
  emphasis,
  footer,
}: {
  label: string;
  value: string;
  unit?: string;
  explanation: string;
  caption?: string;
  /** Only pass a comparison when the sandbox actually supports one. */
  comparison?: { value: string; direction: "up" | "down" | "flat"; favourable: boolean; label: string } | null;
  trend?: number[];
  trendTone?: BadgeTone;
  progress?: { value: number; tone?: BadgeTone; label: string };
  emphasis?: boolean;
  footer?: ReactNode;
}) {
  return (
    <Card
      className={`relative overflow-hidden p-3.5 transition-colors hover:border-line-strong ${
        emphasis ? "bg-[color-mix(in_oklab,var(--brand)_5%,var(--surface))]" : ""
      }`}
    >
      {emphasis && <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: "var(--brand)" }} />}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="label-xs">{label}</p>
          <InfoHint>
            <span className="block font-semibold text-ink">{label}</span>
            {explanation}
          </InfoHint>
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} tone={trendTone} />}
      </div>

      <p className={`num mt-2 text-[26px] font-semibold leading-none tracking-tight ${emphasis ? "text-brand" : "text-ink"}`}>
        {value}
        {unit && <span className="ml-1 text-[13px] font-medium text-ink-3">{unit}</span>}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {comparison ? (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium ${
              comparison.favourable ? "text-brand" : "text-crit"
            }`}
          >
            {comparison.direction === "up" ? (
              <TrendingUp size={12} strokeWidth={2.2} />
            ) : comparison.direction === "down" ? (
              <TrendingDown size={12} strokeWidth={2.2} />
            ) : (
              <Activity size={12} strokeWidth={2.2} />
            )}
            {comparison.value}
            <span className="font-normal text-ink-3">{comparison.label}</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-3">No prior period available in sandbox data</span>
        )}
      </div>

      {caption && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{caption}</p>}

      {progress && (
        <div className="mt-2.5">
          <ProgressBar value={progress.value} tone={progress.tone ?? "brand"} label={progress.label} height={4} />
        </div>
      )}
      {footer && <div className="mt-2.5">{footer}</div>}
    </Card>
  );
}
