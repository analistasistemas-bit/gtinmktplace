import { useMemo, useState } from 'react';
import { Wallet, RefreshCw, Receipt, Percent, RotateCcw, ShoppingBag, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useResumoFinanceiro } from '@/hooks/useResumoFinanceiro';
import { resolverJanela, type PeriodoDias } from '@/lib/metricas';

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

function Kpi({ icon: Icon, label, valor, sub, tom }: {
  icon: typeof Wallet; label: string; valor: string; sub?: string;
  tom?: 'info' | 'success' | 'warning' | 'danger';
}) {
  const cor = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
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
        <div className="rounded-lg border bg-card px-4 py-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-success">
            <Wallet className="h-4 w-4 shrink-0" /> Líquido das vendas (você recebe)
          </div>
          <div className="text-3xl font-bold tabular-nums text-success">{fmtBRL(r?.liquido ?? 0)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            de {fmtBRL(r?.bruto ?? 0)} faturados — {pctRetido.toFixed(1).replace('.', ',')}% retido pelo ML
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Kpi icon={Receipt} label="Faturamento bruto" valor={fmtBRL(r?.bruto ?? 0)} />
          <Kpi icon={Percent} label="Taxas e frete (ML)" valor={fmtBRL(r?.descontos ?? 0)} tom="warning" />
          <Kpi icon={RotateCcw} label="Estornos" valor={fmtBRL(r?.estornos ?? 0)} tom="danger" />
          <Kpi icon={Target} label="Ticket médio líquido" valor={fmtBRL(ticketLiquido)} />
        </div>
      </div>

      {/* Quantidade de vendas */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          icon={ShoppingBag}
          label="Vendas no período"
          valor={fmtInt(r?.pagamentos ?? 0)}
          tom="info"
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
