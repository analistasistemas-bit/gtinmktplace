// Cabeçalho de etapas compartilhado pelos dialogs de criação de kit (vinculado e com variação):
// pílulas "1. Montagem · 2. Anúncio …", a atual destacada. Identidade única de criação de kits.
import { cn } from '@/lib/utils';

export function EtapasKit<T extends string>({ etapas, atual }: {
  etapas: ReadonlyArray<{ id: T; rotulo: string }>;
  atual: T;
}) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Etapas">
      {etapas.map((e, i) => (
        <li
          key={e.id}
          aria-current={atual === e.id ? 'step' : undefined}
          className={cn('rounded-full border px-2 py-0.5', atual === e.id ? 'border-primary/30 bg-primary/10 text-primary' : 'text-muted-foreground')}
        >
          {i + 1}. {e.rotulo}
        </li>
      ))}
    </ol>
  );
}
