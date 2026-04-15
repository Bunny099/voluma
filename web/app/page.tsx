'use client';
import { useState }     from 'react';
import { useSocket }    from '@/hooks/useSocket';
import EventFeed        from '@/components/EventFeed';
import TriggerFeed      from '@/components/TriggerFeed';
import ConditionsPanel  from '@/components/CondtionPanel';
import SystemStats      from '@/components/SystemStats';
import { Badge }        from '@/components/ui/badge';

const DEMO_USER_ID = 'user_demo_001';

export default function Dashboard() {
  const {
    connected,
    liveEvents,
    triggers,
    triggeredSigs,   
    clearTriggers,
  } = useSocket(DEMO_USER_ID);

  const [activeTab, setActiveTab] = useState<'feed' | 'triggers' | 'conditions'>('feed');

  const tabs = [
    { key: 'feed'       as const, label: 'Live feed',  count: liveEvents.length },
    { key: 'triggers'   as const, label: 'Triggers',   count: triggers.length   },
    { key: 'conditions' as const, label: 'Conditions', count: null              },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono font-semibold tracking-widest text-emerald-400">
            ◆ VOLUMA
          </span>
          <span className="text-xs text-zinc-600">on-chain automation</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full transition-colors ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}
          />
          <span className="text-xs text-zinc-500 font-mono">
            {connected ? 'LIVE' : 'CONNECTING'}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 border-r border-zinc-800 p-4 flex flex-col gap-4 shrink-0">
          <SystemStats />
          <div className="mt-auto">
            <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider mb-2">Network</p>
            <p className="text-xs text-zinc-400 font-mono">Solana Mainnet</p>
            <p className="text-xs text-zinc-600 mt-1">public RPC / WS</p>
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-zinc-800 px-4 flex gap-1 pt-2 shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  px-4 py-2 text-xs font-medium rounded-t border-b-2 transition-colors
                  ${activeTab === tab.key
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }
                `}
              >
                {tab.label}
                {tab.count !== null && tab.count > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[10px] h-4">
                    {tab.count}
                  </Badge>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'feed' && (
              <EventFeed
                events={liveEvents}
                triggeredSigs={triggeredSigs}   
              />
            )}
            {activeTab === 'triggers' && (
              <TriggerFeed events={triggers} onClear={clearTriggers} />
            )}
            {activeTab === 'conditions' && (
              <ConditionsPanel userId={DEMO_USER_ID} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}