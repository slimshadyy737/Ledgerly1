import { DashboardApp } from "@/components/DashboardApp";

/**
 * Analyst workspace — the multi-tab console (raw card statement, SSO login log,
 * employee roster, ingestion pipeline docs) kept alongside the SaaSify Clean
 * executive dashboard at "/".
 */
export const dynamic = "force-dynamic";

export default function Page() {
  return <DashboardApp />;
}
