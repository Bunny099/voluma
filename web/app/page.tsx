'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';


function Counter({ end, suffix = '', duration = 2200 }: { end: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - t0) / duration, 1);
          const ease = 1 - Math.pow(1 - p, 4);
          setVal(Math.round(ease * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end, duration]);

  return <span ref={ref}>{val.toLocaleString()}{suffix}</span>;
}


const FEED_EVENTS = [
  { kind: 'SWAP',    token: 'BONK', sig: '7xKXmN…bc34', ms: '142ms' },
  { kind: 'TRIGGER', token: 'BONK', sig: '9mRQpL…ef21', ms: '189ms', label: 'SWAP BURST ⚡' },
  { kind: 'TRADE',   token: 'BONK', sig: 'Ax9TrK…4d8c', ms: '334ms', label: '◎ 0.5 SOL AUTO-BUY' },
  { kind: 'SWAP',    token: 'JUP',  sig: '4pLNwX…aa78', ms: '211ms' },
  { kind: 'SWAP',    token: 'SOL',  sig: '2vYTkQ…cc90', ms: '287ms' },
  { kind: 'TRIGGER', token: 'SOL',  sig: '3bSKnL…hh34', ms: '498ms', label: 'LARGE TRANSFER ⚡' },
  { kind: 'SWAP',    token: 'USDC', sig: '5nXWmP…ff56', ms: '401ms' },
  { kind: 'SWAP',    token: 'JUP',  sig: '1aRMvK…gg89', ms: '445ms' },
];

function TerminalFeed() {
  const [rows, setRows] = useState<typeof FEED_EVENTS>([]);
  const idx = useRef(0);

  useEffect(() => {
    const t = setInterval(() => {
      const next = FEED_EVENTS[idx.current % FEED_EVENTS.length];
      setRows(prev => [next, ...prev].slice(0, 8));
      idx.current++;
    }, 820);
    return () => clearInterval(t);
  }, []);

  const kindColor: Record<string, string> = {
    SWAP:    '#4a90d9',
    TRIGGER: '#d4ff00',
    TRADE:   '#00e676',
  };

  return (
    <div className="lp-term">
     
      <div className="lp-term-chrome">
        <div className="lp-term-dots">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#ffbd2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <span className="lp-term-name">voluma / live-mainnet</span>
        <div className="lp-term-badge">
          <span className="lp-term-pulse" />
          LIVE
        </div>
      </div>

    
      <div className="lp-term-cols">
        <span>TYPE</span><span>SIGNATURE</span><span>TOKEN</span><span>LATENCY</span>
      </div>

    
      <div className="lp-term-body">
        {rows.length === 0 && (
          <div className="lp-term-empty">Connecting to Solana mainnet…</div>
        )}
        {rows.map((ev, i) => (
          <div
            key={`${ev.sig}-${i}`}
            className={`lp-term-row${i === 0 ? ' lp-term-row-new' : ''}${ev.kind === 'TRIGGER' ? ' lp-term-row-trigger' : ev.kind === 'TRADE' ? ' lp-term-row-trade' : ''}`}
          >
            <span className="lp-term-kind" style={{ color: kindColor[ev.kind] ?? '#4a90d9' }}>
              {ev.kind}
            </span>
            <span className="lp-term-sig">{ev.sig}</span>
            <span className="lp-term-token">{ev.token}</span>
            <span className="lp-term-ms">{ev.ms}</span>
            {ev.label && <span className="lp-term-label">{ev.label}</span>}
          </div>
        ))}
      </div>

     
      <div className="lp-term-foot">
        <span>Simulated feed · Live on Solana mainnet</span>
        <span className="lp-term-foot-r">~4.2M daily tx on Solana</span>
      </div>
    </div>
  );
}


function VolumaLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="rgba(212,255,0,0.08)" />
      <polyline points="6,10 16,22 26,10" fill="none" stroke="#d4ff00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6"  cy="10" r="2.5" fill="#d4ff00" />
      <circle cx="16" cy="22" r="2.5" fill="#d4ff00" opacity="0.5"/>
      <circle cx="26" cy="10" r="2.5" fill="#d4ff00" />
    </svg>
  );
}


