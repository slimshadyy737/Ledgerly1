"use client";

/** Settings — theme, sandbox data controls, detection policy and limitations. */
import { useState } from "react";
import { DatabaseZap, Keyboard, MonitorCheck, Palette, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useLedgerData } from "@/components/ledgerly/data";
import { ThemeSelector, useTheme } from "@/lib/ledgerly/theme";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  DemoBadge,
  KeyValue,
  PageHeader,
  StatusBadge,
  formatUsd,
} from "@/components/ledgerly/ui";

export function SettingsPage() {
  const { analytics, metrics, audit, tenant, companies, companyId, setCompanyId, resetDemo, refresh, refreshing, lastSyncedAt } =
    useLedgerData();
  const { theme, resolved } = useTheme();
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        subtitle="Appearance, sandbox data controls and the detection policy currently in force."
        meta={
          <>
            <DemoBadge />
            <Chip tone="neutral">
              theme: {theme} ({resolved})
            </Chip>
            <Chip tone="neutral">{companyId === null ? "auto tenant" : `tenant ${companyId}`}</Chip>
          </>
        }
        actions={
          <Button tone="neutral" busy={refreshing} onClick={() => void refresh()}>
            Re-sync data
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Palette size={14} strokeWidth={1.9} />}
            title="Appearance"
            subtitle="Light, dark or match the operating system. Dark is the default."
          />
          <div className="space-y-3 p-3.5">
            <ThemeSelector />
            <p className="text-[11.5px] leading-relaxed text-ink-2">
              The selected theme is stored in this browser and applied before first paint, so there is no flash of the wrong palette.
              Choosing <span className="text-ink">System</span> follows the OS preference live and reacts if you change it while the app is
              open.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Swatch label="Canvas" value="var(--canvas)" />
              <Swatch label="Surface" value="var(--surface)" />
              <Swatch label="Border" value="var(--line)" />
              <Swatch label="Brand" value="var(--brand)" />
              <Swatch label="Warning" value="var(--warn)" />
              <Swatch label="Critical" value="var(--crit)" />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<MonitorCheck size={14} strokeWidth={1.9} />}
            title="Detection policy"
            subtitle="Windows applied by the analytics engine to every contract"
          />
          <dl className="divide-y divide-[var(--line)] px-3.5 py-1">
            <KeyValue label="Ghost seat window" hint="A seat is a ghost seat when its holder left the company or has not logged in for longer than this window.">
              {analytics ? `${analytics.windows.staleLicenseDays} days` : "60 days"}
            </KeyValue>
            <KeyValue label="Zombie window" hint="A subscription becomes zombie software when nobody authenticated inside this window while the invoice continues.">
              {analytics ? `${analytics.windows.activeSeatDays} days` : "30 days"}
            </KeyValue>
            <KeyValue label="Duplicate category rule">2+ vendors in one normalised category, lowest adoption flagged</KeyValue>
            <KeyValue label="Idle capacity rule">Invoiced seats that never appear in the licence register</KeyValue>
            <KeyValue label="Reference time">
              {analytics ? new Date(analytics.generatedAt).toLocaleString("en-US") : "—"}
            </KeyValue>
            <KeyValue label="Missing telemetry">Counted as suspected inactivity, never as measured inactivity</KeyValue>
            <KeyValue label="Double counting">Each dollar attributed to exactly one opportunity</KeyValue>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            icon={<DatabaseZap size={14} strokeWidth={1.9} />}
            title="Sandbox data"
            subtitle="The demo company is generated deterministically and stored in PostgreSQL"
          />
          <div className="space-y-3 p-3.5">
            <dl className="divide-y divide-[var(--line)]">
              <KeyValue label="Workspace">{tenant?.name ?? "—"}</KeyValue>
              <KeyValue label="Tenants available">{companies.length}</KeyValue>
              <KeyValue label="Contracts">{analytics?.estate.subscriptionsTotal ?? 0}</KeyValue>
              <KeyValue label="Paid seats">{metrics?.seatsPaid ?? 0}</KeyValue>
              <KeyValue label="Identified savings">{metrics ? `${formatUsd(metrics.identifiedSavingsCents)}/month` : "—"}</KeyValue>
              <KeyValue label="Audit entries">{audit.length}</KeyValue>
              <KeyValue label="Last sync">{lastSyncedAt ? lastSyncedAt.toLocaleTimeString("en-US") : "—"}</KeyValue>
            </dl>

            {companies.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {companies.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setCompanyId(company.id)}
                    className={`focus-ring rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                      (companyId ?? companies[0]?.id) === company.id ? "border-brand/40 bg-brand/10 text-ink" : "border-line text-ink-2 hover:text-ink"
                    }`}
                  >
                    <span className="block font-medium">{company.name}</span>
                    <span className="num block text-[10.5px] text-ink-3">
                      {company.users_count} employees · {company.active_subscriptions} contracts
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button tone="neutral" busy={refreshing} onClick={() => void refresh()}>
                Re-run analytics
              </Button>
              <Button tone="danger" icon={<RotateCcw size={13} strokeWidth={2} />} onClick={() => setResetOpen(true)}>
                Reset demo data
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-3.5">
          <Card>
            <CardHeader
              icon={<Keyboard size={14} strokeWidth={1.9} />}
              title="Keyboard shortcuts"
              subtitle="Everything is reachable without a mouse"
              dense
            />
            <ul className="divide-y divide-[var(--line)] text-[12px]">
              {[
                ["⌘K / Ctrl K", "Open command search"],
                ["/", "Open command search"],
                ["⌘B / Ctrl B", "Collapse or expand the sidebar"],
                ["↑ ↓ ↵", "Navigate command results"],
                ["Esc", "Close palette, drawer or dialog"],
                ["Tab", "Cycle focus inside dialogs"],
              ].map(([keys, description]) => (
                <li key={keys} className="flex items-center justify-between gap-3 px-3.5 py-2">
                  <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">{keys}</kbd>
                  <span className="text-ink-3">{description}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              icon={<ShieldCheck size={14} strokeWidth={1.9} />}
              title="Data integrity"
              subtitle="How Ledgerly keeps the numbers trustworthy"
              dense
            />
            <ul className="space-y-2 p-3.5 text-[11.5px] leading-relaxed text-ink-2">
              <li className="flex gap-2">
                <StatusBadge tone="brand">Once</StatusBadge>
                <span>Every dollar of waste is attributed to exactly one opportunity; a zombie contract claims its whole invoice.</span>
              </li>
              <li className="flex gap-2">
                <StatusBadge tone="info">Split</StatusBadge>
                <span>Identified savings (modelled) and realized savings (measured after a write-back) are reported separately.</span>
              </li>
              <li className="flex gap-2">
                <StatusBadge tone="warn">Honest</StatusBadge>
                <span>Missing login telemetry is labelled “no login recorded” and marked unverified instead of assumed inactive.</span>
              </li>
              <li className="flex gap-2">
                <StatusBadge tone="neutral">Source</StatusBadge>
                <span>The PostgreSQL backend is the single source of truth; the UI re-reads it after every action.</span>
              </li>
            </ul>
          </Card>

          <Card className="border-warn/30 bg-[color-mix(in_oklab,var(--warn)_6%,var(--surface))] p-3.5">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              <TriangleAlert size={14} strokeWidth={2} className="text-warn" /> Known limitations
            </p>
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-ink-2">
              <li>• Dismissed findings are hidden in this browser only (localStorage); the detector still reports them server-side.</li>
              <li>• Statement history is limited to the seeded period, so month-over-month comparison exists for spend but not for seat counts.</li>
              <li>• Usage-billed contracts have no seat telemetry, so waste cannot be attributed to individuals for those vendors.</li>
              <li>• Resetting the sandbox runs the seed script on the server; it is a local demo control, not a production feature.</li>
            </ul>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        busy={busy}
        tone="danger"
        onClose={() => setResetOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          await resetDemo();
          setBusy(false);
          setResetOpen(false);
        }}
        title="Reset demo data?"
        description="The deterministic sandbox company is reloaded: contracts, seats, activity telemetry and the audit log are rebuilt from the seed script."
        confirmLabel="Reset now"
        details={
          <p className="text-[11.5px] text-ink-2">
            This clears {audit.length} audit entr{audit.length === 1 ? "y" : "ies"} and restores the original seat assignments. Any
            optimization you applied during the demo will be lost.
          </p>
        }
      />
    </div>
  );
}

function Swatch({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block h-8 rounded-lg border border-line" style={{ background: value }} />
      <span className="mt-1 block text-[10px] uppercase tracking-[0.08em] text-ink-3">{label}</span>
    </div>
  );
}
