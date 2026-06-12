'use client';
import { useState, useEffect } from 'react';
import { useRouter }           from 'next/navigation';
import Link                    from 'next/link';
import { authClient }          from '@/lib/auth-client';

function VolumaLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="rgba(212,255,0,0.08)" />
      <polyline points="6,10 16,22 26,10" fill="none" stroke="#d4ff00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6"  cy="10" r="2.5" fill="#d4ff00" />
      <circle cx="16" cy="22" r="2.5" fill="#d4ff00" opacity="0.5" />
      <circle cx="26" cy="10" r="2.5" fill="#d4ff00" />
    </svg>
  );
}

export default function LoginPage() {
  const router                       = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [loading, setLoading]        = useState(false);

  useEffect(() => {
    if (!isPending && session) router.push('/dashboard');
  }, [session, isPending, router]);

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' });
    } catch {
      setLoading(false);
    }
  };

  if (isPending) return null;

  return (
    <div className="login-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

        .login-root{
          min-height:100vh;background:#070b10;display:flex;flex-direction:column;
          align-items:center;justify-content:center;padding:20px;
          font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
          position:relative;overflow:hidden;
        }
        /* grid bg */
        .login-root::before{
          content:'';position:fixed;inset:0;
          background-image:linear-gradient(rgba(255,255,255,0.028) 1px,transparent 1px),
                           linear-gradient(90deg,rgba(255,255,255,0.028) 1px,transparent 1px);
          background-size:64px 64px;
          mask-image:radial-gradient(ellipse 70% 70% at 50% 50%,black 0%,transparent 100%);
          pointer-events:none;
        }
        /* yellow radial bloom behind card */
        .login-root::after{
          content:'';position:fixed;
          width:600px;height:600px;border-radius:50%;
          background:radial-gradient(circle,rgba(212,255,0,0.055) 0%,transparent 70%);
          top:50%;left:50%;transform:translate(-50%,-50%);
          pointer-events:none;animation:login-bloom 5s ease-in-out infinite;
        }

        .login-card{
          position:relative;z-index:1;
          width:100%;max-width:400px;
          background:#0a0f16;
          border:1px solid rgba(255,255,255,0.1);
          border-radius:20px;
          padding:44px 36px 36px;
          text-align:center;
          animation:login-up 0.45s ease-out both;
        }
        /* accent top border */
        .login-card::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;border-radius:20px 20px 0 0;
          background:linear-gradient(90deg,transparent,rgba(212,255,0,0.45),transparent);
        }

        .login-brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:30px;text-decoration:none}
        .login-wordmark{font-family:'Bebas Neue',sans-serif;font-size:2rem;letter-spacing:0.1em;color:#e8ecf0}

        .login-heading{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:0.06em;color:#e8ecf0;margin-bottom:8px}
        .login-sub{font-size:0.83rem;color:#6e7886;margin-bottom:28px;line-height:1.65}

        /* Google button */
        .login-google{
          display:flex;align-items:center;justify-content:center;gap:12px;
          width:100%;padding:13px 20px;
          background:#ffffff;border:none;border-radius:10px;
          cursor:pointer;font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:600;
          color:#1a1a1a;transition:opacity 0.2s,transform 0.2s,box-shadow 0.2s;
          box-shadow:0 2px 12px rgba(0,0,0,0.3);
        }
        .login-google:hover:not(:disabled){opacity:0.93;transform:translateY(-1px);box-shadow:0 6px 24px rgba(0,0,0,0.4)}
        .login-google:active:not(:disabled){transform:translateY(0)}
        .login-google:disabled{opacity:0.6;cursor:not-allowed;background:rgba(255,255,255,0.08);color:#4a5260}

        /* divider */
        .login-divider{display:flex;align-items:center;gap:12px;margin:24px 0 20px}
        .login-divider-line{flex:1;height:1px;background:rgba(255,255,255,0.07)}
        .login-divider-label{font-family:'JetBrains Mono',monospace;font-size:0.58rem;color:#8a939f;letter-spacing:0.1em;white-space:nowrap}

        /* feature pills */
        .login-pills{display:flex;justify-content:center;flex-wrap:wrap;gap:6px}
        .login-pill{
          font-family:'JetBrains Mono',monospace;font-size:0.58rem;font-weight:600;
          padding:4px 10px;border-radius:100px;
          background:rgba(212,255,0,0.06);border:1px solid rgba(212,255,0,0.16);
          color:rgba(212,255,0,0.6);letter-spacing:0.06em;
        }

        /* spinner */
        .login-spinner{
          width:18px;height:18px;border-radius:50%;
          border:2.5px solid rgba(0,0,0,0.12);border-top-color:#1a1a1a;
          animation:login-spin 0.7s linear infinite;flex-shrink:0;
        }

        .login-back{
          position:relative;z-index:1;margin-top:22px;
          font-family:'JetBrains Mono',monospace;font-size:0.62rem;
          color:#6e7886;text-decoration:none;letter-spacing:0.06em;
          transition:color 0.15s;
        }
        .login-back:hover{color:#d4ff00}

        /* trust strip at bottom of card */
        .login-trust{
          margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.07);
          display:flex;align-items:center;justify-content:center;gap:6px;
          font-family:'JetBrains Mono',monospace;font-size:0.6rem;color:#4a5260;letter-spacing:0.08em;
        }
        .login-trust-dot{width:3px;height:3px;border-radius:50%;background:rgba(212,255,0,0.35)}

        @keyframes login-up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        @keyframes login-bloom{0%,100%{opacity:0.7;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}}
        @keyframes login-spin{to{transform:rotate(360deg)}}
      `}</style>

      <div className="login-card">
        {/* Logo */}
        <Link href="/" className="login-brand">
          <VolumaLogo size={36} />
          <span className="login-wordmark">Voluma</span>
        </Link>

        <p className="login-heading">Sign in to continue</p>
        <p className="login-sub">
          Real-time Solana automation. Define conditions,<br />
          monitor the chain, execute trades automatically.
        </p>

        {/* Google button */}
        <button className="login-google" onClick={signInWithGoogle} disabled={loading}>
          {loading ? (
            <>
              <div className="login-spinner" />
              Signing in…
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2045C17.64 8.5663 17.5827 7.9527 17.4764 7.3636H9V10.845H13.8436C13.635 11.97 13.0009 12.9231 12.0477 13.5613V15.8195H14.9564C16.6582 14.2527 17.64 11.9454 17.64 9.2045Z" fill="#4285F4"/>
                <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5613C11.2418 14.1013 10.2109 14.4204 9 14.4204C6.65591 14.4204 4.67182 12.8372 3.96409 10.71H0.957275V13.0418C2.43818 15.9831 5.48182 18 9 18Z" fill="#34A853"/>
                <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.5931 3.68182 9C3.68182 8.4068 3.78409 7.8299 3.96409 7.29V4.9581H0.957275C0.347727 6.1731 0 7.5477 0 9C0 10.4522 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
                <path d="M9 3.5795C10.3214 3.5795 11.5077 4.0336 12.4405 4.9254L15.0218 2.344C13.4632 0.8918 11.4259 0 9 0C5.48182 0 2.43818 2.0168 0.957275 4.9581L3.96409 7.29C4.67182 5.1627 6.65591 3.5795 9 3.5795Z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {/* Divider */}
        <div className="login-divider">
          <div className="login-divider-line" />
          <span className="login-divider-label">SECURE · ENCRYPTED · SOLANA</span>
          <div className="login-divider-line" />
        </div>

        {/* Feature pills */}
        <div className="login-pills">
          {['Real-time signals', 'AES-256 wallets', 'Jupiter DEX'].map(f => (
            <span key={f} className="login-pill">{f}</span>
          ))}
        </div>

        {/* Trust strip */}
        <div className="login-trust">
          <span>No credit card</span>
          <span className="login-trust-dot" />
          <span>No setup friction</span>
          <span className="login-trust-dot" />
        </div>
      </div>

      <Link href="/" className="login-back">← back to voluma</Link>
    </div>
  );
}