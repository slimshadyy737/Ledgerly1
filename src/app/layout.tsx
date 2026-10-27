import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/lib/ledgerly/theme";
import { ToastProvider } from "@/components/ledgerly/ui";
import { THEME_INIT_SCRIPT } from "@/lib/ledgerly/theme-script";

export const metadata: Metadata = {
  title: "Ledgerly · SaaS spend intelligence",
  description:
    "Ledgerly reconciles accounting data with identity-provider logins to expose unused licences, duplicate platforms and forgotten employee accounts — then releases the spend on one click.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#090D12" },
    { media: "(prefers-color-scheme: light)", color: "#F5F7F8" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning` is required because the bootstrap script sets
    // the theme class before React hydrates.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
