import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, DollarSign, ShoppingBag, Package, Target, TrendingUp,
  RefreshCw, ExternalLink, RotateCcw, ArrowUp, ArrowDown, ChevronsUpDown,
  Truck, Layers, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { resolverJanela, type PeriodoDias, type Periodo } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useImageUrl } from '@/hooks/useImageUrl';
import { montarCustoResolver, montarPesoResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { sincronizarFaturamento, type OrigemVenda } from '@/lib/faturamento';
import { agruparPorPedido, calcularKpisPedidos, type Pedido, type ItemPedido } from '@/lib/pedidos-faturamento';
import { labelStatusPedido, labelStatusEnvio, fmtDataCurta } from '@/lib/ml-status';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildVendasReport } from '@/lib/export/adapters';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
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

/** Formata markup como percentual com sinal. Ex: 0.42 → "+42%" */
function fmtMarkup(m: number): string {
  const pct = Math.round(m * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
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
    case 'comprador': return p.comprador_nick;
    case 'unidades': return p.unidades;
    case 'valor': return p.bruto;
    case 'liquido': return p.liquido;
    case 'markup': return p.markup;
    case 'pagamento': return labelStatusPedido(p.status).label;
    case 'envio': return labelStatusEnvio(p.shipping_status, p.shipping_substatus).label;
    case 'origem': return p.is_publiai ? 1 : 0;
  }
}

