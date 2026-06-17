import { useMemo } from 'react';
import { DollarSign, Package, Receipt, Target, CheckCircle2, AlertTriangle, PackageX, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import type { PublicadoItem } from '@/lib/publicados';
import type { PeriodoDias } from '@/lib/metricas';

interface Props {
  itens: PublicadoItem[];
  totais: { faturamento: number; unidades: number; pedidos: number };
  periodo: PeriodoDias;
  onPeriodo: (p: PeriodoDias) => void;
  carregando?: boolean;
  /** Mensagem quando as vendas não puderam ser lidas (ex.: app sem permissão de Pedidos). */
  aviso?: string | null;
}

const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

function Kpi({ icon: Icon, label, valor, tom }: {
  icon: typeof DollarSign; label: string; valor: string; tom?: 'info' | 'success' | 'warning';
}) {
  const cor = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning' : 'text-info';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className={cn('mb-1 flex items-center gap-1.5 text-xs text-muted-foreground', cor)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

export function DashboardPublicados({ itens, totais, periodo, onPeriodo, carregando, aviso }: Props) {
  const resumo = useMemo(() => {
    const total = itens.length;
    const ativos = itens.filter((i) => i.status === 'ativo').length;
    const comProblema = itens.filter(
      (i) => i.status === 'moderado' || i.status === 'inativo' || i.status === 'pausado',
    ).length;
    const encalhados = itens.filter(
      (i) => i.status === 'ativo' && (i.unidadesVendidas ?? 0) === 0,
    ).length;
    const topFat = [...itens]
      .filter((i) => (i.valorVendido ?? 0) > 0)
      .sort((a, b) => (b.valorVendido ?? 0) - (a.valorVendido ?? 0))
      .slice(0, 5);
    const topUnid = [...itens]
      .filter((i) => (i.unidadesVendidas ?? 0) > 0)
      .sort((a, b) => (b.unidadesVendidas ?? 0) - (a.unidadesVendidas ?? 0))
      .slice(0, 5);
    return { total, ativos, comProblema, encalhados, topFat, topUnid };
  }, [itens]);

  const ticket = totais.pedidos > 0 ? totais.faturamento / totais.pedidos : 0;

  return (
    <div className="mb-5 space-y-3">
      {/* Seletor de período */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Vendas nos últimos</span>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <Button
              key={p.dias}
              size="sm"
              variant={periodo === p.dias ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs"
              onClick={() => onPeriodo(p.dias)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {carregando && <span className="text-xs text-muted-foreground">atualizando…</span>}
      </div>

      {aviso && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {aviso}
        </div>
      )}

      {/* Vendas */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={DollarSign} label="Faturamento" valor={fmtBRL(totais.faturamento)} tom="success" />
        <Kpi icon={Package} label="Unidades vendidas" valor={String(totais.unidades)} />
        <Kpi icon={Receipt} label="Pedidos" valor={String(totais.pedidos)} />
        <Kpi icon={Target} label="Ticket médio" valor={fmtBRL(ticket)} />
      </div>

      {/* Saúde + Encalhados + Rankings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saúde dos anúncios
          </div>
          <div className="flex items-center justify-between">
            <span>Ativos</span>
            <span className="font-semibold tabular-nums text-success">{resumo.ativos}/{resumo.total}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Com problema</span>
            <span className="font-semibold tabular-nums text-warning">{resumo.comProblema}</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PackageX className="h-3.5 w-3.5 text-warning" /> Encalhados (sem venda no período)
          </div>
          <div className="text-2xl font-semibold tabular-nums">{resumo.encalhados}</div>
          <div className="text-xs text-muted-foreground">
            de {resumo.ativos} ativo(s) — candidatos a revisão de preço/título/foto
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-info" /> Top produtos (faturamento)
          </div>
          {resumo.topFat.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem vendas no período.</div>
          ) : (
            <ul className="space-y-1">
              {resumo.topFat.map((i) => (
                <li key={i.familiaId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate" title={i.titulo}>{i.titulo}</span>
                  <span className="shrink-0 font-medium tabular-nums">{fmtBRL(i.valorVendido ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
