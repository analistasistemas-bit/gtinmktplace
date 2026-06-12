import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
  tamanho: number;
  onIrPara: (pagina: number) => void;
  onTamanho: (n: number) => void;
  rotuloItem?: string;
  tamanhos?: number[];
  className?: string;
}

// Janela de páginas com elipse: primeira, última, atual e vizinhas.
function janelaPaginas(atual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const paginas: (number | '…')[] = [1];
  const ini = Math.max(2, atual - 1);
  const fim = Math.min(total - 1, atual + 1);
  if (ini > 2) paginas.push('…');
  for (let p = ini; p <= fim; p++) paginas.push(p);
  if (fim < total - 1) paginas.push('…');
  paginas.push(total);
  return paginas;
}

export function Pagination({
  paginaAtual,
  totalPaginas,
  inicio,
  fim,
  total,
  tamanho,
  onIrPara,
  onTamanho,
  rotuloItem = 'item',
  tamanhos = [5, 10, 20, 50],
  className,
}: PaginationProps) {
  const plural = total !== 1 ? 's' : '';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-3 text-sm',
        className,
      )}
    >
      <span className="text-muted-foreground">
        {inicio}–{fim} de {total} {rotuloItem}
        {plural}
      </span>

      <div className="flex items-center gap-3">
        {totalPaginas > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => onIrPara(paginaAtual - 1)}
              disabled={paginaAtual <= 1}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {janelaPaginas(paginaAtual, totalPaginas).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === paginaAtual ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 min-w-8 px-2"
                  onClick={() => onIrPara(p)}
                  aria-label={`Página ${p}`}
                  aria-current={p === paginaAtual ? 'page' : undefined}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => onIrPara(paginaAtual + 1)}
              disabled={paginaAtual >= totalPaginas}
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Select value={String(tamanho)} onValueChange={(v) => onTamanho(Number(v))}>
          <SelectTrigger className="h-8 w-[110px] text-sm" aria-label="Itens por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tamanhos.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
