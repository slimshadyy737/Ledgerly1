import type { ReactNode } from "react";
import { AppShell } from "@/components/ledgerly/app-shell";

/**
 * Layout for the Ledgerly application shell. Every product page renders inside
 * the sidebar + topbar chrome, with the data provider supplying sandbox state.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
