import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, RefreshCw, Receipt, Percent, RotateCcw, ShoppingBag, Target, TrendingUp, Coins, ChevronRight, CalendarClock, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { useResumoVendas } from '@/hooks/useResumoVendas';
import { periodoToParams, resolverJanela, janelaAnterior, type Periodo, type PeriodoDias } from '@/lib/metricas';

function Kpi({ icon: Icon, label, valor, sub, tom, valorCor, delta }: {
  icon: typeof Wallet; label: string; valor: string; sub?: string;
  tom?: 'info' | 'success' | 'warning' | 'danger';
  /** Cor opcional aplicada ao valor (ex.: markup verde/vermelho). */
  valorCor?: string;
  delta?: { texto: string; trend: 'up' | 'down' | 'neutral' };
}) {
  const cor = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className={cn('text-lg font-semibold tabular-nums', valorCor)}>{valor}</div>
      {delta && (
        <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs',
          delta.trend === 'up' ? 'text-success' : delta.trend === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
          {delta.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : delta.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
          {delta.texto}
        </div>
      )}
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function Financeiro() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const { resumo: r, isFetching, refetch, error, dataUpdatedAt } = useResumoVendas(janela);
  const janelaAnt = useMemo(() => janelaAnterior(janela), [janela]);
  const { resumo: rAnt } = useResumoVendas(janelaAnt);

  const delta = (atual: number, anterior: number): { texto: string; trend: 'up' | 'down' | 'neutral' } => {
    if (anterior === 0) return { texto: atual > 0 ? 'novo' : '—', trend: atual > 0 ? 'up' : 'neutral' };
    const p = ((atual - anterior) / Math.abs(anterior)) * 100;
    const trend = p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'neutral';
    return { texto: `${p >= 0 ? '+' : ''}${Math.round(p)}% vs. anterior`, trend };
  };
  const horaAtualizacao = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const pctRetido = r.bruto > 0 ? (r.descontos / r.bruto) * 100 : 0;
  const ticketLiquido = r.pedidos > 0 ? r.liquido / r.pedidos : 0;
  const queryDetalhe = new URLSearchParams(periodoToParams(periodo)).toString();
  const podeDetalhar = r.pedidos > 0;

  const heroDelta = delta(r.liquido, rAnt.liquido);
  const HeroDeltaBar = () => (
    <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs',
      heroDelta.trend === 'up' ? 'text-success' : heroDelta.trend === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
      {heroDelta.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : heroDelta.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
      {heroDelta.texto}
    </div>
  );

  // Markup agregado do período: (líquido − custo) ÷ custo, só sobre as vendas com custo
  // cadastrado (as demais não entram na base, senão distorceria). null = nenhuma com custo.
  const markup = r.markup != null
    ? { pct: r.markup, lucro: r.lucro, n: r.vendas.filter((v) => v.custo != null && v.custo > 0).length }
    : null;

  return (
    <div className="p-6">
      <PageHeader
        title="Financeiro"
        subtitle="Vendas, líquido recebido e o que o Mercado Livre retém — por período."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
            {isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler as vendas. Clique em Atualizar para tentar de novo.
        </div>
      )}

      {/* Seletor de período */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas aprovadas em</span>
        <div className="flex gap-1">
          {([7, 30, 90] as PeriodoDias[]).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={periodo.tipo === 'preset' && periodo.dias === d ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setPeriodo({ tipo: 'preset', dias: d })}
            >
              {d} dias
            </Button>
          ))}
          <Button
            size="sm"
            variant={periodo.tipo === 'range' ? 'default' : 'outline'}
            className="h-7 px-2.5 text-xs"
            onClick={() => setPeriodo((p) =>
              p.tipo === 'range' ? p : { tipo: 'range', desde: '', ate: '' })}
          >
            Personalizado
          </Button>
        </div>
        {periodo.tipo === 'range' && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date" value={periodo.desde} max={periodo.ate || undefined}
              className="h-7 w-[9.5rem] text-xs"
              onChange={(e) => setPeriodo((p) => p.tipo === 'range' ? { ...p, desde: e.target.value } : p)}
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date" value={periodo.ate} min={periodo.desde || undefined}
              className="h-7 w-[9.5rem] text-xs"
              onChange={(e) => setPeriodo((p) => p.tipo === 'range' ? { ...p, ate: e.target.value } : p)}
            />
          </div>
        )}
        {isFetching ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Atualizando…
          </span>
        ) : horaAtualizacao ? (
          <span className="text-xs text-muted-foreground">Atualizado às {horaAtualizacao}</span>
        ) : null}
      </div>

      {/* Destaque: líquido das vendas */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {podeDetalhar ? (
          <Link
            to={{ pathname: '/financeiro/detalhe', search: queryDetalhe }}
            className="group block cursor-pointer rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Líquido das vendas — ver composição"
          >
            <div className="mb-1 flex items-center justify-between gap-1.5 text-xs text-success">
              <span className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
              </span>
              <span className="flex items-center gap-0.5 text-muted-foreground">
                Ver detalhe <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
            <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
            <HeroDeltaBar />
            <div className="mt-1 text-xs text-muted-foreground">
              de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
            </div>
          </Link>
        ) : (
          <div className="rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-success">
              <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
            </div>
            <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
            <HeroDeltaBar />
            <div className="mt-1 text-xs text-muted-foreground">
              de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Kpi icon={Receipt} label="Faturamento bruto" valor={fmtBRL(r?.bruto ?? 0)} delta={delta(r.bruto, rAnt.bruto)} />
          <Kpi icon={Percent} label="Taxas e frete (ML)" valor={fmtBRL(r?.descontos ?? 0)} tom="warning" sub={`comissão ${fmtBRL(r?.comissao ?? 0)} · frete ${fmtBRL(r?.frete ?? 0)}`} />
          <Kpi icon={RotateCcw} label="Estornos" valor={fmtBRL(r?.estornos ?? 0)} tom="danger" />
          <Kpi icon={Target} label="Ticket médio líquido" valor={fmtBRL(ticketLiquido)} />
        </div>
      </div>

      {/* Caixa: liberação dos recebimentos destas vendas (NÃO é o "A receber" do MP) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Kpi
          icon={Wallet}
          label="Já liberado"
          valor={fmtBRL(r?.liberado ?? 0)}
          tom="success"
          sub="recebimentos destas vendas já no saldo"
        />
        <Kpi
          icon={CalendarClock}
          label="A liberar"
          valor={fmtBRL(r?.aLiberar ?? 0)}
          tom="warning"
          sub={r?.proximaLiberacao
            ? `próxima em ${new Date(r.proximaLiberacao).toLocaleDateString('pt-BR')}`
            : 'nada pendente de liberação'}
        />
      </div>

      {/* Quantidade de vendas + markup do período */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi
          icon={ShoppingBag}
          label="Vendas no período"
          valor={fmtInt(r.pedidos)}
          tom="info"
          delta={delta(r.pedidos, rAnt.pedidos)}
        />
        <Kpi
          icon={TrendingUp}
          label="Markup no período"
          valor={markup ? `${markup.pct >= 0 ? '+' : ''}${Math.round(markup.pct * 100)}%` : '—'}
          valorCor={markup ? (markup.pct >= 0 ? 'text-success' : 'text-destructive') : undefined}
          tom={markup && markup.pct < 0 ? 'danger' : 'success'}
          sub={markup
            ? `lucro ${fmtBRL(markup.lucro)} · ${markup.n} venda(s) c/ custo`
            : 'sem custo cadastrado nas vendas'}
        />
        <Kpi
          icon={Coins}
          label="Lucro líquido no período"
          valor={r.margem != null ? fmtBRL(r.lucro) : '—'}
          valorCor={r.margem != null ? (r.lucro >= 0 ? 'text-success' : 'text-destructive') : undefined}
          tom={r.margem != null && r.lucro < 0 ? 'danger' : 'success'}
          delta={delta(r.lucro, rAnt.lucro)}
          sub={r.margem != null
            ? `margem ${Math.round(r.margem * 100)}% · sobre ${r.vendasComCusto}/${r.totalVendas} venda(s) c/ custo`
            : 'sem custo cadastrado nas vendas'}
        />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Vendas do período (fonte: pedidos do Mercado Livre — mesma base de Publicados e Faturamento).
        O bruto segue o "Vendas brutas" do ML (inclui vendas reembolsadas). O "líquido" é o que o
        vendedor recebe após taxas do ML/Mercado Pago e frete. A previsão de "a receber / lançamentos
        futuros" não é exposta de forma confiável pela API e fica no app do Mercado Pago.
      </p>
    </div>
  );
}
