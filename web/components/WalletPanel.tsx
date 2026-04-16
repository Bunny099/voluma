'use client';
import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { Button }    from '@/components/ui/button';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function truncateAddress(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

interface Props { userId: string; }

export default function WalletPanel({ userId }: Props) {
  const { wallet, loading, creating, error, createWallet, refreshBalance } = useWallet(userId);
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-md mx-auto space-y-6">

        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Trading Wallet</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            A dedicated Solana keypair for automated trade execution
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg px-4 py-3">
            <p className="text-xs text-red-400 font-mono">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !wallet && (
          <div className="h-48 rounded-xl bg-zinc-800/50 animate-pulse" />
        )}

        {/* No wallet yet */}
        {!loading && !wallet && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto">
              <span className="text-2xl">◎</span>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-200">No trading wallet yet</p>
              <p className="text-xs text-zinc-500 mt-1">
                Create a wallet to enable automated BUY / SELL trades when conditions fire
              </p>
            </div>
            <Button
              onClick={createWallet}
              disabled={creating}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm h-9 px-6"
            >
              {creating ? 'Creating…' : 'Create Trading Wallet'}
            </Button>
          </div>
        )}

        {/* Wallet exists */}
        {wallet && (
          <div className="space-y-4">

            {/* Balance card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Solana Mainnet
                </span>
                <button
                  onClick={refreshBalance}
                  disabled={loading}
                  className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {loading ? '…' : '↻ refresh'}
                </button>
              </div>

              {/* Balance */}
              <div className="mb-4">
                <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider mb-1">Balance</p>
                <p className="text-3xl font-semibold text-zinc-100">
                  {wallet.balanceSol === null
                    ? <span className="text-zinc-600 text-lg">—</span>
                    : <>◎ {wallet.balanceSol.toFixed(4)}</>
                  }
                  <span className="text-sm text-zinc-500 ml-2">SOL</span>
                </p>
                {wallet.balanceSol !== null && wallet.balanceSol < 0.01 && (
                  <p className="text-[11px] text-amber-500 mt-1">
                    ⚠ Balance low — add SOL to enable trades
                  </p>
                )}
              </div>

              {/* Address */}
              <div>
                <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider mb-1.5">Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-zinc-300 flex-1 bg-zinc-800 px-3 py-2 rounded-lg truncate">
                    {wallet.publicKey}
                  </code>
                  <button
                    onClick={copyAddress}
                    className={`
                      text-[10px] font-mono px-2 py-1.5 rounded-lg border transition-colors shrink-0
                      ${copied
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                      }
                    `}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {/* Fund instructions */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs font-semibold text-zinc-400 mb-2">How to fund</p>
              <ol className="space-y-1.5 text-[11px] text-zinc-500">
                <li className="flex gap-2">
                  <span className="text-zinc-700 shrink-0">1.</span>
                  Copy the wallet address above
                </li>
                <li className="flex gap-2">
                  <span className="text-zinc-700 shrink-0">2.</span>
                  Send SOL from any Solana wallet (Phantom, Backpack, etc.)
                </li>
                <li className="flex gap-2">
                  <span className="text-zinc-700 shrink-0">3.</span>
                  Minimum recommended: 0.05 SOL + trade amount + fees
                </li>
                <li className="flex gap-2">
                  <span className="text-zinc-700 shrink-0">4.</span>
                  When a TRADE condition fires, execution is automatic
                </li>
              </ol>
            </div>

            {/* View on Solscan */}
            <a
              href={`https://solscan.io/account/${wallet.publicKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              View on Solscan ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}