import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { periodoFromParams, resolverJanela } from '@/lib/metricas';
import { montarDetalheVendas, type SecaoVendas } from '@/lib/detalhe-vendas';
import { useMetricasVendas } from '@/hooks/useMetricasVendas';
import { usePublicados } from '@/hooks/usePublicados';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function rotuloPeriodo(search: URLSearchParams): string {
  const dias = search.get('dias');
  if (dias) return `últimos ${dias} dias`;
  const de = search.get('de');
  const ate = search.get('ate');
  return de && ate ? `${de} a ${ate}` : 'últimos 30 dias';
}

function SecaoTabela({ titulo, sub, secao }: { titulo: string; sub?: string; secao: SecaoVendas }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead>Título</TableHead>
              <TableHead className="text-right">Unid.</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">% total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secao.linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              secao.linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm uppercase">{l.titulo}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{l.unidades}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtBRL(l.valor)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{pct(l.pctTotal)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {secao.linhas.length > 0 && (
            <TableFooter>
              <TableRow className="border-t font-medium">
                <TableCell className="text-sm">Subtotal</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{secao.unidades}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(secao.valor)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{pct(secao.pctTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

export default function DetalheVendas() {
  const [search] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const { data: metricas, isFetching, refetch } = useMetricasVendas(janela);
  const { data: publicados = [] } = usePublicados();

  const semCred = metricas?.semCredencialML;
  const detalhe = useMemo(
    () => montarDetalheVendas(
      metricas ?? { porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } },
      publicados,
    ),
    [metricas, publicados],
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Detalhe de vendas"
        subtitle={`Composição do faturamento — ${rotuloPeriodo(search)}.`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
              {isFetching ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/publicados"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
            </Button>
          </div>
        }
      />

      {semCred && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conecte sua conta ML nas Configurações para ver as vendas.
        </div>
      )}
      {metricas?.erroVendas && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {metricas.erroVendas}
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-card px-4 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Faturamento total</span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(detalhe.total)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{fmtInt(detalhe.pedidos)} pedidos no período</div>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span>Seus anúncios (PubliAI)</span>
            <span className="tabular-nums">{fmtBRL(detalhe.app.valor)} <span className="text-muted-foreground">({pct(detalhe.app.pctTotal)})</span></span>
          </div>
          <div className="flex items-center justify-between">
            <span>Fora do PubliAI</span>
            <span className="tabular-nums">{fmtBRL(detalhe.externo.valor)} <span className="text-muted-foreground">({pct(detalhe.externo.pctTotal)})</span></span>
          </div>
        </div>
      </div>

      <SecaoTabela titulo="Seus anúncios (PubliAI)" secao={detalhe.app} />
      <SecaoTabela titulo="Fora do PubliAI" sub="publicados direto no ML" secao={detalhe.externo} />
    </div>
  );
}
