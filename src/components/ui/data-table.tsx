import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Valor usado para ordenar esta coluna. Presente = cabeçalho vira botão de ordenação. */
  sortValue?: (row: T) => string | number | null;
  /** Opt-in: fixa a coluna à direita (sticky) para sobreviver ao scroll horizontal — ex.: ações. */
  stickyRight?: boolean;
}

export type SortDir = 'asc' | 'desc';

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  skeletonRows?: number;
  className?: string;
  /** Coluna ordenada ao montar (precisa ter `sortValue`). */
  defaultSort?: { key: string; dir: SortDir };
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}

/** Nulos sempre no fim, independentemente da direção — "sem dado" não é o menor valor. */
function comparar(a: string | number | null, b: string | number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const base = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
  return dir === 'asc' ? base : -base;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  skeletonRows = 5,
  className,
  defaultSort,
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort ?? null);

  const ordenadas = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : null;
    if (!col?.sortValue || !sort) return rows;
    const fn = col.sortValue;
    return [...rows].sort((a, b) => comparar(fn(a), fn(b), sort.dir));
  }, [rows, columns, sort]);

  const alternar = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  // `w-full` faz a tabela CABER comprimindo colunas em vez de estourar; com uma coluna fixa e
  // opaca por cima, as comprimidas ficam embaixo dela e inalcançáveis. `w-max min-w-full` dimensiona
  // pelo conteúdo e devolve a rolagem — medido no Sonar: "Envio" invisível em 1440, e "Vendidos" a
  // "Envio" inalcançáveis em 820.
  const temColunaFixa = columns.some((c) => c.stickyRight);

  return (
    <Table
      containerClassName={cn('rounded-lg border', className)}
      containerProps={{
        tabIndex: 0,
        role: 'region',
        'aria-label': 'Tabela de dados',
      }}
      className={temColunaFixa ? 'w-max min-w-full' : undefined}
    >
        <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
          <TableRow>
            {columns.map((c) => {
              const ativa = sort?.key === c.key;
              const Icone = !ativa ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
              return (
                <TableHead
                  key={c.key}
                  className={cn(
                    c.className,
                    c.stickyRight && 'sticky right-0 z-20 border-l bg-muted/50 backdrop-blur',
                  )}
                  // aria-sort pertence ao cabeçalho da coluna, não ao botão dentro dele.
                  aria-sort={c.sortValue ? (ativa ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => alternar(c.key)}
                      // Sem aria-label: ele viraria o nome acessível do <th> e cada célula da
                      // coluna seria anunciada como "Ordenar por X". O texto do header já nomeia,
                      // e aria-sort já comunica o estado.
                      className={cn(
                        'group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        ativa && 'text-foreground',
                      )}
                    >
                      {c.header}
                      <Icone
                        className={cn(
                          'h-3 w-3 shrink-0 transition-opacity',
                          ativa ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
                        )}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(c.stickyRight && 'sticky right-0 z-10 border-l bg-background')}
                  >
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : ordenadas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    Nenhum resultado.
                  </div>
                )}
              </TableCell>
            </TableRow>
          ) : (
            ordenadas.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={cn(
                  onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  rowClassName?.(row),
                )}
                // Linha clicável precisa ser alcançável pelo teclado. Mantemos role="row" (trocar
                // por "button" órfã os <td> e o leitor anuncia a linha inteira como um controle só).
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        // Sem esta guarda, Espaço/Enter num botão DENTRO da linha borbulha e abre
                        // o detalhe em vez de acionar o botão.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      c.className,
                      c.stickyRight && 'sticky right-0 z-10 border-l bg-background',
                    )}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
  );
}
