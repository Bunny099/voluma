import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | Voluma',
  description: 'Privacy policy for using Voluma.',
};

function VolumaLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="rgba(212,255,0,0.08)" />
      <polyline points="6,10 16,22 26,10" fill="none" stroke="#d4ff00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="10" r="2.5" fill="#d4ff00" />
      <circle cx="16" cy="22" r="2.5" fill="#d4ff00" opacity="0.5" />
      <circle cx="26" cy="10" r="2.5" fill="#d4ff00" />
    </svg>
  );
}

const sections = [
  {
    title: 'Information We Collect',
    body: 'Voluma may store account details from login, such as your user ID, email, display name, and profile image. It also stores application data you create, including conditions, wallet records, trade history, pending transaction records, webhook URLs, and related activity logs.',
  },
  {
    title: 'Wallet Data',
    body: 'Trading wallet public keys, encrypted private key material, balances, token metadata, withdrawals, exports, and trade activity may be processed so the app can show wallet state and execute requested actions.',
  },
  {
    title: 'How Data Is Used',
    body: 'Data is used to authenticate sessions, operate the dashboard, evaluate automations, execute trades, send webhooks, show history, monitor system health, prevent abuse, and debug reliability issues.',
  },
  {
    title: 'Third-Party Providers',
    body: 'Voluma may send or receive data through services such as authentication providers, Supabase/Postgres, Solana RPC providers, Jupiter, and webhook endpoints that you configure.',
  },
  {
    title: 'Security',
    body: 'Voluma uses server-side controls such as session validation, encrypted wallet storage, rate limits, SSRF checks, and sensitive-action verification. No internet-connected system can be guaranteed perfectly secure.',
  },
  {
    title: 'Retention',
    body: 'Operational records may be retained while your account or automations are active. Some records may be cleaned up automatically when no longer needed for pending transactions, deduplication, reliability, or product operation.',
  },
  {
    title: 'Your Choices',
    body: 'You can delete automations, avoid configuring webhooks, avoid exporting sensitive wallet material, and stop using Voluma. Account or data deletion requests should be sent through the available support channel.',
  },
  {
    title: 'Updates',
    body: 'This policy may change as Voluma evolves. Continued use after changes means the updated policy applies to your use of the product.',
  },
];

export default function PrivacyPage() {
  return (
    <main className="legal-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box}
        .legal-root{min-height:100vh;background:#070b10;color:#d7e0ea;font-family:'DM Sans',system-ui,sans-serif;position:relative;overflow:hidden;padding:0 20px 56px}
        .legal-root::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,0.026) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.026) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(ellipse 80% 55% at 50% 10%,black,transparent);pointer-events:none}
        .legal-nav{height:68px;max-width:980px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
        .legal-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#d7e0ea}
        .legal-wordmark{font-family:'Bebas Neue',sans-serif;font-size:1.35rem;letter-spacing:0.1em}
        .legal-back{color:#d4ff00;text-decoration:none;border:1px solid rgba(212,255,0,0.22);background:rgba(212,255,0,0.08);border-radius:8px;padding:8px 14px;font-size:0.82rem;font-weight:700}
        .legal-shell{max-width:980px;margin:44px auto 0;position:relative;z-index:1}
        .legal-eyebrow{font-family:'JetBrains Mono',monospace;font-size:0.72rem;letter-spacing:0.14em;text-transform:uppercase;color:#d4ff00;margin-bottom:14px}
        .legal-title{font-family:'Bebas Neue',sans-serif;font-size:clamp(3rem,8vw,6.5rem);line-height:0.92;letter-spacing:0.02em;color:#edf3f8;margin:0 0 18px}
        .legal-lead{font-size:1rem;line-height:1.75;color:#b8c4cf;max-width:720px;margin:0 0 34px}
        .legal-meta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:30px}
        .legal-pill{font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:#cbd6e2;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);border-radius:999px;padding:7px 11px}
        .legal-list{display:grid;gap:12px}
        .legal-section{background:#0a0f16;border:1px solid rgba(255,255,255,0.09);border-left:2px solid rgba(212,255,0,0.45);border-radius:10px;padding:20px 22px}
        .legal-section h2{font-family:'Bebas Neue',sans-serif;font-size:1.45rem;letter-spacing:0.06em;color:#d4ff00;margin:0 0 8px}
        .legal-section p{font-size:0.94rem;line-height:1.7;color:#c8d2dc;margin:0}
        .legal-note{margin-top:18px;color:#aebbc8;font-size:0.9rem;line-height:1.65;border-top:1px solid rgba(255,255,255,0.08);padding-top:18px}
        .legal-links{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}
        .legal-links a{color:#d4ff00;text-decoration:none;font-weight:700}
      `}</style>

      <nav className="legal-nav">
        <Link href="/" className="legal-brand"><VolumaLogo /><span className="legal-wordmark">Voluma</span></Link>
        <Link href="/" className="legal-back">Back home</Link>
      </nav>

      <section className="legal-shell">
        <div className="legal-eyebrow">Legal</div>
        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-lead">
          This policy explains what Voluma processes to run the product. The design goal is simple: keep data limited to what the app needs for authentication, automation, wallet operation, trading history, and reliability.
        </p>
        <div className="legal-meta">
          <span className="legal-pill">Effective: June 7, 2026</span>
          <span className="legal-pill">Applies to Voluma web app and API</span>
        </div>
        <div className="legal-list">
          {sections.map(section => (
            <article className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
        <p className="legal-note">
          If you have privacy questions or want to request account/data deletion, use the support channel provided in the application or repository.
        </p>
        <div className="legal-links">
          <Link href="/terms">Terms & Conditions</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </section>
    </main>
  );
}
