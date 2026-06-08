import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger: 'bg-danger/10 text-danger border-danger/20',
  info: 'bg-info/10 text-info border-info/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

interface StatusPillProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function StatusPill({ tone = 'neutral', children, className, title }: StatusPillProps) {
  return (
    <span
      data-tone={tone}
      title={title}
      className={cn('inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CLASSES[tone], className)}
    >
      {children}
    </span>
  );
}
