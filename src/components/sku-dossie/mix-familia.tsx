import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtBRLSinal, fmtInt } from '@/lib/formato';
import { SEM_CODIGO } from '@/lib/vendas-sku';
import type { LinhaMix } from '@/lib/sku-dossie';
import { BlocoDossie } from './bloco-dossie';
import { pctBR } from './formato-dossie';

// Idioma do app para "sem valor" (o mesmo da aba Vendas SKU).
const NADA = '—';
const LINK = 'rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
// A chave agregada da família (`familia:P`) e SEM_CODIGO não são dossiês de variação.
const corDelta = (d: number | null) => (d == null || d === 0 ? 'text-muted-foreground' : d > 0 ? 'text-success' : 'text-destructive');
const textoDelta = (d: number | null) => (d == null ? NADA : fmtBRLSinal(d));
const SEM_DELTA = 'Sem Δ: sem venda da variação ou sem histórico no período anterior';
const temDossie = (codigo: string) => codigo !== SEM_CODIGO && !codigo.startsWith('familia:');

/** Variações da composição atual da família no período, inclusive as sem venda. Cada nome abre o
 *  dossiê da variação levando a mesma origem (`de`) do dossiê da família. */
export function MixFamilia({ mix, voltar }: { mix: LinhaMix[]; voltar: string }) {
  return (
    <BlocoDossie id="dossie-mix" titulo="Mix da família" relogio="Variações do catálogo atual no período escolhido · Δ contra o período anterior">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="text-xs hover:bg-transparent">
              <TableHead className="text-muted-foreground">Variação</TableHead>
              <TableHead className="text-right text-muted-foreground sm:w-48">Unidades</TableHead>
              <TableHead className="text-right text-muted-foreground">Lucro</TableHead>
              <TableHead className="hidden text-right text-muted-foreground sm:table-cell">Δ lucro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mix.map((l) => (
              <TableRow key={l.codigo}>
                <TableCell className="w-full max-w-0 py-2.5">
                  {temDossie(l.codigo) ? (
                    <Link to={`/faturamento/sku/${encodeURIComponent(l.codigo)}`} state={{ de: voltar }}
                      className={cn(LINK, 'line-clamp-2 whitespace-normal leading-snug', l.semVendas && 'text-muted-foreground')}>
                      {l.titulo}
                    </Link>
                  ) : <span className="line-clamp-2 whitespace-normal font-medium leading-snug">{l.titulo}</span>}
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                    {l.codigo}
                    {l.semVendas && <StatusPill tone="neutral">sem vendas</StatusPill>}
                  </span>
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums">
                  <span className={cn(l.semVendas && 'text-muted-foreground')}>{fmtInt(l.unidades)}</span>
                  <span className="mt-1 flex items-center justify-end gap-2">
                    <span className="hidden h-1 w-24 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                      <span className="block h-full rounded-full bg-chart-1" style={{ width: `${l.participacaoUnidades * 100}%` }} />
                    </span>
                    <span className="text-xs text-muted-foreground">{pctBR(l.participacaoUnidades)}</span>
                  </span>
                </TableCell>
                <TableCell className={cn('py-2.5 text-right tabular-nums', l.lucro != null && l.lucro < 0 && 'text-destructive')}>
                  {l.lucro == null ? <span className="text-muted-foreground">{NADA}</span> : fmtBRLSinal(l.lucro)}
                  {/* No celular o Δ desce para baixo do lucro: a coluna dele tiraria o espaço do nome. */}
                  <span className={cn('mt-1 block text-xs sm:hidden', corDelta(l.deltaLucro))}>{`Δ ${textoDelta(l.deltaLucro)}`}</span>
                </TableCell>
                <TableCell title={l.deltaLucro == null ? SEM_DELTA : undefined} className={cn('hidden py-2.5 text-right text-xs tabular-nums sm:table-cell', corDelta(l.deltaLucro))}>
                  {textoDelta(l.deltaLucro)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </BlocoDossie>
  );
}
