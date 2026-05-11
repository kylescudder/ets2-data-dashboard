import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "../components/Nav";
import { UrlCleaner } from "../components/UrlCleaner";

export const metadata = {
  title: "Euro Truck Simulator 2 Data Dashboard",
  description: "Live ETS2 telemetry across friends",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <UrlCleaner />
        <Nav />
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
