import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

/** Trilha de navegação hierárquica. O último item é a página atual (texto, não link). */
export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav
      aria-label="Trilha de navegação"
      className={cn('mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground', className)}
    >
      {items.map((item, i) => {
        const ultimo = i === items.length - 1;
        return (
          <Fragment key={i}>
            {item.to && !ultimo ? (
              <Link to={item.to} className="transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span
                className={ultimo ? 'font-medium text-foreground' : undefined}
                aria-current={ultimo ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
            {!ultimo && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
