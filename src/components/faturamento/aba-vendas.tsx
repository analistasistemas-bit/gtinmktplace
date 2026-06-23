import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, ShoppingBag, Package, Target, RefreshCw, ExternalLink, RotateCcw, ArrowUp, ArrowDown, ChevronsUpDown, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { resolverJanela, type PeriodoDias } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { calcularKpis, sincronizarFaturamento, type OrigemVenda, type Venda } from '@/lib/faturamento';
import { labelStatusPedido, labelStatusEnvio, fmtDataCurta } from '@/lib/ml-status';
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

type SortKey = 'data' | 'comprador' | 'unidades' | 'valor' | 'liquido' | 'pagamento' | 'envio' | 'origem';
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

/** Valor comparável de uma venda para a coluna escolhida. null = vai pro fim. */
function valorOrdenacao(v: Venda, k: SortKey): string | number | null {
  switch (k) {
    case 'data': { const d = v.date_closed ?? v.date_created; return d ? Date.parse(d) : null; }
    case 'comprador': return v.comprador_nick;
    case 'unidades': return v.itens.reduce((s, i) => s + i.quantity, 0);
    case 'valor': return v.total_amount;
    case 'liquido': return v.liquido;
    case 'pagamento': return labelStatusPedido(v.status).label;
    case 'envio': return labelStatusEnvio(v.shipping_status).label;
    case 'origem': return v.is_publiai ? 1 : 0;
  }
}

function Kpi({ icon: Icon, label, valor }: { icon: typeof DollarSign; label: string; valor: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />{label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

function LinhaVenda({ v }: { v: Venda }) {
  const [aberto, setAberto] = useState(false);
  const pgto = labelStatusPedido(v.status);
  const envio = labelStatusEnvio(v.shipping_status);
  const resumo = v.itens.length === 1
    ? (v.itens[0].titulo ?? '—')
    : `${v.itens.length} itens`;
  const urlVenda = `https://www.mercadolivre.com.br/vendas/${v.order_id}/detalhe`;
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setAberto((a) => !a)}>
        <TableCell className="w-8 align-middle">
          {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{fmtDataCurta(v.date_closed ?? v.date_created)}</TableCell>
        <TableCell className="max-w-[140px] truncate">{v.comprador_nick ?? '—'}</TableCell>
        <TableCell className="max-w-[280px] truncate" title={resumo}>{resumo}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums">{fmtBRL(v.total_amount)}</TableCell>
        <TableCell className="whitespace-nowrap text-right tabular-nums text-success">{v.liquido != null ? fmtBRL(v.liquido) : '—'}</TableCell>
        <TableCell><StatusPill tone={tom(pgto.tom)}>{pgto.label}</StatusPill></TableCell>
        <TableCell><StatusPill tone={tom(envio.tom)}>{envio.label}</StatusPill></TableCell>
        <TableCell>
          <span className="flex items-center gap-1">
            <StatusPill tone={v.is_publiai ? 'info' : 'neutral'}>{v.is_publiai ? 'PubliAI' : 'Fora'}</StatusPill>
            {v.tem_devolucao && <StatusPill tone="danger"><RotateCcw className="h-3 w-3" />Devolução</StatusPill>}
          </span>
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={9} className="p-0">
            <div className="px-10 py-3">
              <div className="mb-2 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                <div>Pedido <span className="font-medium text-foreground tabular-nums">{v.order_id}</span></div>
                <div>Comissão ML <span className="font-medium text-foreground tabular-nums">{fmtBRL(v.sale_fee_total)}</span></div>
                <div>Frete vendedor <span className="font-medium text-foreground tabular-nums">{v.frete_vendedor != null ? fmtBRL(v.frete_vendedor) : '—'}</span></div>
                <div>Rastreio <span className="font-medium text-foreground">{v.tracking_number ?? '—'}</span></div>
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
                    <TableHead className="text-right">Comissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.itens.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-[280px] truncate" title={i.titulo ?? ''}>{i.titulo ?? '—'}</TableCell>
                      <TableCell>{i.cor ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">{i.codigo ?? '—'}</TableCell>
                      <TableCell className="tabular-nums">{i.ean ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(i.unit_price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBRL(i.sale_fee)}</TableCell>
                    </TableRow>
                  ))}
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
  const [periodo, setPeriodo] = useState<PeriodoDias>(30);
  const [origem, setOrigem] = useState<OrigemVenda>('todos');
  const [sincronizando, setSincronizando] = useState(false);
  const janela = useMemo(() => resolverJanela({ tipo: 'preset', dias: periodo }), [periodo]);
  const { data: vendas, isFetching, refetch } = useVendas(janela, origem);
  const kpis = useMemo(() => calcularKpis(vendas ?? []), [vendas]);

  const [sort, setSort] = useState<Sort | null>(null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'comprador' || k === 'pagamento' || k === 'envio';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };
  const vendasOrdenadas = useMemo(() => {
    const lista = vendas ?? [];
    if (!sort) return lista;
    return [...lista].sort((a, b) => {
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
  }, [vendas, sort]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {PERIODOS.map((p) => (
              <button key={p.dias} onClick={() => setPeriodo(p.dias)}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  periodo === p.dias ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {ORIGENS.map((o) => (
              <button key={o.v} onClick={() => setOrigem(o.v)}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  origem === o.v ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={sincronizar} disabled={sincronizando}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', sincronizando && 'animate-spin')} />
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(kpis.faturamento)} />
        <Kpi icon={ShoppingBag} label="Pedidos" valor={fmtInt(kpis.pedidos)} />
        <Kpi icon={Package} label="Unidades" valor={fmtInt(kpis.unidades)} />
        <Kpi icon={Target} label="Ticket médio" valor={fmtBRL(kpis.ticket)} />
      </div>

      <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Truck className="h-3.5 w-3.5 shrink-0" />Pedidos por tipo de envio
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {Object.entries(kpis.porTipoEnvio).sort((a, b) => b[1] - a[1]).map(([tipo, n]) => (
            <span key={tipo} className="tabular-nums">
              <span className="font-semibold">{n}</span> <span className="text-muted-foreground">{tipo}</span>
            </span>
          ))}
          {Object.keys(kpis.porTipoEnvio).length === 0 && <span className="text-muted-foreground">—</span>}
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <ThSort k="data" label="Data" sort={sort} onSort={toggleSort} />
              <ThSort k="comprador" label="Comprador" sort={sort} onSort={toggleSort} />
              <ThSort k="unidades" label="Itens" sort={sort} onSort={toggleSort} />
              <ThSort k="valor" label="Valor" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liquido" label="Líquido" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="pagamento" label="Pagamento" sort={sort} onSort={toggleSort} />
              <ThSort k="envio" label="Envio" sort={sort} onSort={toggleSort} />
              <ThSort k="origem" label="Origem" sort={sort} onSort={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendasOrdenadas.map((v) => <LinhaVenda key={v.id} v={v} />)}
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
