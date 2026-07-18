import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getKpiDescription } from '@/lib/kpi-descriptions';

export type DeltaTrend = 'up' | 'down' | 'neutral';
export type KpiTom = 'info' | 'success' | 'warning' | 'danger';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: ComponentType<{ className?: string }>;
  delta?: string;
  deltaTrend?: DeltaTrend;
  hint?: string;
  loading?: boolean;
  className?: string;
  /** Classe aplicada ao valor (ex.: cor verde/vermelha do markup). */
  valueClassName?: string;
  variant?: 'default' | 'brand';
  /** Quando presente, o card vira um link navegável (drill-down) com affordance. */
  to?: string;
  /** 'compact' reproduz o card pequeno hoje duplicado em Publicados/Financeiro/Faturamento. */
  size?: 'default' | 'compact';
  /** Cor do ícone/label — só tem efeito em size="compact" (default visual não usa `tom`). */
  tom?: KpiTom;
  /** Chave no dicionário de descrições (default: usa o próprio `label`). Só precisa ser passada
   *  explicitamente pelos KPIs cujo cálculo diverge entre telas — ver kpi-descriptions.ts. */
  infoKey?: string;
}

/**
 * Ícone "i" clicável que abre um popover com a explicação do KPI. Não renderiza nada se a chave
 * não tiver descrição no dicionário (silencioso de propósito — ver o teste de guarda de
 * cobertura em kpi-descriptions.test.ts, que garante que todo KPI em produção tem entrada).
 */
export function KpiInfoButton({ infoKey, tom }: { infoKey: string; tom?: KpiTom }) {
  const texto = getKpiDescription(infoKey);
  const [open, setOpen] = useState(false);
  if (!texto) return null;
  const titulo = infoKey.split('::')[0];
  const tomCls = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que é ${titulo}`}
          onClick={(e) => {
            // Card pode estar dentro de um <Link>/<button>: preventDefault bloqueia a navegação
            // nativa do <a>, mas o Radix pula o próprio toggle quando vê defaultPrevented — por
            // isso controlamos `open` manualmente aqui em vez de depender do toggle interno dele.
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full p-3 -m-3 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground',
            tomCls,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-semibold text-foreground">{titulo}</div>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  );
}

export function KpiCard({
  label, value, icon: Icon, delta, deltaTrend = 'neutral', hint, loading, className, valueClassName,
  variant = 'default', to, size = 'default', tom, infoKey,
}: KpiCardProps) {
  const compact = size === 'compact';

  if (loading) {
    return compact ? (
      <div className={cn('h-full rounded-lg border bg-card px-3 py-2.5 shadow-sm', className)}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-6 w-16" />
      </div>
    ) : (
      <Card className={cn('h-full p-4', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
      </Card>
    );
  }

  const trendCls =
    deltaTrend === 'up' ? 'text-success' : deltaTrend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const TrendIcon = deltaTrend === 'up' ? ArrowUp : deltaTrend === 'down' ? ArrowDown : null;
  const tomCls = tom === 'success' ? 'text-success' : tom === 'warning' ? 'text-warning'
    : tom === 'danger' ? 'text-destructive' : 'text-info';

  const valueEl = (
    <div className={cn(compact ? 'text-lg' : 'mt-2 text-2xl', 'font-semibold tabular-nums tracking-tight', valueClassName)}>
      {value}
    </div>
  );

  const deltaHintEl = compact ? (
    <>
      {delta && (
        <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs', trendCls)}>
          {TrendIcon && <TrendIcon className="h-3 w-3" />}
          {delta}
        </div>
      )}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </>
  ) : (
    (delta || hint) && (
      <div className="mt-1 flex items-center gap-1 text-xs">
        {delta && (
          <span className={cn('inline-flex items-center gap-0.5 font-medium', trendCls)}>
            {TrendIcon && <TrendIcon className="h-3 w-3" />}
            {delta}
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    )
  );

  const content = compact ? (
    <>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', tomCls)} />}
        <span className={tomCls}>{label}</span>
        <KpiInfoButton infoKey={infoKey ?? label} tom={tom} />
      </div>
      {valueEl}
      {deltaHintEl}
    </>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          <KpiInfoButton infoKey={infoKey ?? label} />
        </span>
        {Icon && (
          <span className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg',
            variant === 'brand'
              ? 'bg-[image:var(--brand-gradient)] text-primary-foreground shadow-brand'
              : 'text-muted-foreground'
          )}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      {valueEl}
      {deltaHintEl}
    </>
  );

  const card = compact ? (
    <div className={cn(
      'h-full rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
      to && 'cursor-pointer',
      className,
    )}>
      {content}
    </div>
  ) : (
    <Card className={cn(
      'h-full p-4 transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
      variant === 'brand' && 'bg-[image:var(--brand-gradient-soft)]',
      to && 'cursor-pointer hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/40',
      className,
    )}>
      {content}
    </Card>
  );

  return to ? (
    <Link
      to={to}
      aria-label={`${label} — ver detalhes`}
      className="block h-full rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
