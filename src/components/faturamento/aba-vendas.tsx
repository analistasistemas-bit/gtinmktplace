import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, DollarSign, ShoppingBag, Package, Target, TrendingUp,
  RefreshCw, RotateCcw, ArrowUp, ArrowDown, ChevronsUpDown,
  Truck, Layers, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import { resolverJanela, type PeriodoDias, type Periodo } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useSessionState } from '@/hooks/useSessionState';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { sincronizarFaturamento, type OrigemVenda } from '@/lib/faturamento';
import { agruparPorPedido, calcularKpisPedidos, nomeCurtoComprador, nomeExibicaoComprador, pedidoCasaBusca, type Pedido } from '@/lib/pedidos-faturamento';
import { PilhaThumbs } from '@/components/faturamento/pilha-thumbs';
import { DetalhePedidoItens } from '@/components/faturamento/detalhe-pedido-itens';
import { labelStatusPedido, labelStatusEnvio, fmtDataCurta } from '@/lib/ml-status';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildVendasReport } from '@/lib/export/adapters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { KpiCard } from '@/components/ui/kpi-card';
import { toast } from 'sonner';

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' }, { dias: 30, label: '30 dias' }, { dias: 90, label: '90 dias' },
];
const ORIGENS: { v: OrigemVenda; label: string }[] = [
  { v: 'todos', label: 'Todos' }, { v: 'publiai', label: 'PubliAI' }, { v: 'fora', label: 'Fora' },
];

const tom = (t: 'success' | 'warning' | 'danger' | 'muted'): StatusTone => (t === 'muted' ? 'neutral' : t);

/** Datas YYYY-MM-DD para o rascunho do período personalizado. */
function rascunhoDe(p: Periodo): { desde: string; ate: string } {
  if (p.tipo === 'range') return { desde: p.desde, ate: p.ate };
  const j = resolverJanela(p);
  return { desde: j.desde.slice(0, 10), ate: j.ate.slice(0, 10) };
}

