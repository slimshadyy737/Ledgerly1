"use client";

/**
 * Ledgerly charts (Recharts) — always driven by sandbox values, never by
 * decorative constants. Colours come from the active theme's token palette so
 * both light and dark modes stay legible.
 */
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartPalette } from "@/lib/ledgerly/theme";
import type { TrendPoint } from "@/lib/ledgerly/derive";
import { formatCompactUsd, Skeleton } from "./ui";

/** Recharts needs a measured container, so we mount charts after hydration. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function ChartFrame({
  height = 260,
  children,
  ariaLabel,
}: {
  height?: number;
  children: (palette: ReturnType<typeof useChartPalette>) => React.ReactElement;
  ariaLabel: string;
}) {
  const palette = useChartPalette();
  const mounted = useMounted();
  if (!mounted) return <Skeleton className={`h-[${height}px] w-full`} />;
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      {children(palette)}
    </div>
  );
}

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function LedgerTooltip({
  active,
  payload,
  label,
  suffixCents = true,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  suffixCents?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-2)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload
          .filter((entry) => entry.value !== undefined && entry.value !== null)
          .map((entry) => (
            <li key={`${entry.dataKey ?? entry.name}`} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="h-2 w-2 rounded-sm" style={{ background: entry.color }} />
                {entry.name}
              </span>
              <span className="num font-medium text-ink">
                {suffixCents ? formatCompactUsd(Number(entry.value)) : entry.value}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Monthly spend: seat vs usage split, with a 6-month average reference line. */
export function SpendTrendChart({ points, height = 268 }: { points: TrendPoint[]; height?: number }) {
  const average = points.length > 0 ? points.reduce((sum, point) => sum + point.totalCents, 0) / points.length : 0;

  if (points.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-ink-3">
        Monthly statement history is not available for this tenant.
      </div>
    );
  }

  return (
    <ChartFrame height={height} ariaLabel="Monthly SaaS spend split by seat licences and usage-based billing">
      {(palette) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ledgerly-seat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.brand} stopOpacity={0.5} />
                <stop offset="100%" stopColor={palette.brand} stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="ledgerly-usage" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.info} stopOpacity={0.42} />
                <stop offset="100%" stopColor={palette.info} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: palette.grid }} tick={{ fontSize: 11 }} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={58}
              tick={{ fontSize: 11 }}
              tickFormatter={(value: number) => formatCompactUsd(value)}
            />
            <Tooltip content={<LedgerTooltip />} />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="square"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: palette.inkMuted }}
            />
            <ReferenceLine
              y={average}
              stroke={palette.slate}
              strokeDasharray="4 4"
              label={{ value: "6-mo average", position: "insideTopRight", fill: palette.axis, fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="seatCents"
              name="Seat licences"
              stackId="1"
              stroke={palette.brand}
              strokeWidth={1.6}
              fill="url(#ledgerly-seat)"
            />
            <Area
              type="monotone"
              dataKey="usageCents"
              name="Usage billed"
              stackId="1"
              stroke={palette.info}
              strokeWidth={1.6}
              fill="url(#ledgerly-usage)"
            />
            <Line type="monotone" dataKey="totalCents" name="Total charged" stroke={palette.warn} strokeWidth={1.6} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** Category spend ranking — horizontal bars keep long labels readable. */
export function CategorySpendChart({
  slices,
  height = 300,
  max = 8,
}: {
  slices: { categoryGroup: string; monthlyCents: number; vendorCount: number }[];
  height?: number;
  max?: number;
}) {
  const data = slices.slice(0, max).map((slice) => ({ ...slice }));
  return (
    <ChartFrame height={height} ariaLabel="Monthly spend by software category">
      {(palette) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={palette.grid} horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              tickFormatter={(value: number) => formatCompactUsd(value)}
            />
            <YAxis type="category" dataKey="categoryGroup" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip content={<LedgerTooltip />} cursor={{ fill: palette.grid }} />
            <Bar dataKey="monthlyCents" name="Monthly spend" radius={[0, 3, 3, 0]} barSize={14}>
              {data.map((entry, index) => (
                <Cell
                  key={entry.categoryGroup}
                  fill={index === 0 ? palette.brand : palette.series[index % palette.series.length]}
                  fillOpacity={index === 0 ? 1 : 0.75}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** Vendor contribution with waste overlaid, so cost and leakage read together. */
export function VendorContributionChart({
  rows,
  height = 280,
  max = 7,
}: {
  rows: { vendor: string; monthlyCostCents: number; wasteCents: number }[];
  height?: number;
  max?: number;
}) {
  const data = rows.slice(0, max).map((row) => ({ ...row }));
  return (
    <ChartFrame height={height} ariaLabel="Largest vendors by monthly cost with identified waste">
      {(palette) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="vendor" tickLine={false} axisLine={{ stroke: palette.grid }} tick={{ fontSize: 10 }} interval={0} angle={-18} height={48} textAnchor="end" />
            <YAxis tickLine={false} axisLine={false} width={58} tick={{ fontSize: 11 }} tickFormatter={(value: number) => formatCompactUsd(value)} />
            <Tooltip content={<LedgerTooltip />} cursor={{ fill: palette.grid }} />
            <Legend verticalAlign="top" height={26} iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: palette.inkMuted }} />
            <Bar dataKey="monthlyCostCents" name="Monthly cost" fill={palette.info} fillOpacity={0.85} radius={[3, 3, 0, 0]} barSize={16} />
            <Bar dataKey="wasteCents" name="Identified waste" fill={palette.crit} radius={[3, 3, 0, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** Spend concentration donut. */
export function ConcentrationDonut({
  slices,
  totalCents,
  height = 260,
}: {
  slices: { label: string; value: number }[];
  totalCents: number;
  height?: number;
}) {
  return (
    <ChartFrame height={height} ariaLabel="Spend concentration by category">
      {(palette) => (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                const entry = payload?.[0];
                if (!active || !entry) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-2)]">
                    <p className="text-[11px] font-semibold text-ink">{entry.name}</p>
                    <p className="num mt-0.5 text-xs text-ink-2">
                      {formatCompactUsd(Number(entry.value))} ·{" "}
                      {totalCents > 0 ? `${(((entry.value as number) / totalCents) * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                );
              }}
            />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke={palette.surface}
              strokeWidth={2}
            >
              {slices.map((entry, index) => (
                <Cell key={entry.label} fill={palette.series[index % palette.series.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
