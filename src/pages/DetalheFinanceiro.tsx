import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronsUpDown, ChevronDown, ChevronRight, RefreshCw, Layers, CheckCircle2, RotateCcw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildFinanceiroDetalheReport } from '@/lib/export/adapters';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { KpiInfoButton } from '@/components/ui/kpi-card';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { registrarSaque, desfazerSaque } from '@/lib/faturamento';
import { periodoFromParams, resolverJanela, type Periodo } from '@/lib/metricas';
import { calcularResumo } from '@/lib/resumo-vendas';
import { agruparPorPedido, filtrarPedidosFinanceiro, nomeCurtoComprador, nomeExibicaoComprador, pedidoCasaBusca, retidoDoPedido, rotuloNaoFaturavel, totaisFinanceiro, type FiltroFinanceiro, type Pedido } from '@/lib/pedidos-faturamento';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { montarCorResolver } from '@/lib/cor-produto';
import { labelStatusLiberacao, statusLiberacao, type StatusLiberacao } from '@/lib/status-liberacao';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useSessionState } from '@/hooks/useSessionState';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useCoresProduto } from '@/hooks/useCoresProduto';
import { useAnuncioCanonico } from '@/hooks/useAnuncioCanonico';
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

// Deriva o rótulo do período JÁ RESOLVIDO (não do query cru) para o texto sempre
// refletir a janela efetivamente consultada, mesmo com URL malformada.
function rotuloPeriodo(periodo: Periodo): string {
  if (periodo.tipo === 'hoje') return 'hoje';
  if (periodo.tipo === 'mes_atual') return 'mês atual';
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
  // Devolvido/cancelado: fora dos totais (ADR-0038). Sem a marca, a linha mostrava bruto cheio e
  // líquido zerado como se o ML tivesse retido tudo — na verdade o dinheiro voltou ao comprador.
  const naoFaturavel = rotuloNaoFaturavel(p);
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
              // Não há o que sacar num pedido devolvido: o dinheiro voltou ao comprador. A RPC já
              // recusa, mas sem isto o operador seleciona, clica e recebe um "0 registro(s)
              // marcado(s)" sem explicação — no filtro Devolvidos essas linhas ficam visíveis.
              disabled={!p.faturavel}
              aria-label={p.faturavel
                ? `Selecionar pedido ${p.chave}`
                : `Pedido ${p.chave} devolvido — sem valor a sacar`}
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
          {naoFaturavel && (
            <span className="block text-xs font-medium uppercase text-destructive">{naoFaturavel}</span>
          )}
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
        <TableCell className={cn(
          'align-top text-right text-sm tabular-nums',
          naoFaturavel && 'text-muted-foreground line-through',
        )}>{fmtBRL(p.bruto)}</TableCell>
        <TableCell className={cn(
          'align-top text-right text-sm tabular-nums',
          naoFaturavel ? 'text-muted-foreground' : retido < 0 ? 'text-success' : 'text-warning',
        )}>
          {naoFaturavel ? '—' : retido < 0 ? `+${fmtBRL(-retido)}` : fmtBRL(retido)}
          {!naoFaturavel && retido < 0 && <span className="block text-xs text-muted-foreground">crédito</span>}
        </TableCell>
        <TableCell className={cn(
          'align-top text-right text-sm tabular-nums',
          naoFaturavel ? 'text-muted-foreground' : 'text-success',
        )}>{naoFaturavel ? '—' : fmtBRL(p.liquido + p.imposto)}</TableCell>
        <TableCell className={cn(
          'align-top text-right text-sm font-medium tabular-nums',
          p.markup == null ? 'text-muted-foreground' : p.markup >= 0 ? 'text-success' : 'text-destructive',
        )}>
          {p.markup != null ? fmtMarkup(p.markup) : '—'}
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={10} className="p-0 motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-reversible">
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
  const coresQ = useCoresProduto();
  const canonicoQ = useAnuncioCanonico();
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
      montarFotoResolver(fotosQ.data, canonicoQ.data),
      montarAliquotaResolver(custosQ.data, aliquotasQ.data ?? { nacional: 8, importado: 16 }),
      montarCorResolver(coresQ.data, canonicoQ.data),
    ),
    [vendasQ.data, custosQ.data, fotosQ.data, canonicoQ.data, aliquotasQ.data, coresQ.data],
  );

  const bruto = r.bruto;
  const liquido = r.liquido;
  const retido = r.descontos;
  const pctRetido = bruto > 0 ? (retido / bruto) * 100 : 0;

  const [filtroLib, setFiltroLib] = useState<FiltroFinanceiro>('todos');
  const [busca, setBusca] = useSessionState('busca:detalhe-financeiro', '');
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());

  const pedidosFiltrados = useMemo(
    () => filtrarPedidosFinanceiro(pedidos, filtroLib).filter((p) => pedidoCasaBusca(p, busca)),
    [pedidos, filtroLib, busca],
  );

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

  // Paginação client-side: os dados já estão todos em memória (a query não muda). Sem isto a
  // tabela renderiza a base inteira do período — 985 pedidos em 30 dias, medido em 2026-08-12.
  const POR_PAGINA = 50;
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(pedidosOrdenados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const pedidosPagina = useMemo(
    () => pedidosOrdenados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [pedidosOrdenados, paginaAtual],
  );
  // Mudou o recorte, volta para a primeira página — senão o operador busca algo e cai numa página
  // vazia por estar na página 7 do resultado anterior.
  useEffect(() => { setPagina(1); }, [busca, filtroLib]);

  // "Visíveis" com paginação é a PÁGINA, não o filtro inteiro: o checkbox do cabeçalho não pode
  // marcar 985 pedidos que o operador não está vendo.
  const idsVisiveis = useMemo(() => new Set(pedidosPagina.map((p) => p.chave)), [pedidosPagina]);
  const selecionadosVisiveis = pedidosPagina.filter((p) => selecionados.has(p.chave));
  const todosVisiveisSelecionados = pedidosPagina.length > 0 && pedidosPagina.every((p) => selecionados.has(p.chave));

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
      // Trava final antes da RPC: pedido devolvido/cancelado não tem valor a sacar (ADR-0038).
      if (!pedido.faturavel) { ignoradosCliente += pedido.vendaIds.length; continue; }
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

  // Totais e markup agregado sobre os pedidos FILTRADOS (coerente com o que está visível), contando
  // só faturáveis — igual ao banner de KPIs (ADR-0038).
  const totaisFiltrados = useMemo(() => totaisFinanceiro(pedidosFiltrados), [pedidosFiltrados]);

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
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          Falha ao ler as vendas. Clique em Atualizar para tentar de novo.
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Líquido total (você recebe)
            <KpiInfoButton infoKey="Líquido total (você recebe)" />
          </span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(liquido)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          de {fmtBRL(bruto)} faturados — {pct(pctRetido)} retido pelo ML · {fmtInt(r.pedidos)} venda(s)
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {([
            ['todos', 'Todos'],
            ['liberado', 'Liberados'],
            ['aliberar', 'A liberar'],
            ['sacado', 'Sacados'],
            ['devolvidos', 'Devolvidos'],
          ] as const).map(([k, lbl]) => (
            <Button key={k} size="sm" variant={filtroLib === k ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs" onClick={() => setFiltroLib(k)}>{lbl}</Button>
          ))}
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar comprador, nº do pedido, produto, código ou valor"
            className="ml-2 h-7 w-72 text-xs"
            aria-label="Buscar pedido"
          />
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
              pedidosPagina.map((p) => (
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

      {totalPaginas > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {fmtInt(pedidosOrdenados.length)} pedido(s) — mostrando {fmtInt(pedidosPagina.length)} nesta página
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
              onClick={() => setPagina((n) => Math.max(1, n - 1))} disabled={paginaAtual <= 1}>
              Anterior
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              página {paginaAtual} de {totalPaginas}
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs"
              onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))} disabled={paginaAtual >= totalPaginas}>
              Próxima
            </Button>
          </div>
        </div>
      )}

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
