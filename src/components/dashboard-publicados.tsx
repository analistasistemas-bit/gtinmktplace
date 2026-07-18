import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DollarSign, Package, Receipt, Target, CheckCircle2, AlertTriangle, PackageX, Trophy, TrendingUp, Coins, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { KpiCard, KpiInfoButton } from '@/components/ui/kpi-card';
import type { PublicadoItem } from '@/lib/publicados';
import { calcularResumoPublicados } from '@/lib/resumo-publicados';
import { periodoToParams, type Periodo } from '@/lib/metricas';

interface Props {
  itens: PublicadoItem[];
  totais: { faturamento: number; unidades: number; pedidos: number };
  periodo: Periodo;
  onPeriodo: (p: Periodo) => void;
  carregando?: boolean;
  /** Mensagem quando as vendas não puderam ser lidas (ex.: app sem permissão de Pedidos). */
  aviso?: string | null;
  /** Markup agregado do período (null = sem dados de custo). */
  markupPct?: number | null;
  /** Lucro agregado do período em R$ (null = sem dados de custo). */
  lucro?: number | null;
  /** Filtro "só encalhados" ligado? Reflete o estado do card clicável. */
  somenteEncalhados?: boolean;
  /** Alterna o filtro de encalhados (card vira toggle). */
  onToggleEncalhados?: () => void;
}

export function DashboardPublicados({
  itens, totais, periodo, onPeriodo, carregando, aviso, markupPct, lucro,
  somenteEncalhados, onToggleEncalhados,
}: Props) {
  const queryDetalhe = new URLSearchParams(periodoToParams(periodo)).toString();
  // Markup e lucro andam juntos: ambos só existem quando há custo cadastrado no período.
  const temCusto = markupPct != null;

  const resumo = useMemo(() => calcularResumoPublicados(itens), [itens]);

  const ticket = totais.pedidos > 0 ? totais.faturamento / totais.pedidos : 0;

  return (
    <div className="mb-5 space-y-3">
      <SeletorPeriodo periodo={periodo} onPeriodo={onPeriodo} carregando={carregando} />

      {aviso && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {aviso}
        </div>
      )}

      {/* Vendas */}
      <div className={cn('grid grid-cols-2 gap-3', temCusto ? 'sm:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4')}>
        <Link
          to={{ pathname: '/publicados/vendas', search: queryDetalhe }}
          className="group cursor-pointer rounded-lg outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Faturamento — ver composição"
        >
          <KpiCard size="compact" icon={DollarSign} label="Faturamento" infoKey="Faturamento::Publicados" value={fmtBRL(totais.faturamento)} tom="success" />
        </Link>
        <KpiCard size="compact" icon={Package} label="Unidades vendidas" value={String(totais.unidades)} />
        <KpiCard size="compact" icon={Receipt} label="Pedidos" infoKey="Pedidos::Publicados" value={String(totais.pedidos)} />
        <KpiCard size="compact" icon={Target} label="Ticket médio" infoKey="Ticket médio::Publicados" value={fmtBRL(ticket)} />
        {temCusto && (
          <KpiCard
            size="compact"
            icon={TrendingUp}
            label="Markup no período"
            value={(markupPct >= 0 ? '+' : '') + Math.round(markupPct * 100) + '%'}
            valueClassName={markupPct >= 0 ? 'text-success' : 'text-destructive'}
          />
        )}
        {temCusto && lucro != null && (
          <KpiCard
            size="compact"
            icon={Coins}
            label="Lucro no período"
            value={fmtBRL(lucro)}
            valueClassName={lucro >= 0 ? 'text-success' : 'text-destructive'}
          />
        )}
      </div>

      {/* Saúde + Encalhados + Rankings */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saúde dos anúncios
            <KpiInfoButton infoKey="Saúde dos anúncios" />
          </div>
          <div className="flex items-center justify-between">
            <span>Ativos</span>
            <span className="font-semibold tabular-nums text-success">{resumo.ativos}/{resumo.total}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Com problema</span>
            <span className="font-semibold tabular-nums text-warning">{resumo.comProblema}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <span className="flex items-center gap-1 text-info"><Layers className="h-3.5 w-3.5" /> Variações publicadas</span>
            <span className="font-semibold tabular-nums text-info">{resumo.variacoesPublicadas}</span>
          </div>
        </div>

        {/* Encalhados: card clicável que filtra a lista (toggle). div+role="button" em vez de
            <button> nativo porque o card contém o KpiInfoButton (outro <button>) — <button>
            dentro de <button> é HTML inválido. */}
        <div
          role="button"
          tabIndex={onToggleEncalhados ? 0 : -1}
          aria-disabled={!onToggleEncalhados}
          onClick={onToggleEncalhados}
          onKeyDown={(e) => {
            if (!onToggleEncalhados) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleEncalhados();
            }
          }}
          aria-pressed={!!somenteEncalhados}
          className={cn(
            'rounded-lg border bg-card px-3 py-2.5 text-left text-sm shadow-sm outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring',
            onToggleEncalhados && 'cursor-pointer hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
            somenteEncalhados
              ? 'border-warning ring-2 ring-warning/40'
              : 'hover:border-warning/50',
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <PackageX className="h-3.5 w-3.5 text-warning" /> Encalhados (sem venda no período)
              <KpiInfoButton infoKey="Encalhados (sem venda no período)" />
            </span>
            {somenteEncalhados && <span className="font-medium text-warning">• filtrando</span>}
          </div>
          <div className="text-2xl font-semibold tabular-nums">{resumo.encalhados}</div>
          <div className="text-xs text-muted-foreground">
            {somenteEncalhados
              ? 'clique para mostrar todos de novo'
              : `de ${resumo.ativos} ativo(s) — clique para ver só os encalhados`}
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2.5 text-sm shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-info" /> Top produtos (faturamento)
            <KpiInfoButton infoKey="Top produtos (faturamento)" />
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
