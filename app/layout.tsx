import type { Metadata, Viewport } from "next";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { siteUrl } from "@/lib/env";

export const viewport: Viewport = { themeColor: "#000000" };

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    template: "%s — Nigel Smith's Schedule",
    default: "Nigel Smith's Schedule",
  },
  description: "Nigel Smith's public schedule, subscribable as an iCalendar feed.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Nigel Smith's Schedule",
    description: "Nigel Smith's public schedule, subscribable as an iCalendar feed.",
    siteName: "Nigel Smith's Schedule",
    locale: "en_US",
    type: "website",
    url: siteUrl(),
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" data-scroll-behavior="smooth">
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-bg focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-1"
        >
          Skip to main content
        </a>
        <Navbar />
        <div id="main-content" className="flex-1">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
