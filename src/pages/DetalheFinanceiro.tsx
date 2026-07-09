import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, ChevronRight, RefreshCw, Layers, CheckCircle2, RotateCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildFinanceiroDetalheReport } from '@/lib/export/adapters';
import { fmtBRL, fmtInt, round2 } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { registrarSaque, desfazerSaque } from '@/lib/faturamento';
import { periodoFromParams, resolverJanela, type Periodo } from '@/lib/metricas';
import { calcularMarkup } from '@/lib/markup';
import { calcularResumo } from '@/lib/resumo-vendas';
import { agruparPorPedido, nomeCurtoComprador, nomeExibicaoComprador, retidoDoPedido, type Pedido } from '@/lib/pedidos-faturamento';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { labelStatusLiberacao, statusLiberacao, type StatusLiberacao } from '@/lib/status-liberacao';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useSessionState } from '@/hooks/useSessionState';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { PilhaThumbs } from '@/components/faturamento/pilha-thumbs';
import { DetalhePedidoItens } from '@/components/faturamento/detalhe-pedido-itens';
import { AoVivo } from '@/components/ui/ao-vivo';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function CelulaLiberacao({
  iso, sacadoEm, temMembrosSemDataLiberacao,
}: {
  iso: string | null;
  sacadoEm: string | null;
  temMembrosSemDataLiberacao: boolean;
}) {
  const status = statusLiberacao({
    money_release_date: iso,
    sacado_em: sacadoEm,
    temMembrosSemDataLiberacao,
  });
  if (status === 'sem_data') {
    return <TableCell className="align-top whitespace-nowrap text-sm tabular-nums text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="align-top whitespace-nowrap text-sm tabular-nums">
      <span className="block">{fmtData(iso)}</span>
      <span className={cn(
        'text-xs',
        status === 'sacado' ? 'text-primary' : status === 'liberado' ? 'text-success' : 'text-warning',
      )}>
        {labelStatusLiberacao(status)}
      </span>
    </TableCell>
  );
}

