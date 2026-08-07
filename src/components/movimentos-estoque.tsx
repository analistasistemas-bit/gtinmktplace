// E6b (ADR-0094): trilha de auditoria do estoque no card de Estoque e no expandir de Publicados.
// Lazy: só busca quando o painel abre, mesmo padrão do `useFamilia` ao lado.
// Paginado no servidor: o ledger cresce para sempre e não cabe no cliente.
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { FiltrosMovimentos, type VariacaoFiltro } from '@/components/estoque/filtros-movimentos';
import { resolverJanela, type Periodo } from '@/lib/metricas';
import {
  fetchMovimentosEstoque, rotuloMotivo, movimentoInformativo,
  type MovimentoEstoque, type GrupoMotivo, type FiltroMovimentos,
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

export function MovimentosEstoque({
  codigoPai, ativo, variacoes = [],
}: { codigoPai: string; ativo: boolean; variacoes?: VariacaoFiltro[] }) {
  const [pagina, setPagina] = useState(1);
  const [tamanho, setTamanho] = useState(20);
  const [grupos, setGrupos] = useState<GrupoMotivo[]>([]);
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<'recentes' | 'antigos'>('recentes');

  const filtro: FiltroMovimentos = useMemo(() => ({
    grupos,
    janela: periodo ? resolverJanela(periodo) : null,
    codigo,
    ordem,
  }), [grupos, periodo, codigo, ordem]);

  const { data, isLoading, isError } = useQuery({
    queryKey: QK.movimentosEstoquePagina(codigoPai, pagina, tamanho, filtro),
    queryFn: () => fetchMovimentosEstoque(codigoPai, pagina, tamanho, filtro),
    enabled: ativo,
    staleTime: 60_000,
    // Mantém a página anterior enquanto a próxima carrega: sem isso a lista pisca em branco a
    // cada clique de paginação, e o operador perde a referência visual de onde estava.
    placeholderData: keepPreviousData,
  });

  // Trocar qualquer filtro reinicia a paginação: manter a página 5 ao recortar para 2 resultados
  // mostraria uma lista vazia que parece "não tem nada", quando na verdade tem.
  const comReset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const temFiltro = grupos.length > 0 || periodo !== null || codigo !== null;
  const inicio = total === 0 ? 0 : (pagina - 1) * tamanho + 1;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Movimentos de estoque
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => comReset(setOrdem)(ordem === 'recentes' ? 'antigos' : 'recentes')}
        >
          Data
          {ordem === 'recentes' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
        </Button>
      </div>

      <FiltrosMovimentos
        grupos={grupos}
        onGrupos={comReset(setGrupos)}
        periodo={periodo}
        onPeriodo={comReset(setPeriodo)}
        codigo={codigo}
        onCodigo={comReset(setCodigo)}
        variacoes={variacoes}
      />

      {isLoading ? (
        <p className="text-xs text-muted-foreground">carregando movimentos…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">não foi possível carregar os movimentos deste produto.</p>
      ) : itens.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {temFiltro
            ? 'Nenhum movimento com esses filtros.'
            : 'Nenhum movimento registrado para este produto.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {itens.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 border-t border-border/50 py-1.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="tabular-nums text-muted-foreground">{fmtDataHora(m.criado_em)}</span>
                <span className="font-mono">{m.codigo}</span>
                <span className="min-w-0">
                  {rotuloMotivo(m.motivo)}
                  {/* Vendeu mais do que havia: o saldo parou em 0 e o pedido real fica visível. */}
                  {m.quantidade_pedida != null && Math.abs(m.quantidade) !== m.quantidade_pedida && (
                    <span className="ml-1 text-destructive">(pedido de {m.quantidade_pedida})</span>
                  )}
                  {m.documento && <span className="ml-1 text-muted-foreground">· {m.documento}</span>}
                </span>
              </div>
              <div className="flex shrink-0 items-baseline gap-3">
                <Delta m={m} />
                <span className="tabular-nums">
                  {m.estoque_resultante != null ? m.estoque_resultante : '—'}
                </span>
                <span className="text-muted-foreground">{m.canal_origem ?? '—'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Renderizado mesmo quando cabe numa página: o total é o que denuncia um histórico maior
          do que a tela mostra — foi a falta dele que escondeu as entradas do protetor solar. */}
      {total > 0 && (
        <Pagination
          paginaAtual={pagina}
          totalPaginas={Math.max(1, Math.ceil(total / tamanho))}
          inicio={inicio}
          fim={inicio === 0 ? 0 : inicio + itens.length - 1}
          total={total}
          tamanho={tamanho}
          onIrPara={setPagina}
          onTamanho={(n) => { setTamanho(n); setPagina(1); }}
          rotuloItem="movimento"
          className="border-t border-border/50 pt-2"
        />
      )}
    </div>
  );
}
