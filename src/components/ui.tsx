"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* --------------------------------- layout --------------------------------- */

export function Panel({
  children,
  className = "",
  title,
  subtitle,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-800/80 bg-slate-900/50 backdrop-blur-sm shadow-[0_1px_0_0_rgba(148,163,184,0.06)_inset] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-800/70 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "slate",
  className = "",
}: {
  children: ReactNode;
  tone?: "slate" | "emerald" | "amber" | "rose" | "sky" | "violet";
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
    emerald: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    rose: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    sky: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    violet: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  color = "#34d399",
  height = 6,
  track = "rgba(148,163,184,0.18)",
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: track }}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

/* ------------------------------- count-up hook ----------------------------- */

/** Animates a numeric KPI whenever it changes (used after a reclaim action). */
export function useCountUp(value: number, duration = 650): number {
  const [display, setDisplay] = useState(value);
  const settled = useRef(value);

  useEffect(() => {
    const from = settled.current;
    if (from === value) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (value - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        settled.current = value;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return display;
}

export function CountUp({
  value,
  format,
  className = "",
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const animated = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{format(animated)}</span>;
}

/* ---------------------------------- charts -------------------------------- */

export function Sparkline({ values, color = "#34d399" }: { values: number[]; color?: string }) {
  if (values.length === 0) return <span className="text-xs text-slate-500">no history</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  return (
    <div className="flex h-8 items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm transition-all"
          style={{
            height: `${Math.max(12, ((v - min) / range) * 100)}%`,
            background: i === values.length - 1 ? color : "rgba(148,163,184,0.35)",
          }}
          title={`$${(v / 100).toFixed(0)}`}
        />
      ))}
    </div>
  );
}

export function AreaChart({
  points,
  height = 180,
}: {
  points: { label: string; value: number; secondary?: number }[];
  height?: number;
}) {
  if (points.length === 0) return null;
  const width = 620;
  const max = Math.max(...points.map((p) => p.value)) * 1.12;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const y = (v: number) => height - (v / max) * (height - 24) - 8;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * stepX},${y(p.value)}`).join(" ");
  const area = `${line} L${(points.length - 1) * stepX},${height} L0,${height} Z`;
  const seatLine = points
    .filter((p) => p.secondary !== undefined)
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * stepX},${y(p.secondary as number)}`)
    .join(" ");

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={width}
            y1={8 + t * (height - 24)}
            y2={8 + t * (height - 24)}
            stroke="rgba(148,163,184,0.12)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#spendFill)" />
        <path
          d={line}
          fill="none"
          stroke="#34d399"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {seatLine && (
          <path
            d={seatLine}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={2}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.map((p, i) => (
          <circle key={p.label} cx={i * stepX} cy={y(p.value)} r={3} fill="#0b1120" stroke="#34d399" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({
  slices,
  total,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; color: string }[];
  total: number;
  centerLabel: string;
  centerValue: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth="14" />
          {slices.map((slice) => {
            const fraction = total > 0 ? slice.value / total : 0;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={slice.label}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return element;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{centerLabel}</span>
          <span className="text-lg font-semibold text-slate-100">{centerValue}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.slice(0, 7).map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
              <span className="truncate text-slate-300">{slice.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {((total > 0 ? slice.value / total : 0) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="pointer-events-auto fixed bottom-6 right-6 z-50 max-w-md">
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur ${
          tone === "success" ? "border-emerald-500/40 bg-emerald-500/10" : "border-rose-500/40 bg-rose-500/10"
        }`}
      >
        <span className="text-lg">{tone === "success" ? "✅" : "⚠️"}</span>
        <p className="text-xs leading-relaxed text-slate-100">{message}</p>
        <button onClick={onClose} className="ml-2 text-slate-400 transition hover:text-slate-100">
          ✕
        </button>
      </div>
    </div>
  );
}
