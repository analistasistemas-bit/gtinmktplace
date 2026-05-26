import type { ReactNode } from 'react';

interface TopbarProps {
  breadcrumb: string;
  actions?: ReactNode;
}

export function Topbar({ breadcrumb, actions }: TopbarProps) {
  return (
    <header className="flex h-11 items-center justify-between border-b bg-background px-4 text-sm">
      <span className="text-muted-foreground">{breadcrumb}</span>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