/** Markup em % com sinal, ou null quando não há custo para calcular. */
function fmtMarkup(markup: number): string {
  const p = Math.round(markup * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

// Deriva o rótulo do período JÁ RESOLVIDO (não do query cru) para o texto sempre
// refletir a janela efetivamente consultada, mesmo com URL malformada.
function rotuloPeriodo(periodo: Periodo): string {
  if (periodo.tipo === 'hoje') return 'hoje';
  return periodo.tipo === 'preset'
    ? `últimos ${periodo.dias} dias`
    : `${periodo.desde} a ${periodo.ate}`;
}

type SortKey = 'data' | 'comprador' | 'unidades' | 'liberacao' | 'bruto' | 'retido' | 'liquido' | 'markup';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Cabeçalho clicável que ordena pela coluna (seta indica direção). */
function ThSort({ k, label, sort, onSort, align = 'left' }: {
  k: SortKey; label: string; sort: Sort | null; onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const ativo = sort?.key === k;
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'flex w-full items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' && 'justify-end',
          ativo && 'text-foreground',
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {!ativo ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
          : sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}

/** Linha de um pedido — expansível (clique) para ver os itens com custo/líquido/markup, como no Faturamento. */
function LinhaDetalhe({
  p,
  selecionado,
  onSelecionar,
}: {
  p: Pedido;
  selecionado: boolean;
  onSelecionar: (checked: boolean) => void;
}) {
  // Expansão persistida (sobrevive a sair/voltar do detalhe e ao refetch), como o sort.
  const [aberto, setAberto] = useSessionState(`expand:detalhe-financeiro:${p.chave}`, false);
  // Pedido no prejuízo: o líquido recebido ficou abaixo do custo (markup negativo).
  const prejuizo = p.custo != null && p.custo > 0 && p.liquido < p.custo;
  const retido = retidoDoPedido(p);
  return (
    <>
      <TableRow
        className={cn('cursor-pointer hover:bg-muted/40', prejuizo && 'bg-destructive/10')}
        data-state={selecionado ? 'selected' : undefined}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
          setAberto((a) => !a);
        }}
      >
        <TableCell className="w-12 align-top">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selecionado}
              onCheckedChange={(checked) => onSelecionar(checked === true)}
              aria-label={`Selecionar pedido ${p.chave}`}
            />
            {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </TableCell>
        <TableCell className={cn(
          'align-top whitespace-nowrap text-sm tabular-nums',
          prejuizo && 'border-l-2 border-l-destructive',
        )}>{fmtData(p.data)}</TableCell>
        <TableCell className="align-top text-sm">
          <span className="flex max-w-[140px] items-center gap-1 truncate" title={nomeExibicaoComprador(p)}>
            {p.isPack && <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pack" />}
            {nomeCurtoComprador(p.comprador_nome) ?? nomeExibicaoComprador(p)}
          </span>
          {p.estorno > 0 && (
            <span className="text-xs text-destructive">estornado {fmtBRL(p.estorno)}</span>
          )}
        </TableCell>
        <TableCell className="align-top"><PilhaThumbs itens={p.itens} /></TableCell>
        <TableCell className="align-top whitespace-nowrap text-right text-sm tabular-nums">{fmtInt(p.unidades)}</TableCell>
        <CelulaLiberacao
          iso={p.money_release_date}
          sacadoEm={p.sacado_em}
          temMembrosSemDataLiberacao={p.temMembrosSemDataLiberacao}
        />
        <TableCell className="align-top text-right text-sm tabular-nums">{fmtBRL(p.bruto)}</TableCell>
        <TableCell className={cn('align-top text-right text-sm tabular-nums', retido < 0 ? 'text-success' : 'text-warning')}>
          {retido < 0 ? `+${fmtBRL(-retido)}` : fmtBRL(retido)}
          {retido < 0 && <span className="block text-xs text-muted-foreground">crédito</span>}
        </TableCell>
        <TableCell className="align-top text-right text-sm tabular-nums text-success">{fmtBRL(p.liquido + p.imposto)}</TableCell>
        <TableCell className={cn(
          'align-top text-right text-sm font-medium tabular-nums',
          p.markup == null ? 'text-muted-foreground' : p.markup >= 0 ? 'text-success' : 'text-destructive',
        )}>
          {p.markup != null ? fmtMarkup(p.markup) : '—'}
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={10} className="p-0">
            <DetalhePedidoItens pedido={p} liquidoBruto />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function DetalheFinanceiro() {
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const vendasQ = useVendas(janela, 'todos');
  const custosQ = useCustos();
  const fotosQ = useFotosProduto();
  const aliquotasQ = useAliquotas();
  const isFetching = vendasQ.isFetching;
  const error = vendasQ.isError;

  // Banner agregado (líquido/bruto/retido do período) — mesma fonte dos outros menus (ADR-0038).
  const r = useMemo(
    () => calcularResumo(
      vendasQ.data ?? [],
      montarCustoResolver(custosQ.data),
      montarPesoResolver(custosQ.data),
      undefined,
      montarAliquotaResolver(custosQ.data, aliquotasQ.data ?? { nacional: 8, importado: 16 }),
    ),
    [vendasQ.data, custosQ.data, aliquotasQ.data],
  );
  // Tabela por PEDIDO (pack agrupado), igual ao Faturamento, p/ análise detalhada por item.
  const pedidos = useMemo(
    () => agruparPorPedido(
      vendasQ.data ?? [],
      montarCustoResolver(custosQ.data),
      montarPesoResolver(custosQ.data),
      montarFotoResolver(fotosQ.data),
      montarAliquotaResolver(custosQ.data, aliquotasQ.data ?? { nacional: 8, importado: 16 }),
    ),
    [vendasQ.data, custosQ.data, fotosQ.data, aliquotasQ.data],
  );

  const bruto = r.bruto;
  const liquido = r.liquido;
  const retido = r.descontos;
  const pctRetido = bruto > 0 ? (retido / bruto) * 100 : 0;

  type FiltroLib = 'todos' | 'liberado' | 'aliberar' | 'sacado';
  const [filtroLib, setFiltroLib] = useState<FiltroLib>('todos');
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());

  const pedidosFiltrados = useMemo(() => {
    const now = Date.now();
    return pedidos.filter((p) => {
      const status = statusLiberacao({
        money_release_date: p.money_release_date,
        sacado_em: p.sacado_em,
        temMembrosSemDataLiberacao: p.temMembrosSemDataLiberacao,
      }, now);
      if (filtroLib === 'liberado') return status === 'liberado';
      if (filtroLib === 'aliberar') return status === 'aliberar';
      if (filtroLib === 'sacado') return status === 'sacado';
      return true;
    });
  }, [pedidos, filtroLib]);

  // Ordenação: colunas textuais começam em A→Z; numéricas/data em maior→menor (mais recente).
  const [sort, setSort] = useSessionState<Sort | null>('sort:detalhe-financeiro', null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'comprador';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };

  const pedidosOrdenados = useMemo(() => {
    if (!sort) {
      // Padrão: o que vai liberar MAIS CEDO primeiro (a liberar, soonest no topo); depois o já
      // liberado (mais recente primeiro); pedidos sem data de liberação por último.
      const agora = Date.now();
      return [...pedidosFiltrados].sort((a, b) => {
        const ta = a.money_release_date ? new Date(a.money_release_date).getTime() : null;
        const tb = b.money_release_date ? new Date(b.money_release_date).getTime() : null;
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        const aFut = ta > agora;
        const bFut = tb > agora;
        if (aFut !== bFut) return aFut ? -1 : 1; // a liberar antes do já liberado
        return aFut ? ta - tb : tb - ta; // a liberar: mais cedo primeiro; liberado: mais recente
      });
    }
    const val = (p: Pedido): string | number | null => {
      switch (sort.key) {
        case 'data': return p.data;
        case 'comprador': return nomeExibicaoComprador(p);
        case 'unidades': return p.unidades;
        case 'liberacao': return p.money_release_date;
        case 'bruto': return p.bruto;
        case 'retido': return retidoDoPedido(p);
        case 'liquido': return p.liquido + p.imposto;
        case 'markup': return p.markup;
      }
    };
    return [...pedidosFiltrados].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // sem valor sempre por último
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [pedidosFiltrados, sort]);

  const idsVisiveis = useMemo(() => new Set(pedidosOrdenados.map((p) => p.chave)), [pedidosOrdenados]);
  const selecionadosVisiveis = pedidosOrdenados.filter((p) => selecionados.has(p.chave));
  const todosVisiveisSelecionados = pedidosOrdenados.length > 0 && pedidosOrdenados.every((p) => selecionados.has(p.chave));

  function setSelecionado(chave: string, checked: boolean) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (checked) next.add(chave); else next.delete(chave);
      return next;
    });
  }

  function selecionarVisiveis(checked: boolean) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      for (const id of idsVisiveis) {
        if (checked) next.add(id); else next.delete(id);
      }
      return next;
    });
  }

  type SaqueMutationVars = { ids: string[]; ignoradosCliente: number };

  const mutationRegistrar = useMutation({
    mutationFn: ({ ids }: SaqueMutationVars) => registrarSaque(ids),
    onSuccess: (atualizados, vars) => {
      const ignoradosBackend = vars.ids.length - atualizados;
      const ignorados = vars.ignoradosCliente + ignoradosBackend;
      toast.success(`${atualizados} registro(s) marcado(s) como sacado(s)`, {
        description: ignorados > 0 ? `${ignorados} registro(s) ignorado(s).` : undefined,
      });
      setSelecionados(new Set());
      queryClient.invalidateQueries({ queryKey: ['vendas'] });
    },
    onError: (e) => toast.error('Falha ao registrar saque', { description: e instanceof Error ? e.message : 'Erro desconhecido' }),
  });

  const mutationDesfazer = useMutation({
    mutationFn: ({ ids }: SaqueMutationVars) => desfazerSaque(ids),
    onSuccess: (atualizados, vars) => {
      const ignoradosBackend = vars.ids.length - atualizados;
      const ignorados = vars.ignoradosCliente + ignoradosBackend;
      toast.success(`${atualizados} registro(s) voltaram para liberado`, {
        description: ignorados > 0 ? `${ignorados} registro(s) ignorado(s).` : undefined,
      });
      setSelecionados(new Set());
      queryClient.invalidateQueries({ queryKey: ['vendas'] });
    },
    onError: (e) => toast.error('Falha ao desfazer saque', { description: e instanceof Error ? e.message : 'Erro desconhecido' }),
  });

  function vendaIdsPorStatus(statusEsperado: StatusLiberacao): SaqueMutationVars {
    const now = Date.now();
    const ids: string[] = [];
    let ignoradosCliente = 0;
    for (const pedido of selecionadosVisiveis) {
      const status = statusLiberacao({
        money_release_date: pedido.money_release_date,
        sacado_em: pedido.sacado_em,
        temMembrosSemDataLiberacao: pedido.temMembrosSemDataLiberacao,
      }, now);
      if (status === statusEsperado) {
        ids.push(...pedido.vendaIds);
      } else {
      ignoradosCliente += pedido.vendaIds.length;
      }
    }
    return { ids, ignoradosCliente };
  }

  function onRegistrarSaque() {
    const { ids, ignoradosCliente } = vendaIdsPorStatus('liberado');
    if (ids.length === 0) {
      toast.error('Selecione pedido(s) liberado(s).');
      return;
    }
    mutationRegistrar.mutate({ ids, ignoradosCliente });
  }

  function onDesfazerSaque() {
    const { ids, ignoradosCliente } = vendaIdsPorStatus('sacado');
    if (ids.length === 0) {
      toast.error('Selecione pedido(s) sacado(s).');
      return;
    }
    mutationDesfazer.mutate({ ids, ignoradosCliente });
  }

  // Totais e markup agregado sobre os pedidos FILTRADOS (coerente com o que está visível).
  const totaisFiltrados = useMemo(() => {
    let brutoF = 0;
    let retidoF = 0;
    let liquidoF = 0;
    let liqMk = 0;
    let cstMk = 0;
    for (const p of pedidosFiltrados) {
      brutoF += p.bruto;
      retidoF += retidoDoPedido(p);
      // Total exibido bate com o Mercado Pago: não desconta imposto (ver comentário no header).
      liquidoF += p.liquido + p.imposto;
      // Markup continua líquido de imposto (ADR-0055), independente do que "Líquido" exibe.
      if (p.custo != null && p.custo > 0) { liqMk += p.liquido; cstMk += p.custo; }
    }
    return {
      bruto: round2(brutoF),
      retido: round2(retidoF),
      liquido: round2(liquidoF),
      markup: cstMk > 0 ? calcularMarkup(liqMk, cstMk).markup : null,
    };
  }, [pedidosFiltrados]);

  const markupTotal = totaisFiltrados.markup;

  return (
    <div className="p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Financeiro', to: '/financeiro' }, { label: 'Detalhe do líquido' }]} />
      <PageHeader
        title="Detalhe do líquido"
        subtitle={`Composição do líquido recebido — ${rotuloPeriodo(periodo)}.`}
        actions={
          <div className="flex items-center gap-2">
            <AoVivo isFetching={isFetching} />
            <BotaoExportar
              temExpansao
              temKpis
              montarReport={(config) =>
                buildFinanceiroDetalheReport({
                  pedidos: pedidosOrdenados,
                  totais: totaisFiltrados,
                  filtroLib,
                  periodo,
                  config,
                })
              }
            />
            <Button variant="outline" size="sm" onClick={() => vendasQ.refetch()} disabled={isFetching}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
              {isFetching ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/financeiro"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler as vendas. Clique em Atualizar para tentar de novo.
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Líquido total (você recebe)</span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(liquido)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          de {fmtBRL(bruto)} faturados — {pct(pctRetido)} retido pelo ML · {fmtInt(r.pedidos)} venda(s)
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {([
            ['todos', 'Todos'],
            ['liberado', 'Liberados'],
            ['aliberar', 'A liberar'],
            ['sacado', 'Sacados'],
          ] as const).map(([k, lbl]) => (
            <Button key={k} size="sm" variant={filtroLib === k ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs" onClick={() => setFiltroLib(k)}>{lbl}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{selecionadosVisiveis.length} selecionado(s)</span>
          <Button size="sm" variant="outline" onClick={onRegistrarSaque}
            disabled={selecionadosVisiveis.length === 0 || mutationRegistrar.isPending || mutationDesfazer.isPending}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />Registrar saque
          </Button>
          <Button size="sm" variant="outline" onClick={onDesfazerSaque}
            disabled={selecionadosVisiveis.length === 0 || mutationRegistrar.isPending || mutationDesfazer.isPending}>
            <RotateCcw className="mr-1.5 h-4 w-4" />Desfazer saque
          </Button>
        </div>
      </div>

      {/* Detalhe por pedido */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead className="w-12">
                <Checkbox
                  checked={todosVisiveisSelecionados}
                  onCheckedChange={(checked) => selecionarVisiveis(checked === true)}
                  aria-label="Selecionar pedidos visíveis"
                />
              </TableHead>
              <ThSort k="data" label="Data" sort={sort} onSort={toggleSort} />
              <ThSort k="comprador" label="Comprador" sort={sort} onSort={toggleSort} />
              <TableHead>Produtos</TableHead>
              <ThSort k="unidades" label="Un." sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liberacao" label="Liberação" sort={sort} onSort={toggleSort} />
              <ThSort k="bruto" label="Bruto" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="retido" label="Retido (ML)" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liquido" label="Líquido" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidosOrdenados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              pedidosOrdenados.map((p) => (
                <LinhaDetalhe
                  key={p.chave}
                  p={p}
                  selecionado={selecionados.has(p.chave)}
                  onSelecionar={(checked) => setSelecionado(p.chave, checked)}
                />
              ))
            )}
          </TableBody>
          {pedidosOrdenados.length > 0 && (
            <TableFooter>
              <TableRow className="border-t font-medium">
                <TableCell colSpan={6} className="text-sm">Total</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(totaisFiltrados.bruto)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-warning">{fmtBRL(totaisFiltrados.retido)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-success">{fmtBRL(totaisFiltrados.liquido)}</TableCell>
                <TableCell className={cn(
                  'text-right text-sm tabular-nums',
                  markupTotal == null ? 'text-muted-foreground'
                    : markupTotal >= 0 ? 'text-success' : 'text-destructive',
                )}>
                  {markupTotal == null ? '—' : fmtMarkup(markupTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Cada linha é um pedido do período (carrinho do cliente; packs agrupados, igual ao Faturamento);
        clique para ver os itens com custo, líquido e markup. "Retido" é o que o ML/MP desconta da venda
        (comissão + frete). Em pedidos com vários produtos (mesmo envio), o frete é rateado entre os itens
        por peso. O "líquido" aqui é sempre o dinheiro que efetivamente cai na conta — nunca desconta
        imposto — e bate com o "Líquido total" do banner acima e com o Mercado Pago. O "markup" é a exceção:
        continua líquido do imposto estimado por origem (nacional/importado, ADR-0055), pra refletir a
        margem real do produto: (líquido − imposto − custo) ÷ custo. Pedidos sem custo cadastrado ou de
        produtos fora do PubliAI mostram "—". "Liberação" é a data em que o Mercado Livre libera aquele
        recebimento para saque ("a liberar" = ainda retido; "liberado" = já no saldo; "sacado" = marcado
        manualmente como já sacado pelo usuário). Linhas destacadas em vermelho são pedidos no prejuízo
        (líquido, já descontado o imposto, abaixo do custo). Clique no cabeçalho para ordenar.
      </p>
    </div>
  );
}
