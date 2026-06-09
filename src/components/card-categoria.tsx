import { Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Familia, TipoAviamento } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  switch (tipo) {
    case 'linha': return 'Fios e Cadarços';
    case 'fita': return 'Fita de Cetim';
    case 'botao': return 'Botões';
    default: return '—';
  }
}

export function CardCategoria({ familia }: { familia: Familia }) {
  const categoriaIndefinida = !familia.categoriaMlId;

  return (
    <div
      className={cn(
        'w-[200px] shrink-0 rounded-md border bg-card p-2',
        categoriaIndefinida && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" /> Categoria
      </div>
      {categoriaIndefinida ? (
        <p className="text-xs font-medium text-destructive">
          Categoria indefinida — escolha antes de publicar
        </p>
      ) : (
        <>
          <p className="text-sm font-medium">{nomeCategoriaAmigavel(familia.tipoAviamento)}</p>
          <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
        </>
      )}
    </div>
  );
}
