import { cn } from '@/lib/utils';

/**
 * Indicador "Ao vivo": pulso verde contínuo sinaliza que a tela se atualiza sozinha (refetch a
 * cada 3min + ao focar a aba, ADR-0081/useVendas); o pulso acelera no instante do refetch. Espelha
 * o Faturamento.
 */
/** Só o pulso, para quem precisa do mesmo sinal de "vivo" com outro rótulo e cor (ex.: telemetria
 *  do Pulse, que fala na cor primária do módulo). */
export function PulsoAoVivo({ isFetching, tom = 'success' }: { isFetching: boolean; tom?: 'success' | 'primary' }) {
  const cor = tom === 'primary' ? 'bg-primary' : 'bg-success';
  return (
    <span className="relative flex h-2 w-2">
      <span className={cn(
        'absolute inline-flex h-full w-full rounded-full opacity-75', cor,
        isFetching ? 'animate-ping' : 'animate-[ping_2.5s_ease-in-out_infinite]',
      )} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', cor)} />
    </span>
  );
}

export function AoVivo({ isFetching }: { isFetching: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="Atualiza sozinho a cada 3 min (ou ao voltar pra aba) — novas vendas entram automaticamente"
    >
      <PulsoAoVivo isFetching={isFetching} />
      Ao vivo
    </span>
  );
}
