import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "ETS2 Friends Tracker",
  description: "Live ETS2 telemetry across friends",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-edge bg-panel">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
            <Link href="/" className="font-bold text-accent text-lg">ETS2 Tracker</Link>
            <nav className="flex gap-4 text-sm text-slate-300">
              <Link href="/">Live</Link>
              <Link href="/leaderboard">Leaderboard</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