export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <div className="lp">

      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');

        /* ── Reset & base ── */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .lp {
          font-family: 'DM Sans', system-ui, sans-serif;
          background: #070b10;
          color: #e8ecf0;
          overflow-x: hidden;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }

        /* ── Typography ── */
        .lp-display {
          font-family: 'Bebas Neue', sans-serif;
          letter-spacing: 0.01em;
          line-height: 0.92;
          text-transform: uppercase;
        }
        .lp-mono { font-family: 'JetBrains Mono', 'Courier New', monospace; }

        /* ── Colors ── */
        .lp-accent   { color: #d4ff00; }
        .lp-muted    { color: #5c6472; }
        .lp-dim      { color: #8a939f; }

        /* ── Noise overlay ── */
        .lp::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
          opacity: 0.022;
          pointer-events: none;
          z-index: 0;
        }

        /* ───── NAV ───── */
        .lp-nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          padding: 0 2rem;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: background 0.3s, border-color 0.3s;
        }
        .lp-nav-scrolled {
          background: rgba(7,11,16,0.92);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .lp-nav-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          color: inherit;
        }
        .lp-nav-wordmark {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.4rem;
          letter-spacing: 0.08em;
          color: #e8ecf0;
        }
        .lp-nav-links {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .lp-nav-link {
          font-size: 0.8rem;
          font-weight: 500;
          color: #5c6472;
          text-decoration: none;
          padding: 7px 14px;
          border-radius: 6px;
          letter-spacing: 0.02em;
          transition: color 0.2s;
        }
        .lp-nav-link:hover { color: #e8ecf0; }
        .lp-nav-cta {
          font-family: 'DM Sans', sans-serif;
          font-size: 0.8rem;
          font-weight: 600;
          color: #070b10;
          background: #d4ff00;
          text-decoration: none;
          padding: 8px 20px;
          border-radius: 6px;
          letter-spacing: 0.03em;
          transition: opacity 0.2s, transform 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .lp-nav-cta:hover { opacity: 0.88; transform: translateY(-1px); }

        /* ───── HERO ───── */
        .lp-hero {
          position: relative;
          min-height: 100svh;
          display: grid;
          grid-template-columns: 1fr 1fr;
          align-items: center;
          padding: 100px 4rem 80px;
          gap: 4rem;
          overflow: hidden;
        }

        /* Grid line background */
        .lp-hero::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px);
          background-size: 64px 64px;
          pointer-events: none;
          mask-image: radial-gradient(ellipse 80% 60% at 50% 50%, black 0%, transparent 100%);
        }

        .lp-hero-left {
          position: relative;
          z-index: 1;
          animation: lp-fadeup 0.8s ease-out both;
        }
        .lp-hero-right {
          position: relative;
          z-index: 1;
          animation: lp-fadeup 0.8s ease-out 0.2s both;
        }

        .lp-hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #d4ff00;
          background: rgba(212,255,0,0.08);
          border: 1px solid rgba(212,255,0,0.2);
          padding: 6px 14px 6px 10px;
          border-radius: 100px;
          margin-bottom: 1.8rem;
        }
        .lp-hero-eyebrow-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #d4ff00;
          animation: lp-blink 1.8s ease-in-out infinite;
        }

        .lp-hero-h1 {
          font-size: clamp(4.5rem, 8vw, 8.5rem);
          margin-bottom: 0.6rem;
        }
        .lp-hero-h1-line { display: block; }
        .lp-hero-h1-accent {
          display: block;
          color: #d4ff00;
          /* subtle glow */
          text-shadow: 0 0 60px rgba(212,255,0,0.25);
        }

        .lp-hero-sub {
          font-size: 1.05rem;
          font-weight: 400;
          color: #6e7886;
          line-height: 1.65;
          max-width: 460px;
          margin: 1.6rem 0 2.4rem;
        }
        .lp-hero-sub strong { color: #b0bac6; font-weight: 500; }

        .lp-hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-bottom: 3rem;
        }

        .lp-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: #d4ff00;
          color: #070b10;
          font-family: 'DM Sans', sans-serif;
          font-size: 0.875rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          padding: 13px 28px;
          border-radius: 8px;
          text-decoration: none;
          transition: opacity 0.2s, transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 0 0 rgba(212,255,0,0);
        }
        .lp-btn-primary:hover {
          opacity: 0.9;
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(212,255,0,0.22);
        }

        .lp-btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #8a939f;
          font-family: 'DM Sans', sans-serif;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 13px 24px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          text-decoration: none;
          transition: color 0.2s, border-color 0.2s, background 0.2s;
        }
        .lp-btn-ghost:hover {
          color: #e8ecf0;
          border-color: rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.04);
        }

        .lp-hero-stats {
          display: flex;
          gap: 2rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(255,255,255,0.07);
        }
        .lp-hero-stat {}
        .lp-hero-stat-num {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 2rem;
          line-height: 1;
          color: #e8ecf0;
          letter-spacing: 0.03em;
        }
        .lp-hero-stat-label {
          font-size: 0.72rem;
          color: #4a5260;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-top: 4px;
          font-weight: 500;
        }

        /* ───── TERMINAL ───── */
        .lp-term {
          background: #0a0f16;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 14px;
          overflow: hidden;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.72rem;
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.04),
            0 24px 80px rgba(0,0,0,0.5),
            0 0 60px rgba(212,255,0,0.04);
        }
        .lp-term-chrome {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: rgba(255,255,255,0.03);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .lp-term-dots { display: flex; gap: 6px; }
        .lp-term-dots span {
          width: 10px; height: 10px;
          border-radius: 50%;
          display: block;
        }
        .lp-term-name {
          flex: 1;
          font-size: 0.7rem;
          color: #3d4452;
          letter-spacing: 0.04em;
        }
        .lp-term-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #d4ff00;
          background: rgba(212,255,0,0.08);
          border: 1px solid rgba(212,255,0,0.18);
          padding: 3px 8px 3px 6px;
          border-radius: 100px;
        }
        .lp-term-pulse {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: #d4ff00;
          animation: lp-blink 1.4s ease-in-out infinite;
        }
        .lp-term-cols {
          display: grid;
          grid-template-columns: 70px 1fr 60px 72px;
          gap: 0;
          padding: 8px 16px;
          background: rgba(255,255,255,0.02);
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .lp-term-cols span {
          font-size: 0.62rem;
          font-weight: 700;
          color: #2e3540;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .lp-term-body {
          min-height: 260px;
          padding: 4px 0;
        }
        .lp-term-empty {
          padding: 40px 16px;
          color: #2e3540;
          font-size: 0.72rem;
          text-align: center;
        }
        .lp-term-row {
          display: grid;
          grid-template-columns: 70px 1fr 60px 72px;
          gap: 0;
          padding: 7px 16px;
          border-left: 2px solid transparent;
          transition: background 0.2s;
          position: relative;
        }
        .lp-term-row:hover { background: rgba(255,255,255,0.02); }
        .lp-term-row-new {
          animation: lp-termslide 0.35s ease-out both;
        }
        .lp-term-row-trigger {
          border-left-color: #d4ff00;
          background: rgba(212,255,0,0.03);
        }
        .lp-term-row-trade {
          border-left-color: #00e676;
          background: rgba(0,230,118,0.03);
        }
        .lp-term-kind {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        .lp-term-sig { color: #2e3540; font-size: 0.68rem; }
        .lp-term-token { color: #5c6472; font-size: 0.68rem; }
        .lp-term-ms { color: #2e3540; font-size: 0.68rem; text-align: right; }
        .lp-term-label {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.62rem;
          font-weight: 700;
          color: #d4ff00;
          letter-spacing: 0.06em;
          background: rgba(212,255,0,0.08);
          padding: 2px 7px;
          border-radius: 4px;
        }
        .lp-term-row-trade .lp-term-label {
          color: #00e676;
          background: rgba(0,230,118,0.08);
        }
        .lp-term-foot {
          display: flex;
          justify-content: space-between;
          padding: 10px 16px;
          border-top: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.015);
          font-size: 0.62rem;
          color: #2e3540;
          letter-spacing: 0.04em;
        }
        .lp-term-foot-r { color: #d4ff00; opacity: 0.5; }

        /* ───── TICKER ───── */
        .lp-ticker-wrap {
          overflow: hidden;
          border-top: 1px solid rgba(255,255,255,0.06);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.018);
          padding: 13px 0;
        }
        .lp-ticker {
          display: flex;
          gap: 0;
          width: max-content;
          animation: lp-ticker 28s linear infinite;
        }
        .lp-ticker-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 2.5rem;
          border-right: 1px solid rgba(255,255,255,0.07);
          white-space: nowrap;
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #3a4252;
        }
        .lp-ticker-item span { color: #e8ecf0; font-weight: 700; }
        .lp-ticker-dot { width: 5px; height: 5px; border-radius: 50%; background: #d4ff00; opacity: 0.5; }

        /* ───── SECTION WRAPPER ───── */
        .lp-section {
          padding: 6rem 4rem;
          position: relative;
        }
        .lp-section-sm { padding: 4rem 4rem; }
        .lp-container { max-width: 1180px; margin: 0 auto; }

        .lp-section-eyebrow {
          display: inline-block;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #d4ff00;
          margin-bottom: 1.2rem;
          opacity: 0.85;
        }
        .lp-section-h2 {
          font-size: clamp(2.6rem, 4.5vw, 4.8rem);
          margin-bottom: 1rem;
        }
        .lp-section-lead {
          font-size: 1rem;
          color: #5c6472;
          line-height: 1.7;
          max-width: 540px;
        }

        /* ───── STATS BAR ───── */
        .lp-statsbar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255,255,255,0.02);
        }
        .lp-statsbar-item {
          padding: 2.2rem 2rem;
          border-right: 1px solid rgba(255,255,255,0.07);
          position: relative;
          overflow: hidden;
        }
        .lp-statsbar-item:last-child { border-right: none; }
        .lp-statsbar-item::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, #d4ff00, transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .lp-statsbar-item:hover::after { opacity: 0.4; }
        .lp-statsbar-num {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 3rem;
          line-height: 1;
          letter-spacing: 0.04em;
          color: #e8ecf0;
          margin-bottom: 0.4rem;
        }
        .lp-statsbar-label {
          font-size: 0.72rem;
          font-weight: 500;
          color: #3d4452;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .lp-statsbar-sub {
          font-size: 0.68rem;
          color: #2c3340;
          margin-top: 6px;
          font-family: 'JetBrains Mono', monospace;
        }

        /* ───── HOW IT WORKS ───── */
        .lp-steps {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          overflow: hidden;
          margin-top: 3.5rem;
        }
        .lp-step {
          background: #070b10;
          padding: 2.5rem 2.2rem;
          position: relative;
          transition: background 0.3s;
        }
        .lp-step:hover { background: rgba(255,255,255,0.02); }
        .lp-step-num {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 5rem;
          line-height: 1;
          color: rgba(255,255,255,0.04);
          position: absolute;
          top: 1.2rem;
          right: 1.5rem;
          letter-spacing: 0.04em;
          pointer-events: none;
          transition: color 0.3s;
        }
        .lp-step:hover .lp-step-num { color: rgba(212,255,0,0.06); }
        .lp-step-icon {
          width: 44px; height: 44px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          margin-bottom: 1.2rem;
          background: rgba(255,255,255,0.03);
        }
        .lp-step-label {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #d4ff00;
          opacity: 0.7;
          margin-bottom: 0.6rem;
        }
        .lp-step-h3 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.6rem;
          letter-spacing: 0.04em;
          color: #e8ecf0;
          margin-bottom: 0.7rem;
        }
        .lp-step-desc {
          font-size: 0.85rem;
          color: #4a5260;
          line-height: 1.65;
        }

        /* ───── FEATURES ───── */
        .lp-features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          overflow: hidden;
          margin-top: 3.5rem;
        }
        .lp-feature {
          background: #070b10;
          padding: 2rem 2rem;
          position: relative;
          overflow: hidden;
          transition: background 0.25s;
        }
        .lp-feature:hover { background: rgba(255,255,255,0.025); }
        .lp-feature-accent-line {
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: transparent;
          transition: background 0.3s;
        }
        .lp-feature:hover .lp-feature-accent-line {
          background: linear-gradient(90deg, transparent, rgba(212,255,0,0.4), transparent);
        }
        .lp-feature-icon {
          font-size: 1.5rem;
          margin-bottom: 1rem;
          display: block;
        }
        .lp-feature-h3 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.25rem;
          letter-spacing: 0.06em;
          color: #c4ccd6;
          margin-bottom: 0.5rem;
        }
        .lp-feature-desc {
          font-size: 0.83rem;
          color: #3d4452;
          line-height: 1.62;
        }
        .lp-feature-tag {
          display: inline-block;
          margin-top: 1rem;
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #d4ff00;
          opacity: 0.5;
          font-family: 'JetBrains Mono', monospace;
        }

        /* ───── CONDITIONS SHOWCASE ───── */
        .lp-conditions {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-top: 3.5rem;
        }
        .lp-cond-card {
          background: #0a0f16;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 1.8rem;
          transition: border-color 0.3s, transform 0.25s;
          cursor: default;
        }
        .lp-cond-card:hover {
          border-color: rgba(212,255,0,0.2);
          transform: translateY(-2px);
        }
        .lp-cond-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 1rem;
        }
        .lp-cond-badge {
          font-size: 0.63rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 100px;
          font-family: 'JetBrains Mono', monospace;
        }
        .lp-cond-badge-violet { background: rgba(167,139,250,0.1); color: #a78bfa; border: 1px solid rgba(167,139,250,0.2); }
        .lp-cond-badge-amber  { background: rgba(251,191,36,0.1);  color: #fbbf24; border: 1px solid rgba(251,191,36,0.2); }
        .lp-cond-badge-cyan   { background: rgba(34,211,238,0.1);  color: #22d3ee; border: 1px solid rgba(34,211,238,0.2); }
        .lp-cond-badge-red    { background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }
        .lp-cond-status {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.65rem;
          font-weight: 600;
          color: #d4ff00;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.06em;
        }
        .lp-cond-status-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: #d4ff00;
          animation: lp-blink 2s ease-in-out infinite;
        }
        .lp-cond-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.4rem;
          letter-spacing: 0.05em;
          color: #e8ecf0;
          margin-bottom: 0.6rem;
        }
        .lp-cond-desc {
          font-size: 0.82rem;
          color: #3d4452;
          line-height: 1.6;
          margin-bottom: 1rem;
        }
        .lp-cond-params {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .lp-cond-param {
          font-size: 0.65rem;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          padding: 4px 10px;
          border-radius: 6px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          color: #5c6472;
          letter-spacing: 0.04em;
        }
        .lp-cond-action {
          margin-top: 1.2rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.06em;
        }
        .lp-cond-action-icon {
          width: 24px; height: 24px;
          border-radius: 6px;
          background: rgba(212,255,0,0.1);
          border: 1px solid rgba(212,255,0,0.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 0.75rem;
        }
        .lp-cond-action-text { color: #d4ff00; }

        /* ───── ARCHITECTURE ───── */
        .lp-arch {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4rem;
          align-items: center;
          margin-top: 3rem;
        }
        .lp-arch-flow {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .lp-arch-step {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.1rem 1.4rem;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          margin-bottom: 4px;
          transition: border-color 0.3s, background 0.3s;
        }
        .lp-arch-step:hover {
          border-color: rgba(212,255,0,0.15);
          background: rgba(212,255,0,0.02);
        }
        .lp-arch-step-n {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.4rem;
          color: rgba(255,255,255,0.08);
          letter-spacing: 0.04em;
          min-width: 2rem;
        }
        .lp-arch-step-info {}
        .lp-arch-step-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #c4ccd6;
          margin-bottom: 2px;
        }
        .lp-arch-step-detail {
          font-size: 0.75rem;
          color: #3d4452;
          font-family: 'JetBrains Mono', monospace;
        }
        .lp-arch-arrow {
          display: flex;
          justify-content: flex-start;
          padding: 0 1.4rem;
          margin: -2px 0;
          color: rgba(212,255,0,0.2);
          font-size: 0.8rem;
          font-family: 'JetBrains Mono', monospace;
        }
        .lp-arch-checklist {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .lp-arch-check {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
          padding: 1.2rem 1.5rem;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
        }
        .lp-arch-check-icon {
          width: 20px; height: 20px;
          border-radius: 50%;
          background: rgba(212,255,0,0.12);
          border: 1px solid rgba(212,255,0,0.25);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .lp-arch-check-icon svg { width: 9px; height: 9px; }
        .lp-arch-check-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #b0bac6;
          margin-bottom: 3px;
        }
        .lp-arch-check-sub { font-size: 0.78rem; color: #3d4452; }

        /* ───── CTA SECTION ───── */
        .lp-cta {
          position: relative;
          overflow: hidden;
          padding: 8rem 4rem;
          text-align: center;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .lp-cta::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 50% 100%, rgba(212,255,0,0.06) 0%, transparent 100%);
          pointer-events: none;
        }
        .lp-cta-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 70% 60% at 50% 100%, black, transparent);
          pointer-events: none;
        }
        .lp-cta-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #d4ff00;
          opacity: 0.8;
          margin-bottom: 1.5rem;
        }
        .lp-cta-h2 {
          font-size: clamp(3rem, 6vw, 6.5rem);
          color: #e8ecf0;
          margin-bottom: 1rem;
          position: relative;
          z-index: 1;
        }
        .lp-cta-sub {
          font-size: 1.05rem;
          color: #4a5260;
          margin-bottom: 2.5rem;
          position: relative;
          z-index: 1;
          max-width: 500px;
          margin-left: auto;
          margin-right: auto;
        }
        .lp-cta-actions {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
          position: relative;
          z-index: 1;
        }

        /* ───── FOOTER ───── */
        .lp-footer {
          padding: 1.8rem 4rem;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .lp-footer-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
        }
        .lp-footer-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 1.1rem;
          letter-spacing: 0.08em;
          color: #3d4452;
        }
        .lp-footer-copy { font-size: 0.73rem; color: #252d38; }
        .lp-footer-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          color: #2e3540;
          font-family: 'JetBrains Mono', monospace;
        }
        .lp-footer-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #d4ff00;
          opacity: 0.4;
        }

        /* ───── DIVIDER ───── */
        .lp-rule {
          border: none;
          border-top: 1px solid rgba(255,255,255,0.06);
          margin: 0;
        }

        /* ───── ANIMATIONS ───── */
        @keyframes lp-fadeup {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes lp-fadein {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lp-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes lp-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes lp-termslide {
          from { opacity: 0; transform: translateY(-6px); background: rgba(212,255,0,0.04); }
          to   { opacity: 1; transform: translateY(0); background: transparent; }
        }
        @keyframes lp-glow {
          0%, 100% { text-shadow: 0 0 40px rgba(212,255,0,0.15); }
          50%       { text-shadow: 0 0 80px rgba(212,255,0,0.35); }
        }

        /* ───── RESPONSIVE ───── */
        @media (max-width: 1024px) {
          .lp-hero { grid-template-columns: 1fr; padding: 100px 2.5rem 60px; }
          .lp-hero-right { display: none; }
          .lp-features-grid { grid-template-columns: repeat(2, 1fr); }
          .lp-statsbar { grid-template-columns: repeat(2, 1fr); }
          .lp-arch { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
          .lp-section { padding: 4rem 1.5rem; }
          .lp-hero { padding: 90px 1.5rem 50px; }
          .lp-hero-h1 { font-size: clamp(3.5rem, 14vw, 5rem); }
          .lp-steps { grid-template-columns: 1fr; }
          .lp-features-grid { grid-template-columns: 1fr; }
          .lp-conditions { grid-template-columns: 1fr; }
          .lp-statsbar { grid-template-columns: 1fr 1fr; }
          .lp-footer { flex-direction: column; gap: 12px; text-align: center; padding: 1.5rem; }
          .lp-nav { padding: 0 1.2rem; }
          .lp-cta { padding: 5rem 1.5rem; }
          .lp-hero-stats { gap: 1.5rem; }
        }
      `}</style>

      
      <nav className={`lp-nav${scrolled ? ' lp-nav-scrolled' : ''}`}>
        <Link href="/" className="lp-nav-brand">
          <VolumaLogo size={30} />
          <span className="lp-nav-wordmark">Voluma</span>
        </Link>
        <div className="lp-nav-links">
          <Link href="/dashboard" className="lp-nav-link">Dashboard</Link>
          <Link href="/dashboard" className="lp-nav-cta">
            Launch App
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 9.5L9.5 2.5M9.5 2.5H4M9.5 2.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </Link>
        </div>
      </nav>

    
      <section className="lp-hero">
        <div className="lp-hero-left">

          <div className="lp-hero-eyebrow">
            <span className="lp-hero-eyebrow-dot" />
            Live on Solana Mainnet
          </div>

          <h1 className="lp-display lp-hero-h1">
            <span className="lp-hero-h1-line">Automate</span>
            <span className="lp-hero-h1-line">Your Solana</span>
            <span className="lp-hero-h1-accent" style={{animation:'lp-glow 3s ease-in-out infinite'}}>
              Trades.
            </span>
          </h1>

          <p className="lp-hero-sub">
            Monitor wallets, detect swap bursts and volume spikes in <strong>real-time</strong>.
            Execute trades automatically — no code, no bots, no delays.
            Just pure <strong>on-chain signals</strong>.
          </p>

          <div className="lp-hero-actions">
            <Link href="/dashboard" className="lp-btn-primary">
              Launch Dashboard
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 11L11 3M11 3H5.5M11 3V8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </Link>
            <Link href="/dashboard" className="lp-btn-ghost">
              Watch it work
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5.5 5L9 7L5.5 9V5Z" fill="currentColor"/>
              </svg>
            </Link>
          </div>

          <div className="lp-hero-stats">
            {[
              { end: 4200000, suffix: '+', label: 'Transactions / day' },
              { end: 50, suffix: 'ms', label: 'Avg match latency' },
              { end: 4, suffix: '', label: 'Condition types' },
            ].map(s => (
              <div className="lp-hero-stat" key={s.label}>
                <div className="lp-hero-stat-num">
                  <Counter end={s.end} suffix={s.suffix} />
                </div>
                <div className="lp-hero-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="lp-hero-right">
          <TerminalFeed />
        </div>
      </section>

      <div className="lp-ticker-wrap">
        <div className="lp-ticker">
          {[...Array(2)].map((_, ri) =>
            [
              { label: 'Solana Daily Tx',     val: '~4.2M' },
              { label: 'Match Latency',        val: '<50ms' },
              { label: 'Condition Types',      val: '4' },
              { label: 'Cost Per Trade',       val: '$0' },
              { label: 'Uptime',               val: '99.9%' },
              { label: 'DEX',                  val: 'Jupiter' },
            ].map(item => (
              <div className="lp-ticker-item" key={`${ri}-${item.label}`}>
                <span className="lp-ticker-dot" />
                {item.label}&nbsp;&nbsp;<span>{item.val}</span>
              </div>
            ))
          )}
        </div>
      </div>

    
      <section className="lp-section lp-section-sm">
        <div className="lp-container">
          <div className="lp-statsbar">
            {[
              { num: 4200000, suffix: '+', label: 'Solana Daily TX',    sub: 'Network volume (not Voluma)' },
              { num: 50,      suffix: 'ms', label: 'Condition Match',   sub: 'Inverted index engine' },
              { num: 500,     suffix: 'ms', label: 'Trade Execution',   sub: 'Jupiter → confirm' },
              { num: 0,       suffix: '%',  label: 'Cost Per Trade',    sub: 'You keep every gain' },
            ].map(s => (
              <div className="lp-statsbar-item" key={s.label}>
                <div className="lp-statsbar-num lp-display">
                  {s.num === 0 ? '0' : <Counter end={s.num} suffix={s.suffix} />}
                  {s.num === 0 && s.suffix}
                </div>
                <div className="lp-statsbar-label">{s.label}</div>
                <div className="lp-statsbar-sub lp-mono">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="lp-rule" />

      <section className="lp-section">
        <div className="lp-container">
          <span className="lp-section-eyebrow">How it works</span>
          <h2 className="lp-display lp-section-h2">
            Define. Monitor.<br />
            <span className="lp-accent">Execute.</span>
          </h2>
          <p className="lp-section-lead">
            Three steps between you and fully automated Solana trading. Setup takes under 60 seconds.
          </p>

          <div className="lp-steps">
            {[
              {
                n: '01', icon: '⚙️', step: 'Step one',
                title: 'Define Your Condition',
                desc: 'Pick a trigger: wallet activity, swap burst, volume spike, or large transfer. Set thresholds, time windows, and the token you want to watch.',
              },
              {
                n: '02', icon: '📡', step: 'Step two',
                title: 'Monitor The Chain',
                desc: 'Voluma streams Solana mainnet transactions in real-time — 4.2M+ per day — evaluating every event against your conditions in milliseconds.',
              },
              {
                n: '03', icon: '⚡', step: 'Step three',
                title: 'Automatic Execution',
                desc: 'Condition matched. Action fires instantly — push notification, HTTP webhook, or a real BUY/SELL trade on Jupiter DEX. Automated on-chain execution.',
              },
            ].map(s => (
              <div className="lp-step" key={s.n}>
                <div className="lp-step-num">{s.n}</div>
                <div className="lp-step-icon">{s.icon}</div>
                <div className="lp-step-label">{s.step}</div>
                <div className="lp-step-h3 lp-display">{s.title}</div>
                <p className="lp-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="lp-rule" />

     
      <section className="lp-section">
        <div className="lp-container">
          <span className="lp-section-eyebrow">Condition types</span>
          <h2 className="lp-display lp-section-h2">
            4 triggers.<br />
            <span className="lp-accent">Infinite strategies.</span>
          </h2>
          <p className="lp-section-lead">
            Each condition type maps to a distinct market signal. Combine them with any action for full trading automation.
          </p>

          <div className="lp-conditions">
            {[
              {
                badge: 'lp-cond-badge-violet', type: 'WALLET_ACTIVITY',
                name: 'Wallet Activity',
                desc: 'Monitor any Solana wallet for transactions the moment they confirm. Set minimum amounts, filter by BUY/SELL/TRANSFER.',
                params: ['wallet: 7xKX…bc34', 'type: BUY', 'min: 0.5 SOL'],
                action: 'Auto-buy BONK on whale move',
              },
              {
                badge: 'lp-cond-badge-amber', type: 'SWAP_BURST',
                name: 'Swap Burst',
                desc: 'Detect when a token reaches N swaps within a configurable time window. Catch momentum before it moves.',
                params: ['token: BONK', 'min_swaps: 50', 'window: 30s'],
                action: 'Buy 0.5 SOL on burst signal',
              },
              {
                badge: 'lp-cond-badge-cyan', type: 'TOKEN_VOLUME',
                name: 'Volume Spike',
                desc: 'Track total SOL volume through any token in real-time with precise sliding-window counters.',
                params: ['token: USDC', 'min_vol: 1000 SOL', 'window: 60s'],
                action: 'Webhook → Discord alert',
              },
              {
                badge: 'lp-cond-badge-red', type: 'LARGE_TRANSFER',
                name: 'Large Transfer',
                desc: 'Fire when any transfer exceeds a SOL threshold. Catch whale moves, treasury flows, and ecosystem shifts.',
                params: ['threshold: 100 SOL', 'global watch'],
                action: 'Push notification instantly',
              },
            ].map(c => (
              <div className="lp-cond-card" key={c.type}>
                <div className="lp-cond-header">
                  <span className={`lp-cond-badge ${c.badge}`}>{c.type}</span>
                  <div className="lp-cond-status">
                    <span className="lp-cond-status-dot" />
                    ACTIVE
                  </div>
                </div>
                <div className="lp-cond-name lp-display">{c.name}</div>
                <p className="lp-cond-desc">{c.desc}</p>
                <div className="lp-cond-params">
                  {c.params.map(p => (
                    <span className="lp-cond-param lp-mono" key={p}>{p}</span>
                  ))}
                </div>
                <div className="lp-cond-action">
                  <div className="lp-cond-action-icon">⚡</div>
                  <span className="lp-cond-action-text">{c.action}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="lp-rule" />

      
      <section className="lp-section">
        <div className="lp-container">
          <span className="lp-section-eyebrow">Platform capabilities</span>
          <h2 className="lp-display lp-section-h2">
            Everything built in.<br />
            <span className="lp-accent">Nothing bolted on.</span>
          </h2>

          <div className="lp-features-grid">
            {[
              {
                icon: '◎',
                title: 'Jupiter DEX Trades',
                desc: 'Execute real BUY/SELL orders via Jupiter DEX aggregator when conditions fire. Dedicated wallet per user with encrypted key storage.',
                tag: 'auto-execution',
              },
              {
                icon: '📡',
                title: 'Real-Time Ingestion',
                desc: 'Single WebSocket connection to Solana mainnet streams all DEX activity. No polling. No RPC spam. Sub-second event delivery.',
                tag: 'ingestion-layer',
              },
              {
                icon: '🔒',
                title: 'Encrypted Key Storage',
                desc: 'Private keys are AES-256-CBC encrypted and stored server-side. Server decrypts only during trade execution.',
                tag: 'security',
              },
              {
                icon: '🔗',
                title: 'Webhook Delivery',
                desc: 'Fire any HTTP endpoint with full trigger context. Retry logic, idempotency keys, delivery receipts included.',
                tag: 'integrations',
              },
              {
                icon: '🛡️',
                title: 'Trade Guard System',
                desc: 'Rate limiting, balance checks, slippage caps, dedup cache. Every trade is safe-guarded before execution.',
                tag: 'safety',
              },
              {
                icon: '📊',
                title: 'Live System Stats',
                desc: 'Real-time monitoring: queue depth, event drop rate, trade success rate, WebSocket connections, uptime.',
                tag: 'observability',
              },
            ].map(f => (
              <div className="lp-feature" key={f.title}>
                <div className="lp-feature-accent-line" />
                <span className="lp-feature-icon">{f.icon}</span>
                <div className="lp-feature-h3 lp-display">{f.title}</div>
                <p className="lp-feature-desc">{f.desc}</p>
                <span className="lp-feature-tag lp-mono">#{f.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="lp-rule" />

      
      <section className="lp-section">
        <div className="lp-container">
          <span className="lp-section-eyebrow">System design</span>
          <h2 className="lp-display lp-section-h2">
            Built for speed.<br />
            <span className="lp-accent">Engineered to scale.</span>
          </h2>

          <div className="lp-arch">
            <div className="lp-arch-flow">
              {[
                { n: '01', title: 'WebSocket Ingestion', detail: 'logsSubscribe → 5 DEX programs' },
                { n: '02', title: 'Condition Engine',    detail: 'inverted index · sliding windows' },
                { n: '03', title: 'Execution Pipeline',  detail: 'guard checks · Jupiter quote' },
                { n: '04', title: 'WS Broadcast',        detail: 'user rooms · real-time push' },
              ].map((s, i, arr) => (
                <div key={s.n}>
                  <div className="lp-arch-step">
                    <span className="lp-arch-step-n lp-display">{s.n}</span>
                    <div className="lp-arch-step-info">
                      <div className="lp-arch-step-title">{s.title}</div>
                      <div className="lp-arch-step-detail lp-mono">{s.detail}</div>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="lp-arch-arrow lp-mono">↓ &lt;20ms</div>
                  )}
                </div>
              ))}
            </div>

          
            <div className="lp-arch-checklist">
              {[
                {
                  title: 'Zero infrastructure cost',
                  sub: 'Public Solana RPC handles all data. You pay $0 to run.'
                },
                {
                  title: 'Idempotent delivery',
                  sub: 'Fire cache + delivery dedup prevents double-execution.'
                },
                {
                  title: 'Horizontal scaling ready',
                  sub: 'Stateless condition engine supports multi-node expansion.'
                },
                {
                  title: 'Encrypted wallet storage',
                  sub: 'AES-256-CBC encrypted keys stored server-side. Server signs trades on behalf of users.'
                },
                {
                  title: 'Pluggable ingestion layer',
                  sub: 'Yellowstone gRPC provider stub ready — drop-in upgrade.'
                },
              ].map(c => (
                <div className="lp-arch-check" key={c.title}>
                  <div className="lp-arch-check-icon">
                    <svg viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5L3.2 5.8L8 1" stroke="#d4ff00" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="lp-arch-check-title">{c.title}</div>
                    <div className="lp-arch-check-sub">{c.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    
      <section className="lp-cta">
        <div className="lp-cta-grid" />
        <div className="lp-container" style={{position:'relative', zIndex:1}}>
          <div className="lp-cta-eyebrow">
            <span style={{display:'inline-block', width:6, height:6, borderRadius:'50%', background:'#d4ff00', marginRight:4}} />
            Ready to automate
          </div>
          <h2 className="lp-display lp-cta-h2">
            Your first automation<br/>
            <span className="lp-accent">goes live in 60 seconds.</span>
          </h2>
          <p className="lp-cta-sub">
            No signup. No API keys. No cost. Just connect your condition and watch Voluma work.
          </p>
          <div className="lp-cta-actions">
            <Link href="/dashboard" className="lp-btn-primary" style={{fontSize:'0.95rem', padding:'15px 36px', borderRadius:10}}>
              Open Dashboard — Free
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 13L13 3M13 3H6M13 3V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

     
      <footer className="lp-footer">
        <Link href="/" className="lp-footer-brand">
          <VolumaLogo size={22} />
          <span className="lp-footer-name">Voluma</span>
        </Link>
        <span className="lp-footer-copy">Built on Solana · Colosseum Frontier 2026</span>
        <div className="lp-footer-status">
          <span className="lp-footer-dot" />
          Mainnet · Live
        </div>
      </footer>

    </div>
  );
}