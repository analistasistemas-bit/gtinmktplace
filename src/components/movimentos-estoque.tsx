// E6b (ADR-0094): trilha de auditoria do estoque no expandir de Publicados.
// Lazy: só busca quando o painel abre, mesmo padrão do `useFamilia` ao lado.
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import {
  fetchMovimentosEstoque, rotuloMotivo, movimentoInformativo,
  type MovimentoEstoque,
} from '@/lib/movimentos-estoque';

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Delta com sinal e cor. Movimento informativo (quantidade 0) não mostra número:
 *  exibir "+0" sugeriria que algo entrou. */
function Delta({ m }: { m: MovimentoEstoque }) {
  if (movimentoInformativo(m)) return <span className="text-muted-foreground">—</span>;
  const positivo = m.quantidade > 0;
  return (
    <span className={cn('font-medium tabular-nums', positivo ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
      {positivo ? '+' : ''}{m.quantidade}
    </span>
  );
}

export function MovimentosEstoque({ codigoPai, ativo }: { codigoPai: string; ativo: boolean }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: QK.movimentosEstoque(codigoPai),
    queryFn: () => fetchMovimentosEstoque(codigoPai),
    enabled: ativo,
    staleTime: 60_000,
  });

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Movimentos de estoque
      </span>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">carregando movimentos…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">não foi possível carregar os movimentos deste produto.</p>
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum movimento registrado para este produto.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 pr-3 font-medium">Data</th>
                <th className="pb-1 pr-3 font-medium">SKU</th>
                <th className="pb-1 pr-3 font-medium">Motivo</th>
                <th className="pb-1 pr-3 text-right font-medium">Qtd</th>
                <th className="pb-1 pr-3 text-right font-medium">Saldo</th>
                <th className="pb-1 font-medium">Canal</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-t border-border/50">
                  <td className="py-1 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                    {fmtDataHora(m.criado_em)}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap font-mono">{m.codigo}</td>
                  <td className="py-1 pr-3">
                    {rotuloMotivo(m.motivo)}
                    {/* Vendeu mais do que havia: o saldo parou em 0 e o pedido real fica visível. */}
                    {m.quantidade_pedida != null && Math.abs(m.quantidade) !== m.quantidade_pedida && (
                      <span className="ml-1 text-destructive">
                        (pedido de {m.quantidade_pedida})
                      </span>
                    )}
                    {m.documento && <span className="ml-1 text-muted-foreground">· {m.documento}</span>}
                  </td>
                  <td className="py-1 pr-3 text-right"><Delta m={m} /></td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {m.estoque_resultante != null ? m.estoque_resultante : '—'}
                  </td>
                  <td className="py-1 whitespace-nowrap text-muted-foreground">{m.canal_origem ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
