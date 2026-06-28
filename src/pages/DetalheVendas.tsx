import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { periodoFromParams, resolverJanela, periodoToParams, type Periodo } from '@/lib/metricas';
import { montarDetalheVendas, type LinhaVenda, type SecaoVendas } from '@/lib/detalhe-vendas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { montarCustoResolver, montarPesoResolver } from '@/lib/custos';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

/** Markup como percentual com sinal (ex.: +120%, −5%). */
function fmtMarkup(m: number): string {
  const p = Math.round(m * 100);
  return (p >= 0 ? '+' : '') + p + '%';
}

/** Cor do markup/lucro: verde no positivo, vermelho no negativo, neutro em "—". */
function corValor(v: number | null): string | undefined {
  if (v == null) return undefined;
  return v >= 0 ? 'text-success' : 'text-destructive';
}

// Deriva o rótulo do período JÁ RESOLVIDO (não do query cru) para o texto sempre
// refletir a janela efetivamente consultada, mesmo com URL malformada.
function rotuloPeriodo(periodo: Periodo): string {
  if (periodo.tipo === 'hoje') return 'hoje';
  return periodo.tipo === 'preset'
    ? `últimos ${periodo.dias} dias`
    : `${periodo.desde} a ${periodo.ate}`;
}

type SortKey = 'codigo' | 'ean' | 'titulo' | 'unidades' | 'valor' | 'pctTotal' | 'markup' | 'lucro';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Cabeçalho clicável que ordena a seção pela coluna (seta indica direção). */
function ThSort({ k, label, sort, onSort, align = 'left' }: {
  k: SortKey; label: string; sort: Sort | null; onSort: (k: SortKey) => void; align?: 'left' | 'right';
}) {
  const ativo = sort?.key === k;
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'flex w-full items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' && 'justify-end',
          ativo && 'text-foreground',
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {!ativo ? <ChevronsUpDown className="h-3 w-3 opacity-40" />
          : sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}

function SecaoTabela({ titulo, sub, secao, mostrarMargem = false }: {
  titulo: string; sub?: string; secao: SecaoVendas; mostrarMargem?: boolean;
}) {
  // Ordenação local da seção: textuais começam A→Z; numéricas em maior→menor.
  const [sort, setSort] = useState<Sort | null>(null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'codigo' || k === 'ean' || k === 'titulo';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };

  const linhas = useMemo(() => {
    if (!sort) return secao.linhas;
    const val = (l: LinhaVenda): string | number | null => {
      switch (sort.key) {
        case 'codigo': return l.codigo;
        case 'ean': return l.ean;
        case 'titulo': return l.titulo;
        case 'unidades': return l.unidades;
        case 'valor': return l.valor;
        case 'pctTotal': return l.pctTotal;
        case 'markup': return l.markup;
        case 'lucro': return l.lucro;
      }
    };
    return [...secao.linhas].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // sem valor sempre por último
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [secao.linhas, sort]);

  // 6 colunas-base + (markup, lucro) quando a seção mostra margem.
  const colSpanVazio = mostrarMargem ? 8 : 6;

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
              <ThSort k="codigo" label="Código" sort={sort} onSort={toggleSort} />
              <ThSort k="ean" label="EAN" sort={sort} onSort={toggleSort} />
              <ThSort k="titulo" label="Título" sort={sort} onSort={toggleSort} />
              <ThSort k="unidades" label="Unid." sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="valor" label="Valor" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="pctTotal" label="% total" sort={sort} onSort={toggleSort} align="right" />
              {mostrarMargem && <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />}
              {mostrarMargem && <ThSort k="lucro" label="Lucro" sort={sort} onSort={toggleSort} align="right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpanVazio} className="py-4 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="align-top text-sm tabular-nums text-muted-foreground">{l.codigo ?? '—'}</TableCell>
                  <TableCell className="align-top text-sm tabular-nums text-muted-foreground">{l.ean ?? '—'}</TableCell>
                  <TableCell className="align-top text-sm">
                    <span className="block max-w-[420px] whitespace-normal break-words uppercase">{l.titulo}</span>
                  </TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums">{l.unidades}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums">{fmtBRL(l.valor)}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums">{pct(l.pctTotal)}</TableCell>
                  {mostrarMargem && (
                    <TableCell className={cn('align-top text-right text-sm tabular-nums', corValor(l.markup))}>
                      {l.markup != null ? fmtMarkup(l.markup) : '—'}
                    </TableCell>
                  )}
                  {mostrarMargem && (
                    <TableCell className={cn('align-top text-right text-sm tabular-nums', corValor(l.lucro))}>
                      {l.lucro != null ? fmtBRL(l.lucro) : '—'}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
          {linhas.length > 0 && (
            <TableFooter>
              <TableRow className="border-t font-medium">
                <TableCell colSpan={3} className="text-sm">Subtotal</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{secao.unidades}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(secao.valor)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{pct(secao.pctTotal)}</TableCell>
                {mostrarMargem && (
                  <TableCell className={cn('text-right text-sm tabular-nums', corValor(secao.markup))}>
                    {secao.markup != null ? fmtMarkup(secao.markup) : '—'}
                  </TableCell>
                )}
                {mostrarMargem && (
                  <TableCell className={cn('text-right text-sm tabular-nums', corValor(secao.lucro))}>
                    {secao.markup != null ? fmtBRL(secao.lucro) : '—'}
                  </TableCell>
                )}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

export default function DetalheVendas() {
  const [search, setSearch] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  // Trocar o período reescreve a URL (mantém o link compartilhável e dispara o refetch).
  const onPeriodo = (p: Periodo) => setSearch(periodoToParams(p));

  // Fonte única dos KPIs: tabela ml_vendas (ADR-0038) — mesmo número do card de Faturamento.
  const { data: vendas = [], isFetching, refetch, isError } = useVendas(janela, 'todos');
  const { data: custos } = useCustos();
  const detalhe = useMemo(
    () => montarDetalheVendas(vendas, montarCustoResolver(custos), montarPesoResolver(custos)),
    [vendas, custos],
  );

  return (
    <div className="p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Publicados', to: '/publicados' }, { label: 'Detalhe de vendas' }]} />
      <PageHeader
        title="Detalhe de vendas"
        subtitle={`Composição do faturamento — ${rotuloPeriodo(periodo)}.`}
        actions={
          <div className="flex items-center gap-2">
            <span
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title="Atualiza sozinho a cada 45s — novas vendas entram automaticamente"
            >
              <span className="relative flex h-2 w-2">
                {/* Pulso contínuo = sinal "ao vivo"; acelera no instante do refetch. */}
                <span className={cn(
                  'absolute inline-flex h-full w-full rounded-full bg-success opacity-75',
                  isFetching ? 'animate-ping' : 'animate-[ping_2.5s_ease-in-out_infinite]',
                )} />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Ao vivo
            </span>
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

      <div className="mb-4">
        <SeletorPeriodo periodo={periodo} onPeriodo={onPeriodo} carregando={isFetching} />
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Não foi possível ler as vendas. Tente Atualizar.
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
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

      <SecaoTabela titulo="Seus anúncios (PubliAI)" secao={detalhe.app} mostrarMargem />
      <SecaoTabela titulo="Fora do PubliAI" sub="publicados direto no ML" secao={detalhe.externo} />
    </div>
  );
}
