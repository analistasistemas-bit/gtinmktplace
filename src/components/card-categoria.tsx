import { Tag } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDefinirCategoria } from '@/hooks/useFamiliaMutations';
import { CATEGORIAS_MANUAIS, type TipoCategoriaManual } from '@/lib/categoria';
import type { Familia, TipoAviamento } from '@/lib/tipos-dominio';

function nomeCategoriaAmigavel(tipo: TipoAviamento | null): string {
  return CATEGORIAS_MANUAIS.find((c) => c.tipo === tipo)?.rotulo ?? '—';
}

export function CardCategoria({ familia }: { familia: Familia }) {
  const categoriaIndefinida = !familia.categoriaMlId;
  const definir = useDefinirCategoria(familia.loteId);

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
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-destructive">
            Categoria indefinida — escolha antes de publicar
          </p>
          <Select
            disabled={definir.isPending}
            onValueChange={(v) =>
              definir.mutate(
                { familiaId: familia.id, tipo: v as TipoCategoriaManual },
                { onError: (e) => toast.error('Erro ao definir categoria', { description: (e as Error).message }) },
              )
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={definir.isPending ? 'Salvando…' : 'Escolher categoria'} />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS_MANUAIS.map((c) => (
                <SelectItem key={c.tipo} value={c.tipo}>{c.rotulo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">{nomeCategoriaAmigavel(familia.tipoAviamento)}</p>
          <p className="text-xs text-muted-foreground">{familia.categoriaMlId}</p>
        </>
      )}
    </div>
  );
}
