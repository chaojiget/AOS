import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/app/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AOS Telemetry UI",
  description: "AOS telemetry dashboard (Neural Stream + Trace Chain).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body
        className={[
          inter.className,
          "min-h-screen bg-gradient-to-br from-zinc-950 via-slate-950 to-zinc-900 text-zinc-100",
        ].join(" ")}
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
