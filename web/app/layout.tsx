import type { Metadata } from 'next';
import './globals.css';
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  title:       'Voluma',
  description: 'Automate trades from live Solana on-chain activity. Monitor wallets, detect swap bursts and volume spikes, execute trades automatically.',
  openGraph: {
    title:       'Voluma',
    description: 'Real-time Solana automation engine. Define conditions, monitor the chain, execute trades automatically.',
    type:        'website',
  },
  icons:{
    icon:"/favicon.ico",
    shortcut:"/favicon.ico",
    apple:"/favicon.ico",
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
      
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
