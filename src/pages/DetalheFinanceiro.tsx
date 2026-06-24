import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronsUpDown, Download, RefreshCw } from 'lucide-react';
import { montarCsv, baixarCsv } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { periodoFromParams, resolverJanela, type Periodo } from '@/lib/metricas';
import { calcularMarkup } from '@/lib/markup';
import type { VendaResumo } from '@/lib/resumo-vendas';
import { useResumoVendas } from '@/hooks/useResumoVendas';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Célula de liberação: data que o ML libera o recebimento + status (liberado/a liberar).
 *  Passado = já caiu no saldo (verde); futuro = ainda retido (âmbar). */
function CelulaLiberacao({ iso }: { iso: string | null }) {
  if (!iso) {
    return <TableCell className="align-top whitespace-nowrap text-sm tabular-nums text-muted-foreground">—</TableCell>;
  }
  const liberado = new Date(iso).getTime() <= Date.now();
  return (
    <TableCell className="align-top whitespace-nowrap text-sm tabular-nums">
      <span className="block">{fmtData(iso)}</span>
      <span className={cn('text-xs', liberado ? 'text-success' : 'text-warning')}>
        {liberado ? 'liberado' : 'a liberar'}
      </span>
    </TableCell>
  );
}

/** Markup em % com sinal, ou null quando não há custo para calcular. */
function fmtMarkup(markup: number): string {
  const p = Math.round(markup * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Markup (fração) da venda, ou null quando não há custo cadastrado. */
function markupValor(v: VendaResumo): number | null {
  return v.custo != null && v.custo > 0 ? calcularMarkup(v.liquido, v.custo).markup : null;
}

/** Célula de markup: usa o custo da venda; sem custo cadastrado → "—". */
function CelulaMarkup({ liquido, custo }: { liquido: number; custo: number | null }) {
  if (custo == null || custo <= 0) {
    return <TableCell className="text-right text-sm tabular-nums text-muted-foreground align-top">—</TableCell>;
  }
  const { markup } = calcularMarkup(liquido, custo);
  return (
    <TableCell className={cn('text-right text-sm font-medium tabular-nums align-top', markup >= 0 ? 'text-success' : 'text-destructive')}>
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

type SortKey = 'codigo' | 'descricao' | 'data' | 'liberacao' | 'bruto' | 'retido' | 'liquido' | 'markup';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Cabeçalho clicável que ordena pela coluna (seta indica direção). */
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

export default function DetalheFinanceiro() {
  const [search] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);

  const { resumo: r, isFetching, refetch, error } = useResumoVendas(janela);

  const vendas = r.vendas;
  const bruto = r.bruto;
  const liquido = r.liquido;
  const retido = r.descontos;
  const pctRetido = bruto > 0 ? (retido / bruto) * 100 : 0;

  // Ordenação: colunas textuais começam em A→Z; numéricas/data em maior→menor (mais recente).
  const [sort, setSort] = useState<Sort | null>(null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'codigo' || k === 'descricao';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };

  const vendasOrdenadas = useMemo(() => {
    if (!sort) return vendas;
    const val = (v: VendaResumo): string | number | null => {
      switch (sort.key) {
        case 'codigo': return v.codigo;
        case 'descricao': return v.descricao;
        case 'data': return v.data;
        case 'liberacao': return v.dataLiberacao;
        case 'bruto': return v.bruto;
        case 'retido': return v.retido;
        case 'liquido': return v.liquido;
        case 'markup': return markupValor(v);
      }
    };
    return [...vendas].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // sem valor sempre por último
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [vendas, sort]);

  // Markup agregado: só sobre as vendas com custo cadastrado (senão a base ficaria distorcida).
  const markupTotal = useMemo(() => {
    let liq = 0;
    let cst = 0;
    for (const v of vendas) {
      if (v.custo != null && v.custo > 0) { liq += v.liquido; cst += v.custo; }
    }
    return cst > 0 ? calcularMarkup(liq, cst).markup : null;
  }, [vendas]);

  const exportar = () => {
    const linhas = vendasOrdenadas.map((v) => {
      const mv = markupValor(v);
      return {
        codigo: v.codigo, produto: v.descricao ?? `#${v.id}`, data: fmtData(v.data),
        liberacao: fmtData(v.dataLiberacao),
        situacao: v.dataLiberacao ? (new Date(v.dataLiberacao).getTime() <= Date.now() ? 'liberado' : 'a liberar') : '',
        bruto: v.bruto, retido: v.retido, liquido: v.liquido,
        markup: mv != null ? `${Math.round(mv * 100)}%` : '',
      };
    });
    const csv = montarCsv(linhas, [
      { chave: 'codigo', titulo: 'Código' }, { chave: 'produto', titulo: 'Produto' },
      { chave: 'data', titulo: 'Data' }, { chave: 'liberacao', titulo: 'Liberação' },
      { chave: 'situacao', titulo: 'Situação' }, { chave: 'bruto', titulo: 'Bruto' },
      { chave: 'retido', titulo: 'Retido' }, { chave: 'liquido', titulo: 'Líquido' },
      { chave: 'markup', titulo: 'Markup' },
    ]);
    baixarCsv(`financeiro-${rotuloPeriodo(periodo).replace(/[^0-9a-z]+/gi, '-')}.csv`, csv);
  };

  return (
    <div className="p-6">
      <Breadcrumbs items={[{ label: 'Financeiro', to: '/financeiro' }, { label: 'Detalhe do líquido' }]} />
      <PageHeader
        title="Detalhe do líquido"
        subtitle={`Composição do líquido recebido — ${rotuloPeriodo(periodo)}.`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportar} disabled={vendasOrdenadas.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />Exportar CSV
            </Button>
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

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler as vendas. Clique em Atualizar para tentar de novo.
        </div>
      )}

      {/* Resumo */}
      <div className="mb-5 rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Líquido total (você recebe)</span>
          <span className="text-2xl font-bold tabular-nums text-success">{fmtBRL(liquido)}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          de {fmtBRL(bruto)} faturados — {pct(pctRetido)} retido pelo ML · {fmtInt(r.pedidos)} venda(s)
        </div>
      </div>

      {/* Detalhe por venda */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <ThSort k="codigo" label="Código" sort={sort} onSort={toggleSort} />
              <ThSort k="descricao" label="Produto" sort={sort} onSort={toggleSort} />
              <ThSort k="data" label="Data" sort={sort} onSort={toggleSort} />
              <ThSort k="liberacao" label="Liberação" sort={sort} onSort={toggleSort} />
              <ThSort k="bruto" label="Bruto" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="retido" label="Retido (ML)" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="liquido" label="Líquido" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendasOrdenadas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                  Sem vendas no período.
                </TableCell>
              </TableRow>
            ) : (
              vendasOrdenadas.map((v) => {
                // Venda no prejuízo: o líquido recebido ficou abaixo do custo (markup negativo).
                const prejuizo = v.custo != null && v.custo > 0 && v.liquido < v.custo;
                return (
                <TableRow key={v.id} className={cn(prejuizo && 'bg-destructive/10')}>
                  <TableCell className={cn(
                    'align-top text-sm tabular-nums text-muted-foreground',
                    prejuizo && 'border-l-2 border-l-destructive',
                  )}>{v.codigo ?? '—'}</TableCell>
                  <TableCell className="align-top text-sm">
                    <span className="block max-w-[360px] whitespace-normal break-words uppercase">
                      {v.descricao || `#${v.id}`}
                    </span>
                    {v.estorno > 0 && (
                      <span className="text-xs text-destructive">estornado {fmtBRL(v.estorno)}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top whitespace-nowrap text-sm tabular-nums">{fmtData(v.data)}</TableCell>
                  <CelulaLiberacao iso={v.dataLiberacao} />
                  <TableCell className="align-top text-right text-sm tabular-nums">{fmtBRL(v.bruto)}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums text-warning">{fmtBRL(v.retido)}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums text-success">{fmtBRL(v.liquido)}</TableCell>
                  <CelulaMarkup liquido={v.liquido} custo={v.custo} />
                </TableRow>
                );
              })
            )}
          </TableBody>
          {vendasOrdenadas.length > 0 && (
            <TableFooter>
              <TableRow className="border-t font-medium">
                <TableCell colSpan={4} className="text-sm">Subtotal</TableCell>
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
        Cada linha é uma venda do período (fonte: pedidos do Mercado Livre). "Retido" é o que o ML/MP
        desconta da venda (taxas + frete). Em pedidos com vários produtos (mesmo envio), o frete é
        rateado entre os itens por peso. O "líquido" é o que sobra para o vendedor. O "markup" usa o
        custo cadastrado na importação da planilha: (líquido − custo) ÷ custo; vendas sem custo
        cadastrado ou de produtos fora do PubliAI mostram "—". "Liberação" é a data em que o
        Mercado Livre libera aquele recebimento para saque ("a liberar" = ainda retido; "liberado"
        = já no saldo). Linhas destacadas em vermelho são vendas no prejuízo (líquido abaixo do
        custo). Clique no cabeçalho para ordenar.
      </p>
    </div>
  );
}
