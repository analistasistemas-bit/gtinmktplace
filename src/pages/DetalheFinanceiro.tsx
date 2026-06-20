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
import { periodoFromParams, resolverJanela, type Periodo } from '@/lib/metricas';
import { calcularMarkup } from '@/lib/markup';
import { useResumoFinanceiro } from '@/hooks/useResumoFinanceiro';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Markup em % com sinal, ou null quando não há custo para calcular. */
function fmtMarkup(markup: number): string {
  const p = Math.round(markup * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Célula de markup: usa o custo da venda; sem custo cadastrado → "—". */
function CelulaMarkup({ liquido, custo }: { liquido: number; custo: number | null }) {
  if (custo == null || custo <= 0) {
    return <TableCell className="text-right text-sm tabular-nums text-muted-foreground">—</TableCell>;
  }
  const { markup } = calcularMarkup(liquido, custo);
  return (
    <TableCell className={cn('text-right text-sm font-medium tabular-nums', markup >= 0 ? 'text-success' : 'text-destructive')}>
      {fmtMarkup(markup)}
    </TableCell>
  );
}

// Deriva o rótulo do período JÁ RESOLVIDO (não do query cru) para o texto sempre
// refletir a janela efetivamente consultada, mesmo com URL malformada.
function rotuloPeriodo(periodo: Periodo): string {
  return periodo.tipo === 'preset'
    ? `últimos ${periodo.dias} dias`
    : `${periodo.desde} a ${periodo.ate}`;
}

export default function DetalheFinanceiro() {
  const [search] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const { data: r, isFetching, refetch } = useResumoFinanceiro(janela);

  const semCred = r?.semCredencialMP;
  const vendas = r?.vendas ?? [];
  const bruto = r?.bruto ?? 0;
  const liquido = r?.liquido ?? 0;
  const retido = r?.descontos ?? 0;
  const pctRetido = bruto > 0 ? (retido / bruto) * 100 : 0;

  // Markup agregado: só sobre as vendas com custo cadastrado (senão a base ficaria distorcida).
  const markupTotal = useMemo(() => {
    let liq = 0;
    let cst = 0;
    for (const v of vendas) {
      if (v.custo != null && v.custo > 0) { liq += v.liquido; cst += v.custo; }
    }
    return cst > 0 ? calcularMarkup(liq, cst).markup : null;
  }, [vendas]);

  return (
    <div className="p-6">
      <PageHeader
        title="Detalhe do líquido"
        subtitle={`Composição do líquido recebido — ${rotuloPeriodo(periodo)}.`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} />
              {isFetching ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/financeiro"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</Link>
            </Button>
          </div>
        }
      />

      {semCred && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conta Mercado Pago não conectada. Cadastre o Access Token de produção para ver o financeiro.
        </div>
      )}
      {r?.erroFinanceiro && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler o financeiro do Mercado Pago: {r.erroFinanceiro}
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-card px-4 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Líquido total (você recebe)</span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(liquido)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          de {fmtBRL(bruto)} faturados — {pct(pctRetido)} retido pelo ML · {fmtInt(r?.pagamentos ?? 0)} venda(s)
        </div>
      </div>

      {/* Detalhe por venda */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <TableHead>Venda</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Retido (ML)</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead className="text-right">Markup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              vendas.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-sm">
                    <span className="block max-w-[320px] truncate uppercase" title={v.descricao ?? undefined}>
                      {v.descricao || `#${v.id}`}
                    </span>
                    {v.estorno > 0 && (
                      <span className="text-xs text-destructive">estornado {fmtBRL(v.estorno)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{fmtData(v.data)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{fmtBRL(v.bruto)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-warning">{fmtBRL(v.retido)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-success">{fmtBRL(v.liquido)}</TableCell>
                  <CelulaMarkup liquido={v.liquido} custo={v.custo} />
                </TableRow>
              ))
            )}
          </TableBody>
          {vendas.length > 0 && (
            <TableFooter>
              <TableRow className="border-t font-medium">
                <TableCell className="text-sm">Subtotal</TableCell>
                <TableCell />
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(bruto)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-warning">{fmtBRL(retido)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-success">{fmtBRL(liquido)}</TableCell>
                <TableCell className={cn(
                  'text-right text-sm tabular-nums',
                  markupTotal == null ? 'text-muted-foreground'
                    : markupTotal >= 0 ? 'text-success' : 'text-destructive',
                )}>
                  {markupTotal == null ? '—' : fmtMarkup(markupTotal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Cada linha é um pagamento aprovado no período (fonte: Mercado Pago). "Retido" é o que o ML/MP
        desconta da venda (taxas + frete). O "líquido" é o que sobra para o vendedor. O "markup" usa o
        custo cadastrado na importação da planilha: (líquido − custo) ÷ custo; vendas sem custo
        cadastrado ou de produtos fora do PubliAI mostram "—".
      </p>
    </div>
  );
}
