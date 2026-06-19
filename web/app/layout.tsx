import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

// ── Constants ─────────────────────────────────────────────────────────────────
const APP_URL = "https://voluma.online";
const APP_NAME = "Voluma";
const APP_DESCRIPTION =
  "Monitor Solana wallets, detect market activity, receive alerts, and execute trades automatically through Jupiter. Real-time on-chain automation without code.";

// ── Viewport (separate export — Next.js 15 requirement) ───────────────────────
export const viewport: Viewport = {
  themeColor: "#d4ff00",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

// ── Metadata ──────────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  // Resolves all relative image/url paths against this base
  metadataBase: new URL(APP_URL),

  // Title template — individual pages override the default
  title: {
    default: "Voluma — Automate Solana Trading & On-Chain Signals",
    template: "%s | Voluma",
  },

  description: APP_DESCRIPTION,

  keywords: [
    "solana trading bot",
    "jupiter trading bot",
    "solana automation",
    "automated trading",
    "wallet tracking",
    "solana alerts",
    "defi automation",
    "on-chain automation",
    "solana",
    "web3"
  ],

  authors: [{ name: "Voluma", url: APP_URL }],
  creator: "Voluma",
  publisher: "Voluma",

  // Canonical URL — tells Google this is the definitive version
  alternates: {
    canonical: APP_URL,
  },

  // Indexing rules
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },

  // ── Open Graph ──────────────────────────────────────────────────────────────
  openGraph: {
    type: "website",
    locale: "en_US",
    url: APP_URL,
    siteName: APP_NAME,
    title: "Voluma — Solana Trading Automation",
    description: APP_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Voluma — Real-time Solana automation engine",
        type: "image/png",
      },
    ],
  },

  // ── Twitter / X Card ────────────────────────────────────────────────────────
  twitter: {
    card: "summary_large_image",
    site: "@volumaonline",
    creator: "@volumaonline",
    title: "Voluma — Solana Trading Automation",
    description: APP_DESCRIPTION,
    images: ["/og-image.png"],
  },

  // ── Icons ───────────────────────────────────────────────────────────────────
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    shortcut: "/favicon.ico",
  },

  // ── PWA manifest ────────────────────────────────────────────────────────────
  manifest: "/site.webmanifest",

  // ── Verification ────────────────────────────────────────────────────────────
  verification: {
    google: "VufMHVhwi1h-055YPjMa940vnKPF8V6VjOlQX3RwP6E",
  },
};

// ── JSON-LD Structured Data ───────────────────────────────────────────────────
// Helps Google display rich results (name, description, url) in search
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: APP_NAME,
  url: APP_URL,
  description: APP_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web Browser",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  creator: {
    "@type": "Organization",
    name: "Voluma",
    url: APP_URL,
  },
};

// ── Root Layout ───────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="font-sans bg-[#070d14] text-slate-100 antialiased"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
