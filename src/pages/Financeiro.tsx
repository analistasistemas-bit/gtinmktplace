import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, RefreshCw, Receipt, Percent, RotateCcw, ShoppingBag, Target, TrendingUp, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useResumoFinanceiro } from '@/hooks/useResumoFinanceiro';
import { periodoToParams, resolverJanela, type PeriodoDias } from '@/lib/metricas';

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

function Kpi({ icon: Icon, label, valor, sub, tom, valorCor }: {
  icon: typeof Wallet; label: string; valor: string; sub?: string;
  tom?: 'info' | 'success' | 'warning' | 'danger';
  /** Cor opcional aplicada ao valor (ex.: markup verde/vermelho). */
  valorCor?: string;
}) {
  const cor = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className={cn('text-lg font-semibold tabular-nums', valorCor)}>{valor}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function Financeiro() {
  const [periodo, setPeriodo] = useState<PeriodoDias>(30);
  const janela = useMemo(() => resolverJanela({ tipo: 'preset', dias: periodo }), [periodo]);
  const { data: r, isFetching, refetch } = useResumoFinanceiro(janela);

  const semCred = r?.semCredencialMP;
  const pctRetido = r && r.bruto > 0 ? (r.descontos / r.bruto) * 100 : 0;
  const ticketLiquido = r && r.pagamentos > 0 ? r.liquido / r.pagamentos : 0;
  const queryDetalhe = new URLSearchParams(periodoToParams({ tipo: 'preset', dias: periodo })).toString();
  const podeDetalhar = !!r && !semCred && !r.erroFinanceiro;

  // Markup agregado do período: (líquido − custo) ÷ custo, só sobre as vendas com custo
  // cadastrado (as demais não entram na base, senão distorceria). null = nenhuma com custo.
  const markup = useMemo(() => {
    let liq = 0;
    let cst = 0;
    let n = 0;
    for (const v of r?.vendas ?? []) {
      if (v.custo != null && v.custo > 0) { liq += v.liquido; cst += v.custo; n += 1; }
    }
    return cst > 0 ? { pct: (liq - cst) / cst, lucro: liq - cst, n } : null;
  }, [r]);

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

      {semCred && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conta Mercado Pago não conectada. Cadastre o Access Token de produção para ver o financeiro.
        </div>
      )}
      {r?.erroFinanceiro && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler o financeiro do Mercado Pago: {r.erroFinanceiro}
        </div>
      )}

      {/* Seletor de período */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas aprovadas nos últimos</span>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <Button
              key={p.dias}
              size="sm"
              variant={periodo === p.dias ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setPeriodo(p.dias)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {isFetching && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>

      {/* Destaque: líquido das vendas */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {podeDetalhar ? (
          <Link
            to={{ pathname: '/financeiro/detalhe', search: queryDetalhe }}
            className="group block rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm outline-none ring-offset-background transition-all hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Líquido das vendas — ver composição"
          >
            <div className="mb-1 flex items-center justify-between gap-1.5 text-xs text-success">
              <span className="flex items-center gap-1.5">
                <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
              </span>
              <span className="flex items-center gap-0.5 text-muted-foreground">
                Ver detalhe <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
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
            <div className="mt-1 text-xs text-muted-foreground">
              de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Kpi icon={Receipt} label="Faturamento bruto" valor={fmtBRL(r?.bruto ?? 0)} />
          <Kpi icon={Percent} label="Taxas e frete (ML)" valor={fmtBRL(r?.descontos ?? 0)} tom="warning" />
          <Kpi icon={RotateCcw} label="Estornos" valor={fmtBRL(r?.estornos ?? 0)} tom="danger" />
          <Kpi icon={Target} label="Ticket médio líquido" valor={fmtBRL(ticketLiquido)} />
        </div>
      </div>

      {/* Quantidade de vendas + markup do período */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon={ShoppingBag}
          label="Vendas no período"
          valor={fmtInt(r?.pagamentos ?? 0)}
          tom="info"
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
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Valores das vendas aprovadas no período (fonte: pagamentos do Mercado Pago). O "líquido" é
        o que o vendedor recebe após taxas do ML/Mercado Pago e frete. A previsão de datas de
        liberação ("a receber") não é exposta de forma confiável pela API e fica no app do Mercado Pago.
      </p>
    </div>
  );
}
