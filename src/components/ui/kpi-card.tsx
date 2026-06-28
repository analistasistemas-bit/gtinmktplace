import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export type DeltaTrend = 'up' | 'down' | 'neutral';

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
}

export function KpiCard({ label, value, icon: Icon, delta, deltaTrend = 'neutral', hint, loading, className, valueClassName, variant = 'default', to }: KpiCardProps) {
  if (loading) {
    return (
      <Card className={cn('h-full p-4', className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
      </Card>
    );
  }
  const trendCls =
    deltaTrend === 'up' ? 'text-success' : deltaTrend === 'down' ? 'text-destructive' : 'text-muted-foreground';
  const TrendIcon = deltaTrend === 'up' ? ArrowUp : deltaTrend === 'down' ? ArrowDown : null;
  const card = (
    <Card className={cn(
      'h-full p-4 transition-all duration-200 hover:shadow-md hover:brightness-105 dark:hover:brightness-110',
      variant === 'brand' && 'bg-[image:var(--brand-gradient-soft)]',
      to && 'cursor-pointer hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/40',
      className,
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
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
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', valueClassName)}>{value}</div>
      {(delta || hint) && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          {delta && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trendCls)}>
              {TrendIcon && <TrendIcon className="h-3 w-3" />}
              {delta}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
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