function Kpi({ icon: Icon, label, valor, tom: tomProp, valorCor, sub }: {
  icon: typeof DollarSign; label: string; valor: string;
  tom?: 'info' | 'success' | 'warning' | 'danger';
  valorCor?: string;
  sub?: string;
}) {
  const cor = tomProp === 'success' ? 'text-success' : tomProp === 'warning' ? 'text-warning'
    : tomProp === 'danger' ? 'text-destructive' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />{label}
      </div>
      <div className={cn('text-lg font-semibold tabular-nums', valorCor)}>{valor}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Miniatura quadrada da foto do produto (signed URL). Fallback: ícone de pacote. */
function ThumbProduto({ path, titulo, size = 36 }: { path: string | null; titulo: string | null; size?: number }) {
  const { data: url } = useImageUrl(path);
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border bg-muted"
      style={{ width: size, height: size }}
      title={titulo ?? undefined}
    >
      {url
        ? <img src={url} alt={titulo ?? ''} loading="lazy" className="h-full w-full object-cover" />
        : <Package className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

/** Pilha de até 3 miniaturas dos produtos do pedido + contador "+N". */
function PilhaThumbs({ itens }: { itens: ItemPedido[] }) {
  const MAX = 3;
  const visiveis = itens.slice(0, MAX);
  const resto = itens.length - visiveis.length;
  return (
    <div className="flex items-center gap-1">
      {visiveis.map((it) => <ThumbProduto key={it.id} path={it.imagem_path} titulo={it.titulo} />)}
      {resto > 0 && <span className="text-xs font-medium tabular-nums text-muted-foreground">+{resto}</span>}
    </div>
  );
}

function LinhaPedido({ p, isNovo, onVisto }: { p: Pedido; isNovo?: boolean; onVisto?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const pgto = labelStatusPedido(p.status);
  const envio = labelStatusEnvio(p.shipping_status, p.shipping_substatus);
  const urlVenda = p.isPack
    ? `https://www.mercadolivre.com.br/vendas/pacote/${p.chave}/detalhe`
    : `https://www.mercadolivre.com.br/vendas/${p.orderIds[0]}/detalhe`;
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
          <span className="flex items-center gap-1">
            {p.isPack && <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pack" />}
            {p.comprador_nick ?? '—'}
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
            <div className="px-10 py-3">
              <div className="mb-2 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div>
                  {p.isPack
                    ? <>Pack <span className="font-medium text-foreground tabular-nums">{p.chave}</span></>
                    : <>Pedido <span className="font-medium text-foreground tabular-nums">{p.orderIds[0]}</span></>}
                </div>
                <div>Comissão ML <span className="font-medium text-foreground tabular-nums">{fmtBRL(p.comissao)}</span></div>
                <div>Frete vendedor <span className="font-medium text-foreground tabular-nums">{p.frete != null ? fmtBRL(p.frete) : '—'}</span></div>
                <div>Rastreio <span className="font-medium text-foreground">{p.rastreio ?? '—'}</span></div>
              </div>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço un.</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead className="text-right">Markup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.itens.map((it) => {
                    const mCor = it.markup == null ? undefined
                      : it.markup >= 0 ? 'text-success' : 'text-destructive';
                    return (
                      <TableRow key={it.id}>
                        <TableCell className="max-w-[280px] uppercase" title={it.titulo ?? ''}>
                          <span className="flex items-center gap-2">
                            <ThumbProduto path={it.imagem_path} titulo={it.titulo} size={28} />
                            <span className="truncate">{it.titulo ?? '—'}</span>
                          </span>
                        </TableCell>
                        <TableCell>{it.cor ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">{it.codigo ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">{it.ean ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(it.unit_price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.custo != null ? fmtBRL(it.custo) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{fmtBRL(it.liquido)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', mCor)}>
                          {it.markup != null ? fmtMarkup(it.markup) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-2">
                <a href={urlVenda} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
                  Ver no Mercado Livre <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AbaVendas() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const [origem, setOrigem] = useState<OrigemVenda>('todos');
  const [sincronizando, setSincronizando] = useState(false);
  const [modoCustom, setModoCustom] = useState(false);
  const [rascunho, setRascunho] = useState(() => rascunhoDe(periodo));
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const presetAtivo = !modoCustom && periodo.tipo === 'preset' ? periodo.dias : null;
  const rascunhoValido = !!rascunho.desde && !!rascunho.ate && rascunho.desde <= rascunho.ate;
  const escolherPreset = (dias: PeriodoDias) => { setModoCustom(false); setPeriodo({ tipo: 'preset', dias }); };
  const abrirCustom = () => { setRascunho(rascunhoDe(periodo)); setModoCustom(true); };
  const aplicarCustom = () => { if (rascunhoValido) setPeriodo({ tipo: 'range', desde: rascunho.desde, ate: rascunho.ate }); };

  const { data: vendas, isFetching, refetch } = useVendas(janela, origem);
  const { data: custos } = useCustos();
  const { data: fotos } = useFotosProduto();

  // Agrupa por pack/order_id → pedidos; calcula KPIs novos
  const pedidos = useMemo(
    () => agruparPorPedido(vendas ?? [], montarCustoResolver(custos), montarPesoResolver(custos), montarFotoResolver(fotos)),
    [vendas, custos, fotos],
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

  // Filtro por status de envio (clique no card de contagem, toggle)
  const [filtroEnvio, setFiltroEnvio] = useState<string | null>(null);
  const toggleFiltroEnvio = (status: string) =>
    setFiltroEnvio((f) => (f === status ? null : status));
  const pedidosFiltrados = useMemo(
    () => filtroEnvio == null
      ? pedidos
      : pedidos.filter((p) => labelStatusEnvio(p.shipping_status, p.shipping_substatus).label === filtroEnvio),
    [pedidos, filtroEnvio],
  );

  const [sort, setSort] = useState<Sort | null>(null);
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
            {PERIODOS.map((p) => (
              <Button key={p.dias} size="sm"
                variant={presetAtivo === p.dias ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => escolherPreset(p.dias)}>
                {p.label}
              </Button>
            ))}
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
        <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(kpis.bruto)} tom="success" />
        <Kpi icon={ShoppingBag} label="Pedidos" valor={fmtInt(kpis.pedidos)} tom="info" />
        <Kpi icon={Package} label="Unidades" valor={fmtInt(kpis.unidades)} tom="info" />
        <Kpi icon={Target} label="Ticket médio" valor={fmtBRL(kpis.ticket)} tom="info" />
        <Kpi icon={Layers} label="Itens / pedido" valor={kpis.itensPorPedido.toFixed(1).replace('.', ',')} tom="info" />
        <Kpi icon={TrendingUp} label="Markup" valor={kpis.markup != null ? fmtMarkup(kpis.markup) : '—'}
          tom={kpis.markup == null ? 'info' : kpis.markup >= 0 ? 'success' : 'danger'}
          valorCor={markupCor} />
        <Kpi icon={Users} label="Compradores" valor={fmtInt(kpis.compradoresUnicos)} tom="info"
          sub={`${kpis.pctRecompra.toFixed(1).replace('.', ',')}% recompra`} />
      </div>

      {/* ── Card de status de envio (clicável para filtrar) ── */}
      <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
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
        {isFetching && (vendas ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        )}
      </div>
    </div>
  );
}
