import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryClient } from '@/lib/query-client';
import { useSupportStore } from '@/stores/support-store';

function remaining(expiresAt: string): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function SupportBanner() {
  const context = useSupportStore((state) => state.context);
  const end = useSupportStore((state) => state.end);
  const navigate = useNavigate();
  const [time, setTime] = useState(() => context ? remaining(context.expiresAt) : '00:00');
  const finishing = useRef(false);

  const finish = useCallback(async () => {
    if (!context || finishing.current) return;
    finishing.current = true;
    try {
      await end(context.requestId);
    } catch {
      // A sessão pode já ter expirado/revogado no backend; o cliente ainda deve sair da operação.
    } finally {
      queryClient.clear();
      navigate('/admin', { replace: true });
    }
  }, [context, end, navigate]);

  useEffect(() => {
    if (!context) return;
    const tick = () => {
      const next = remaining(context.expiresAt);
      setTime(next);
      if (next === '00:00') void finish();
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [context, finish]);

  if (!context) return null;

  return (
    <aside className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/50 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" aria-label="Sessão de suporte ativa">
      <span>Suporte: <strong>{context.orgName}</strong> · {context.scope === 'full' ? 'Acesso total' : 'Somente leitura'} · <span aria-live="polite">Expira em {time}</span></span>
      <button type="button" className="rounded-md border border-amber-700 px-2 py-1 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900" onClick={() => void finish()} aria-label="Encerrar suporte">
        Encerrar suporte
      </button>
    </aside>
  );
}
