'use client';
import { useConditions }  from '@/hooks/useConditons';
import ConditionList      from './ConditionList';
import ConditionBuilder   from './ConditionBuilder';

export default function ConditionsPanel({ userId }: { userId: string }) {
  const {
    conditions,
    loading,
    error,
    refetch,
    deleteCondition,
    toggleCondition,
    addOptimistic,
  } = useConditions(userId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-6 space-y-8">

        {/* Active conditions */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Active conditions
              <span className="ml-2 text-emerald-500">{conditions.length}</span>
            </h2>
            <button
              onClick={refetch}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors font-mono"
            >
              ↻ refresh
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 font-mono mb-3">{error}</p>
          )}

          <ConditionList
            conditions={conditions}
            loading={loading}
            onDelete={deleteCondition}
            onToggle={toggleCondition}
          />
        </section>

        <div className="border-t border-zinc-800" />

        {/* Create new */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">
            New condition
          </h2>
          <ConditionBuilder
            userId={userId}
            onCreated={(cond) => {
              addOptimistic(cond);
              setTimeout(refetch, 3_000);
            }}
          />
        </section>

      </div>
    </div>
  );
}