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
  const router                      = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [loading, setLoading]        = useState(false);

 
  useEffect(() => {
    if (!isPending && session) {
      router.push('/dashboard');
    }
  }, [session, isPending, router]);

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      await authClient.signIn.social({
        provider:    'google',
        callbackURL: '/dashboard',
      });
     
    } catch {
      setLoading(false);
    }
  };

  if (isPending) return null; 

  return (
    <div style={{
      minHeight:      '100vh',
      background:     '#070b10',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '20px',
      fontFamily:     "'DM Sans', system-ui, sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes lp-fadeup { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes lp-glow   { 0%,100% { box-shadow: 0 0 24px rgba(212,255,0,0.08); } 50% { box-shadow: 0 0 48px rgba(212,255,0,0.16); } }
        @keyframes lp-pulse  { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .login-card { animation: lp-fadeup 0.45s ease-out both, lp-glow 4s ease-in-out 0.5s infinite; }
        .google-btn:hover:not(:disabled) { opacity:0.92 !important; transform:translateY(-1px) !important; }
        .google-btn:active:not(:disabled) { transform:translateY(0) !important; }
        .back-link:hover { color:#8a939f !important; }
      `}</style>

      {/* Card */}
      <div
        className="login-card"
        style={{
          width:           '100%',
          maxWidth:        400,
          background:      'rgba(255,255,255,0.025)',
          border:          '1px solid rgba(255,255,255,0.08)',
          borderRadius:    20,
          padding:         '44px 36px 36px',
          textAlign:       'center',
        }}
      >
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginBottom:30 }}>
          <VolumaLogo size={36} />
          <span style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'2rem', letterSpacing:'0.1em', color:'#e8ecf0' }}>
            Voluma
          </span>
        </div>

        <p style={{ fontFamily:'Bebas Neue, sans-serif', fontSize:'1.35rem', letterSpacing:'0.06em', color:'#e8ecf0', marginBottom:8 }}>
          Sign in to continue
        </p>
        <p style={{ fontSize:'0.82rem', color:'#4a5260', marginBottom:28, lineHeight:1.65 }}>
          Real-time Solana automation. Define conditions,<br />monitor the chain, execute trades automatically.
        </p>

        
        <button
          className="google-btn"
          onClick={signInWithGoogle}
          disabled={loading}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            12,
            width:          '100%',
            padding:        '13px 20px',
            background:     loading ? 'rgba(255,255,255,0.06)' : '#ffffff',
            border:         'none',
            borderRadius:   10,
            cursor:         loading ? 'not-allowed' : 'pointer',
            fontFamily:     'DM Sans, sans-serif',
            fontSize:       '0.9rem',
            fontWeight:     600,
            color:          loading ? '#4a5260' : '#1a1a1a',
            transition:     'all 0.2s',
            opacity:        loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <>
              <div style={{ width:18, height:18, borderRadius:'50%', border:'2.5px solid rgba(0,0,0,0.12)', borderTopColor:'#1a1a1a', animation:'spin 0.7s linear infinite' }} />
              Signing in…
            </>
          ) : (
            <>
              {/* Official Google icon */}
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2045C17.64 8.5663 17.5827 7.9527 17.4764 7.3636H9V10.845H13.8436C13.635 11.97 13.0009 12.9231 12.0477 13.5613V15.8195H14.9564C16.6582 14.2527 17.64 11.9454 17.64 9.2045Z" fill="#4285F4"/>
                <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5613C11.2418 14.1013 10.2109 14.4204 9 14.4204C6.65591 14.4204 4.67182 12.8372 3.96409 10.71H0.957275V13.0418C2.43818 15.9831 5.48182 18 9 18Z" fill="#34A853"/>
                <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.5931 3.68182 9C3.68182 8.4068 3.78409 7.8299 3.96409 7.29V4.9581H0.957275C0.347727 6.1731 0 7.5477 0 9C0 10.4522 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
                <path d="M9 3.5795C10.3214 3.5795 11.5077 4.0336 12.4405 4.9254L15.0218 2.344C13.4632 0.8918 11.4259 0 9 0C5.48182 0 2.43818 2.0168 0.957275 4.9581L3.96409 7.29C4.67182 5.1627 6.65591 3.5795 9 3.5795Z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>

        <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>

        {/* Divider */}
        <div style={{ display:'flex', alignItems:'center', gap:12, margin:'24px 0 20px' }}>
          <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'0.58rem', color:'#e8ecf0', letterSpacing:'0.1em' }}>
            SECURE · ENCRYPTED · SOLANA
          </span>
          <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.06)' }} />
        </div>

      
        <div style={{ display:'flex', justifyContent:'center', flexWrap:'wrap', gap:6 }}>
          {['Real-time signals', 'AES-256 wallets', 'Jupiter DEX'].map(f => (
            <span key={f} style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   '0.58rem',
              fontWeight: 700,
              padding:    '3px 9px',
              borderRadius: 100,
              background: 'rgba(212,255,0,0.06)',
              border:     '1px solid rgba(212,255,0,0.14)',
              color:      'rgba(212,255,0,0.55)',
              letterSpacing: '0.06em',
            }}>
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Back to landing */}
      <Link
        href="/"
        className="back-link"
        style={{
          marginTop:   22,
          fontFamily:  'JetBrains Mono, monospace',
          fontSize:    '0.62rem',
          color:       '#e8ecf0',
          textDecoration: 'none',
          letterSpacing: '0.06em',
          transition:  'color 0.15s',
        }}
      >
        ← back to voluma
      </Link>
    </div>
  );
}