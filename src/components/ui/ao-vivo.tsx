import { cn } from '@/lib/utils';

/**
 * Indicador "Ao vivo": pulso verde contínuo sinaliza que a tela se atualiza sozinha (refetch a
 * cada 45s + ao focar a aba); o pulso acelera no instante do refetch. Espelha o Faturamento.
 */
export function AoVivo({ isFetching }: { isFetching: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="Atualiza sozinho a cada 45s — novas vendas entram automaticamente"
    >
      <span className="relative flex h-2 w-2">
        <span className={cn(
          'absolute inline-flex h-full w-full rounded-full bg-success opacity-75',
          isFetching ? 'animate-ping' : 'animate-[ping_2.5s_ease-in-out_infinite]',
        )} />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      Ao vivo
    </span>
  );
}
