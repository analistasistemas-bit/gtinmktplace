import { X } from 'lucide-react';
import type { FiltroPublicados } from '@/lib/publicados';

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo', pausado: 'Pausado', encerrado: 'Encerrado',
  moderado: 'Moderado', inativo: 'Inativo', indisponivel: 'Indisponível',
};

export type ChaveFiltro = 'busca' | 'fornecedor' | 'status' | 'tipo';

/** Chips dos filtros ativos da Publicados, cada um removível, + "Limpar tudo". Some se não há filtro. */
export function FiltrosAtivos({
  filtro,
  onRemover,
  onLimpar,
}: {
  filtro: FiltroPublicados;
  onRemover: (chave: ChaveFiltro) => void;
  onLimpar: () => void;
}) {
  const chips: { chave: ChaveFiltro; label: string }[] = [];
  if (filtro.busca?.trim()) chips.push({ chave: 'busca', label: `Busca: "${filtro.busca.trim()}"` });
  if (filtro.fornecedor) chips.push({ chave: 'fornecedor', label: filtro.fornecedor });
  if (filtro.status) chips.push({ chave: 'status', label: STATUS_LABEL[filtro.status] ?? filtro.status });
  if (filtro.tipo) chips.push({ chave: 'tipo', label: filtro.tipo });

  if (chips.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtros:</span>
      {chips.map((c) => (
        <button
          key={c.chave}
          type="button"
          onClick={() => onRemover(c.chave)}
          aria-label={`Remover filtro ${c.label}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
        >
          {c.label}
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
      <button
        type="button"
        onClick={onLimpar}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Limpar tudo
      </button>
    </div>
  );
}
