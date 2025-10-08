import { useEffect, useState } from 'react';
import { cache } from '../services/cacheService.js';

interface CacheStatsState {
  size: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

const formatTimestamp = (timestamp: number | null): string => {
  if (!timestamp) {
    return 'N/A';
  }

  return new Date(timestamp).toLocaleString('pt-BR');
};

export function CacheStats(): JSX.Element {
  const [stats, setStats] = useState<CacheStatsState>(cache.getStats());

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(cache.getStats());
    }, 1_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="fixed bottom-4 right-4 rounded-lg bg-slate-900 px-4 py-3 text-xs text-slate-100 shadow-lg">
      <header className="mb-2 font-semibold uppercase tracking-wide">Cache</header>
      <dl className="space-y-1">
        <div className="flex justify-between gap-4">
          <dt>Entradas</dt>
          <dd>{stats.size}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Mais antiga</dt>
          <dd>{formatTimestamp(stats.oldestEntry)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Mais recente</dt>
          <dd>{formatTimestamp(stats.newestEntry)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="mt-3 w-full rounded bg-red-600 px-2 py-1 text-white transition hover:bg-red-700"
        onClick={() => {
          if (window.confirm('Limpar o cache do Supercaderno?')) {
            cache.clear();
            setStats(cache.getStats());
          }
        }}
      >
        Limpar cache
      </button>
    </aside>
  );
}

export default CacheStats;
