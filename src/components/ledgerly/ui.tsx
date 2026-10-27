"use client";

/**
 * ---------------------------------------------------------------------------
 * LEDGERLY — shared component library
 * ---------------------------------------------------------------------------
 * Presentational primitives only: no business logic, no data fetching. Every
 * component reads the Midnight Ledger tokens so both themes are handled by the
 * token layer rather than per-component conditionals.
 *
 * Exports: ToastProvider/useToast · Button · IconButton · Card · CardHeader ·
 * SectionHeader · StatusBadge · HealthScore · ProgressBar · Tooltip · Chip ·
 * SegmentedControl · TextInput · SelectInput · EmptyState · Skeleton ·
 * Modal · ConfirmDialog · Drawer · Sparkline · KeyValue · PageHeader
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/* ============================== toasts =================================== */

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: { tone?: ToastTone; title: string; description?: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((toast: { tone?: ToastTone; title: string; description?: string }) => {
    counter.current += 1;
    const id = counter.current;
    setItems((previous) => [...previous, { id, tone: toast.tone ?? "info", title: toast.title, description: toast.description }]);
    setTimeout(() => setItems((previous) => previous.filter((item) => item.id !== id)), 6500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="no-print pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(94vw,26rem)] flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="animate-slide-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-3)]"
          >
            <span
              className={`mt-0.5 ${
                item.tone === "success" ? "text-brand" : item.tone === "error" ? "text-crit" : "text-info"
              }`}
            >
              {item.tone === "success" ? (
                <CheckCircle2 size={16} strokeWidth={2} />
              ) : item.tone === "error" ? (
                <AlertTriangle size={16} strokeWidth={2} />
              ) : (
                <Info size={16} strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{item.title}</p>
              {item.description && <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{item.description}</p>}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setItems((previous) => previous.filter((entry) => entry.id !== item.id))}
              className="focus-ring rounded-md p-0.5 text-ink-3 transition-colors hover:text-ink"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

/* ============================== buttons ================================== */

type ButtonTone = "primary" | "neutral" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

export function Button({
  children,
  onClick,
  tone = "neutral",
  size = "sm",
  disabled,
  busy,
  icon,
  type = "button",
  className = "",
  title,
  form,
}: {
  children?: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  size?: ButtonSize;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  type?: "button" | "submit";
  className?: string;
  title?: string;
  form?: string;
}) {
  const tones: Record<ButtonTone, string> = {
    primary: "bg-brand text-[color:var(--brand-ink)] hover:brightness-110 border border-transparent",
    neutral: "bg-surface-2 text-ink border border-line hover:border-line-strong",
    danger: "bg-crit/12 text-crit border border-crit/30 hover:bg-crit/20",
    ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink",
  };
  return (
    <button
      type={type}
      form={form}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={`focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-[13px]"
      } ${tones[tone]} ${className}`}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
}

export function IconButton({
  children,
  onClick,
  label,
  active,
  className = "",
  badge,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  active?: boolean;
  className?: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`focus-ring relative inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
        active ? "border-line-strong bg-surface-2 text-ink" : "border-line bg-surface text-ink-2 hover:text-ink"
      } ${className}`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[9px] font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/* =============================== surfaces ================================ */

export function Card({
  children,
  className = "",
  padded = false,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "div" | "article" | "aside";
}) {
  return <Tag className={`card ${padded ? "p-4" : ""} ${className}`}>{children}</Tag>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  dense,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  dense?: boolean;
}) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-line ${dense ? "px-3.5 py-2.5" : "px-4 py-3"}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-3">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* =============================== badges ================================== */

export type BadgeTone = "brand" | "crit" | "warn" | "info" | "neutral" | "violet";

const TONE_CLASS: Record<BadgeTone, string> = {
  brand: "bg-brand/12 text-brand ring-brand/25",
  crit: "bg-crit/12 text-crit ring-crit/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  info: "bg-info/12 text-info ring-info/25",
  violet: "bg-violet/12 text-violet ring-violet/25",
  neutral: "bg-ink-3/12 text-ink-2 ring-line",
};

/**
 * Status badge. Never relies on colour alone: every badge pairs a tone with a
 * glyph and a text label.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  icon,
  pulse = false,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset ${TONE_CLASS[tone]} ${className}`}
    >
      {pulse && <span className="dot-live h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}

export function Chip({
  children,
  onClick,
  active,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  tone?: BadgeTone;
  title?: string;
}) {
  if (!onClick) {
    return (
      <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
        active ? TONE_CLASS[tone] : "bg-transparent text-ink-3 ring-line hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function HealthScore({ score, grade, compact }: { score: number; grade: string; compact?: boolean }) {
  const color = score >= 85 ? "var(--brand)" : score >= 70 ? "var(--info)" : score >= 55 ? "var(--warn)" : "var(--crit)";
  const label = score >= 85 ? "Healthy" : score >= 70 ? "Monitor" : score >= 55 ? "Review" : score >= 40 ? "At risk" : "Critical";
  return (
    <div className="flex items-center gap-2" title={`Health score ${score}/100 — ${label}`}>
      <span className="num text-xs font-semibold" style={{ color }}>
        {score}
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${score}%`, background: color }} />
      </span>
      {!compact && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{grade}</span>}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  height = 5,
  label,
}: {
  value: number;
  tone?: BadgeTone;
  height?: number;
  label?: string;
}) {
  const colors: Record<BadgeTone, string> = {
    brand: "var(--brand)",
    crit: "var(--crit)",
    warn: "var(--warn)",
    info: "var(--info)",
    violet: "var(--violet)",
    neutral: "var(--ink-3)",
  };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="w-full overflow-hidden rounded-full bg-surface-2"
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: colors[tone] }}
      />
    </div>
  );
}

/* =============================== tooltip ================================= */

export function Tooltip({ children, content, side = "top" }: { children: ReactNode; content: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  return (
    <span className="group/tt relative inline-flex">
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-1/2 z-50 hidden w-60 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-[11px] leading-relaxed text-ink-2 shadow-[var(--shadow-2)] group-hover/tt:block group-focus-within/tt:block ${
          side === "top" ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        {content}
      </span>
    </span>
  );
}

export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip content={children}>
      <span
        tabIndex={0}
        className="focus-ring inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line text-[9px] font-semibold text-ink-3"
      >
        ?
      </span>
    </Tooltip>
  );
}

/* ================================ inputs ================================= */

export function TextInput({
  value,
  onChange,
  placeholder,
  icon,
  className = "",
  type = "text",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  type?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {icon && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3">{icon}</span>}
      <input
        type={type}
        value={value}
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`focus-ring h-8 w-full rounded-lg border border-line bg-surface text-xs text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong ${
          icon ? "pl-8 pr-2.5" : "px-2.5"
        }`}
      />
    </div>
  );
}

export function SelectInput<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={`focus-ring h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink transition-colors hover:border-line-strong ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`focus-ring rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            value === option.value ? "bg-surface text-ink shadow-[var(--shadow-1)]" : "text-ink-3 hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ============================ states & chrome ============================ */

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14"}`}>
      {icon && <span className="text-ink-3">{icon}</span>}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-ink-2">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span className={`skeleton block rounded-md ${className}`} aria-hidden />;
}

export function KeyValue({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">
        {label}
        {hint && <InfoHint>{hint}</InfoHint>}
      </dt>
      <dd className="num text-xs font-medium text-ink">{children}</dd>
    </div>
  );
}

export function Sparkline({
  values,
  tone = "brand",
  width = 88,
  height = 26,
}: {
  values: number[];
  tone?: BadgeTone;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <span className="text-[10px] text-ink-3">no history</span>;
  }
  const colors: Record<BadgeTone, string> = {
    brand: "var(--brand)",
    crit: "var(--crit)",
    warn: "var(--warn)",
    info: "var(--info)",
    violet: "var(--violet)",
    neutral: "var(--ink-3)",
  };
  const color = colors[tone];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${index * step},${height - ((value - min) / range) * (height - 4) - 2}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(values.length - 1) * step} cy={Number(points[points.length - 1].split(",")[1])} r={2} fill={color} />
    </svg>
  );
}

/* ============================ modal / dialog ============================= */

function useDialogBehaviour(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>("[data-autofocus]")?.focus() ?? node?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useDialogBehaviour(open, onClose);
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" };
  return (
    <div className="no-print fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="animate-fade fixed inset-0" style={{ background: "var(--overlay)" }} onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-fade-up relative w-full ${widths[size]} rounded-xl border border-line bg-surface shadow-[var(--shadow-3)]`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </IconButton>
        </header>
        {children && <div className="px-4 py-3.5">{children}</div>}
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel = "Confirm",
  tone = "primary",
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  details?: ReactNode;
  confirmLabel?: string;
  tone?: ButtonTone;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone={tone} onClick={onConfirm} busy={busy} className="px-3">
            {confirmLabel}
          </Button>
        </>
      }
    >
      {details}
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const ref = useDialogBehaviour(open, onClose);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-[65] flex justify-end">
      <div className="animate-fade fixed inset-0" style={{ background: "var(--overlay)" }} onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`animate-slide-in relative flex h-full w-full ${width} flex-col border-l border-line bg-canvas shadow-[var(--shadow-3)]`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            {subtitle && <div className="mt-1 text-xs text-ink-2">{subtitle}</div>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ============================== misc helpers ============================= */

export function DemoBadge({ label = "Sandbox" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-warn">
      <span className="dot-live h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

export function formatUsd(cents: number, opts: { exact?: boolean } = {}): string {
  const value = (Number(cents) || 0) / 100;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.exact ? 2 : 0,
    maximumFractionDigits: opts.exact ? 2 : 0,
  });
}

export function formatCompactUsd(cents: number): string {
  const value = (Number(cents) || 0) / 100;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}