type SortKey = 'data' | 'comprador' | 'unidades' | 'valor' | 'liquido' | 'markup' | 'pagamento' | 'envio' | 'origem';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Cabeçalho clicável que ordena a tabela pela coluna (seta indica direção). */
function ThSort({ k, label, sort, onSort, align = 'left' }: {
  k: SortKey; label: string; sort: Sort | null; onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const ativo = sort?.key === k;
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn('flex w-full items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' && 'justify-end', ativo && 'text-foreground')}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {!ativo ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
          : sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}

/** Valor comparável de um pedido para a coluna escolhida. null = vai pro fim. */
function valorOrdenacao(p: Pedido, k: SortKey): string | number | null {
  switch (k) {
    case 'data': return p.data ? Date.parse(p.data) : null;
    case 'comprador': return nomeExibicaoComprador(p);
    case 'unidades': return p.unidades;
    case 'valor': return p.bruto;
    case 'liquido': return p.liquido;
    case 'markup': return p.markup;
    case 'pagamento': return labelStatusPedido(p.status).label;
    case 'envio': return labelStatusEnvio(p.shipping_status, p.shipping_substatus).label;
    case 'origem': return p.is_publiai ? 1 : 0;
  }
}

function LinhaPedido({ p, isNovo, onVisto }: { p: Pedido; isNovo?: boolean; onVisto?: () => void }) {
  // Expansão persistida (sobrevive a remount por troca de aba e ao refetch de 45s), como o sort.
  const [aberto, setAberto] = useSessionState(`expand:faturamento-vendas:${p.chave}`, false);
  const pgto = labelStatusPedido(p.status);
  const envio = labelStatusEnvio(p.shipping_status, p.shipping_substatus);
  const markupCor = p.markup == null ? undefined
    : p.markup >= 0 ? 'text-success' : 'text-destructive';

  function toggle() {
    const abrindo = !aberto;
    setAberto(abrindo);
    if (abrindo && isNovo) onVisto?.();
  }

  return (
    <>
      <TableRow
        className={cn('cursor-pointer hover:bg-muted/40', isNovo && 'border-l-2 border-l-success')}
        onClick={toggle}
      >
        <TableCell className="w-8 align-middle">
          {aberto
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{fmtDataCurta(p.data)}</TableCell>
        <TableCell className="max-w-[140px] truncate">
          <span className="flex items-center gap-1" title={nomeExibicaoComprador(p)}>
            {p.isPack && <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pack" />}
            {nomeCurtoComprador(p.comprador_nome) ?? nomeExibicaoComprador(p)}
          </span>
        </TableCell>
        <TableCell><PilhaThumbs itens={p.itens} /></TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtInt(p.unidades)}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtBRL(p.bruto)}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums text-success">{fmtBRL(p.liquido)}</TableCell>
        <TableCell className={cn('whitespace-nowrap text-right tabular-nums', markupCor)}>
          {p.markup != null ? fmtMarkup(p.markup) : '—'}
        </TableCell>
        <TableCell><StatusPill tone={tom(pgto.tom)}>{pgto.label}</StatusPill></TableCell>
        <TableCell><StatusPill tone={tom(envio.tom)}>{envio.label}</StatusPill></TableCell>
        <TableCell>
          <span className="flex items-center gap-1">
            <StatusPill tone={p.is_publiai ? 'info' : 'neutral'}>{p.is_publiai ? 'PubliAI' : 'Fora'}</StatusPill>
            {p.tem_devolucao && <StatusPill tone="danger"><RotateCcw className="h-3 w-3" />Devolução</StatusPill>}
            {isNovo && (
              <span className="inline-flex animate-pulse items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success ring-1 ring-inset ring-success/30">
                Novo
              </span>
            )}
          </span>
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={11} className="p-0">
            <DetalhePedidoItens pedido={p} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AbaVendas() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'mes_atual' });
  const [origem, setOrigem] = useState<OrigemVenda>('todos');
  const [sincronizando, setSincronizando] = useState(false);
  const [modoCustom, setModoCustom] = useState(false);
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;
  const ehHoje = !modoCustom && periodo.tipo === 'hoje';
  const ehMesAtual = !modoCustom && periodo.tipo === 'mes_atual';
  const rascunhoValido = !!rascunho.desde && !!rascunho.ate && rascunho.desde <= rascunho.ate;
  const escolherPreset = (dias: PeriodoDias) => { setModoCustom(false); setPeriodo({ tipo: 'preset', dias }); };
  const escolherHoje = () => { setModoCustom(false); setPeriodo({ tipo: 'hoje' }); };
  const escolherMesAtual = () => { setModoCustom(false); setPeriodo({ tipo: 'mes_atual' }); };
  const abrirCustom = () => { setRascunho(rascunhoDe(periodo)); setModoCustom(true); };
  const aplicarCustom = () => { if (rascunhoValido) setPeriodo({ tipo: 'range', desde: rascunho.desde, ate: rascunho.ate }); };

  const { data: vendas, isFetching, refetch } = useVendas(janela, origem);
  const { data: custos } = useCustos();
  const { data: fotos } = useFotosProduto();
  const { data: aliquotas } = useAliquotas();

  // Agrupa por pack/order_id → pedidos; calcula KPIs novos
  const pedidos = useMemo(
    () => agruparPorPedido(
      vendas ?? [],
      montarCustoResolver(custos),
      montarPesoResolver(custos),
      montarFotoResolver(fotos),
      montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 }),
    ),
    [vendas, custos, fotos, aliquotas],
  );
  const kpis = useMemo(() => calcularKpisPedidos(pedidos), [pedidos]);

  // Detecta pedidos novos que chegaram via polling (após a carga inicial).
  const chavesConhecidasRef = useRef<Set<string> | null>(null);
  const [novosChaves, setNovosChaves] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!pedidos.length) return;
    const atuais = new Set(pedidos.map((p) => p.chave));
    if (chavesConhecidasRef.current === null) {
      chavesConhecidasRef.current = atuais;
      return;
    }
    const novos = pedidos.map((p) => p.chave).filter((c) => !chavesConhecidasRef.current!.has(c));
    chavesConhecidasRef.current = atuais;
    if (!novos.length) return;
    setNovosChaves((prev) => new Set([...prev, ...novos]));
    const t = setTimeout(() => {
      setNovosChaves((prev) => { const n = new Set(prev); novos.forEach((c) => n.delete(c)); return n; });
    }, 60_000);
    return () => clearTimeout(t);
  }, [pedidos]);
  const marcarVisto = (chave: string) =>
    setNovosChaves((prev) => { const n = new Set(prev); n.delete(chave); return n; });

  // Busca livre (comprador, produto, nº do pedido, valor)
  const [busca, setBusca] = useState('');

  // Filtro por status de envio (clique no card de contagem, toggle)
  const [filtroEnvio, setFiltroEnvio] = useState<string | null>(null);
  const toggleFiltroEnvio = (status: string) =>
    setFiltroEnvio((f) => (f === status ? null : status));
  const pedidosFiltrados = useMemo(
    () => pedidos
      .filter((p) => pedidoCasaBusca(p, busca))
      .filter((p) => filtroEnvio == null || labelStatusEnvio(p.shipping_status, p.shipping_substatus).label === filtroEnvio),
    [pedidos, busca, filtroEnvio],
  );

  const [sort, setSort] = useSessionState<Sort | null>('sort:faturamento-vendas', null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'comprador' || k === 'pagamento' || k === 'envio';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };
  const pedidosOrdenados = useMemo(() => {
    if (!sort) return pedidosFiltrados;
    return [...pedidosFiltrados].sort((a, b) => {
      const va = valorOrdenacao(a, sort.key);
      const vb = valorOrdenacao(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [pedidosFiltrados, sort]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await sincronizarFaturamento(90);
      toast.success(`Sincronizado: ${r.sincronizados} pedido(s).`);
      await refetch();
    } catch (e) {
      toast.error(`Falha ao sincronizar: ${(e as Error).message}`);
    } finally {
      setSincronizando(false);
    }
  }

  const markupCor = kpis.markup == null ? undefined
    : kpis.markup >= 0 ? 'text-success' : 'text-destructive';

  return (
    <div className="space-y-4">
      {/* ── Filtros de período / origem / sincronizar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm"
              variant={ehHoje ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={escolherHoje}>
              Hoje
            </Button>
            {PERIODOS.map((p) => (
              <Button key={p.dias} size="sm"
                variant={presetAtivo === p.dias ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => escolherPreset(p.dias)}>
                {p.label}
              </Button>
            ))}
            <Button size="sm"
              variant={ehMesAtual ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={escolherMesAtual}>
              Mês atual
            </Button>
            <Button size="sm"
              variant={modoCustom ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={abrirCustom}>
              Personalizado
            </Button>
            {modoCustom && (
              <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); aplicarCustom(); }}>
                <label className="text-xs text-muted-foreground" htmlFor="fat-de">De</label>
                <input id="fat-de" type="date" value={rascunho.desde} max={rascunho.ate}
                  onChange={(e) => setRascunho((r) => ({ ...r, desde: e.target.value }))}
                  className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
                <label className="text-xs text-muted-foreground" htmlFor="fat-ate">Até</label>
                <input id="fat-ate" type="date" value={rascunho.ate} min={rascunho.desde}
                  onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
                  className="h-7 rounded-md border bg-background px-2 text-xs dark:[color-scheme:dark]" />
                <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!rascunhoValido}>OK</Button>
              </form>
            )}
          </div>
          <div className="flex gap-1">
            {ORIGENS.map((o) => (
              <Button key={o.v} size="sm"
                variant={origem === o.v ? 'secondary' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setOrigem(o.v)}>
                {o.label}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Buscar por cliente, produto, pedido, valor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-7 w-[220px] text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Atualiza sozinho a cada 45s — novas vendas entram automaticamente"
          >
            <span className="relative flex h-2 w-2">
              {/* Pulso contínuo = sinal "ao vivo"; acelera no instante do refetch. */}
              <span className={cn(
                'absolute inline-flex h-full w-full rounded-full bg-success opacity-75',
                isFetching ? 'animate-ping' : 'animate-[ping_2.5s_ease-in-out_infinite]',
              )} />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            Ao vivo
          </span>
          <Button variant="outline" size="sm" onClick={sincronizar} disabled={sincronizando}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', sincronizando && 'animate-spin')} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
          <BotaoExportar
            temExpansao
            temKpis
            montarReport={(config) =>
              buildVendasReport({ pedidos: pedidosOrdenados, kpis, periodo, origem, filtroEnvio, config })
            }
          />
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard size="compact" icon={DollarSign} label="Faturamento" infoKey="Faturamento::Faturamento/Vendas" value={fmtBRL(kpis.bruto)} tom="success" />
        <KpiCard size="compact" icon={DollarSign} label="Líquido" value={fmtBRL(kpis.liquido)} tom="success" valueClassName="text-success" />
        <KpiCard size="compact" icon={ShoppingBag} label="Pedidos" infoKey="Pedidos::Faturamento/Vendas" value={fmtInt(kpis.pedidos)} tom="info" />
        <KpiCard size="compact" icon={Package} label="Unidades" value={fmtInt(kpis.unidades)} tom="info" />
        <KpiCard size="compact" icon={Target} label="Ticket médio" infoKey="Ticket médio::Faturamento/Vendas" value={fmtBRL(kpis.ticket)} tom="info" />
        <KpiCard size="compact" icon={Layers} label="Itens / pedido" value={kpis.itensPorPedido.toFixed(1).replace('.', ',')} tom="info" />
        <KpiCard size="compact" icon={TrendingUp} label="Markup" value={kpis.markup != null ? fmtMarkup(kpis.markup) : '—'}
          tom={kpis.markup == null ? 'info' : kpis.markup >= 0 ? 'success' : 'danger'}
          valueClassName={markupCor} />
        <KpiCard size="compact" icon={Users} label="Compradores" value={fmtInt(kpis.compradoresUnicos)} tom="info"
          hint={`${kpis.pctRecompra.toFixed(1).replace('.', ',')}% recompra`} />
      </div>

      {/* ── Card de status de envio (clicável para filtrar) ── */}
      <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-(--motion-duration-state) hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Truck className="h-3.5 w-3.5 shrink-0" />Pedidos por status de envio
          {filtroEnvio && (
            <button
              type="button"
              onClick={() => setFiltroEnvio(null)}
              className="ml-2 text-xs text-info hover:underline">
              limpar filtro
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {Object.entries(kpis.porStatusEnvio).sort((a, b) => b[1] - a[1]).map(([status, n]) => (
            <button
              key={status}
              type="button"
              onClick={() => toggleFiltroEnvio(status)}
              className={cn(
                'tabular-nums transition-opacity hover:opacity-80',
                filtroEnvio != null && filtroEnvio !== status && 'opacity-40',
              )}
              aria-label={status}
            >
              <span className="font-semibold">{n}</span>{' '}
              <span className="text-muted-foreground">{status}</span>
            </button>
          ))}
          {Object.keys(kpis.porStatusEnvio).length === 0 && <span className="text-muted-foreground">—</span>}
        </div>
      </div>

      {/* ── Tabela de pedidos ── */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead className="w-8" />
              <ThSort k="data" label="Data" sort={sort} onSort={toggleSort} />
              <ThSort k="comprador" label="Comprador" sort={sort} onSort={toggleSort} />
              <TableHead>Produtos</TableHead>
              <ThSort k="unidades" label="Un." sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="valor" label="Valor" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liquido" label="Líquido" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="pagamento" label="Pagamento" sort={sort} onSort={toggleSort} />
              <ThSort k="envio" label="Envio" sort={sort} onSort={toggleSort} />
              <ThSort k="origem" label="Origem" sort={sort} onSort={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidosOrdenados.map((p) => (
              <LinhaPedido key={p.chave} p={p} isNovo={novosChaves.has(p.chave)} onVisto={() => marcarVisto(p.chave)} />
            ))}
          </TableBody>
        </Table>
        {!isFetching && (vendas ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhuma venda no período. Clique em <span className="font-medium">Sincronizar</span> para importar do Mercado Livre.
          </div>
        )}
        {(vendas ?? []).length > 0 && pedidosOrdenados.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum pedido encontrado para essa busca/filtro.
          </div>
        )}
        {isFetching && (vendas ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        )}
      </div>
    </div>
  );
}
