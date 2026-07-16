import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronsUpDown, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt, fmtMarkup } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { periodoFromParams, resolverJanela, periodoToParams, type Periodo } from '@/lib/metricas';
import { montarDetalheVendas, type LinhaVenda, type SecaoVendas, type Taxas } from '@/lib/detalhe-vendas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useSessionState } from '@/hooks/useSessionState';

/** URL do anúncio no ML a partir do ml_item_id (ex.: MLB123 → produto.mercadolivre.com.br/MLB-123). */
function urlAnuncioML(mlItemId: string): string {
  return `https://produto.mercadolivre.com.br/${mlItemId.replace(/^MLB/, 'MLB-')}`;
}
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { useAliquotas } from '@/hooks/useConfiguracoes';

function pct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
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
  if (periodo.tipo === 'mes_atual') return 'mês atual';
  return periodo.tipo === 'preset'
    ? `últimos ${periodo.dias} dias`
    : `${periodo.desde} a ${periodo.ate}`;
}

type SortKey = 'codigo' | 'ean' | 'titulo' | 'unidades' | 'valor' | 'pctTotal' | 'taxas' | 'custo' | 'markup' | 'lucro';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Célula "Taxas": mostra a soma e, no hover, o balão com comissão + frete + imposto. */
function CelulaTaxas({ taxas, className }: { taxas: Taxas; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('cursor-help underline decoration-dotted underline-offset-2', className)}>
          {fmtBRL(taxas.total)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="min-w-[9.5rem] space-y-0.5">
          <LinhaTaxa label="Comissão ML" v={taxas.comissao} />
          <LinhaTaxa label="Frete" v={taxas.frete} />
          <LinhaTaxa label="Imposto" v={taxas.imposto} />
          <div className="mt-1 border-t border-background/25 pt-1">
            <LinhaTaxa label="Total" v={taxas.total} forte />
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function LinhaTaxa({ label, v, forte = false }: { label: string; v: number; forte?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4', forte && 'font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">{fmtBRL(v)}</span>
    </div>
  );
}

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

function SecaoTabela({ titulo, sub, secao, mostrarMargem = false, linkavel = false, busca = '' }: {
  titulo: string; sub?: string; secao: SecaoVendas; mostrarMargem?: boolean;
  /** Linka o título ao anúncio no ML (só seção PubliAI, cujo LinhaVenda.id é o ml_item_id). */
  linkavel?: boolean;
  busca?: string;
}) {
  // Ordenação da seção: textuais começam A→Z; numéricas em maior→menor.
  // Persistida por seção (sobrevive a remount/refetch); chave = título da seção.
  const [sort, setSort] = useSessionState<Sort | null>(`sort:detalhe-vendas:${titulo}`, null);
  const toggleSort = (k: SortKey) => {
    const textual = k === 'codigo' || k === 'ean' || k === 'titulo';
    setSort((s) => (s?.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: textual ? 'asc' : 'desc' }));
  };

  const linhas = useMemo(() => {
    let base = secao.linhas;
    const q = busca.trim().toLowerCase();
    if (q) {
      base = base.filter((l) =>
        l.titulo.toLowerCase().includes(q)
        || (l.codigo ?? '').toLowerCase().includes(q)
        || (l.ean ?? '').toLowerCase().includes(q));
    }
    if (!sort) return base;
    const val = (l: LinhaVenda): string | number | null => {
      switch (sort.key) {
        case 'codigo': return l.codigo;
        case 'ean': return l.ean;
        case 'titulo': return l.titulo;
        case 'unidades': return l.unidades;
        case 'valor': return l.valor;
        case 'pctTotal': return l.pctTotal;
        case 'taxas': return l.taxas.total;
        case 'custo': return l.custo;
        case 'markup': return l.markup;
        case 'lucro': return l.lucro;
      }
    };
    return [...base].sort((a, b) => {
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
  }, [secao.linhas, sort, busca]);

  // Com busca ativa, o subtotal do rodapé reflete só as linhas filtradas (senão o número
  // confunde: mostra 4 linhas na tela mas soma o total da seção inteira). Sem busca, usa
  // secao.* como sempre (evita reintroduzir arredondamento onde já não havia).
  const totais = useMemo(() => {
    if (!busca.trim()) return secao;
    const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
    const valor = linhas.reduce((a, l) => a + l.valor, 0);
    const pctTotal = linhas.reduce((a, l) => a + l.pctTotal, 0);
    const comissao = linhas.reduce((a, l) => a + l.taxas.comissao, 0);
    const frete = linhas.reduce((a, l) => a + l.taxas.frete, 0);
    const imposto = linhas.reduce((a, l) => a + l.taxas.imposto, 0);
    const custo = linhas.reduce((a, l) => a + (l.custo ?? 0), 0);
    const lucro = linhas.reduce((a, l) => a + (l.lucro ?? 0), 0);
    return {
      unidades, valor, pctTotal,
      taxas: { total: comissao + frete + imposto, comissao, frete, imposto },
      custo, lucro,
      markup: custo > 0 ? lucro / custo : null,
    };
  }, [linhas, secao, busca]);

  // 7 colunas-base (inclui Taxas) + coluna do link ML (linkável) + (custo, markup, lucro) na margem.
  const colSpanVazio = 7 + (linkavel ? 1 : 0) + (mostrarMargem ? 3 : 0);
  // Colunas cobertas pelo rótulo "Subtotal" no rodapé (Código, EAN, Título [, ML]).
  const colSpanSubtotal = 3 + (linkavel ? 1 : 0);

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <TooltipProvider delayDuration={100}>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
              <ThSort k="codigo" label="Código" sort={sort} onSort={toggleSort} />
              <ThSort k="ean" label="EAN" sort={sort} onSort={toggleSort} />
              <ThSort k="titulo" label="Título" sort={sort} onSort={toggleSort} />
              {linkavel && <TableHead className="w-12" />}
              <ThSort k="unidades" label="Unid." sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="valor" label="Valor" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="pctTotal" label="% total" sort={sort} onSort={toggleSort} align="right" />
              <ThSort k="taxas" label="Taxas" sort={sort} onSort={toggleSort} align="right" />
              {mostrarMargem && <ThSort k="custo" label="Custo" sort={sort} onSort={toggleSort} align="right" />}
              {mostrarMargem && <ThSort k="markup" label="Markup" sort={sort} onSort={toggleSort} align="right" />}
              {mostrarMargem && <ThSort k="lucro" label="Lucro" sort={sort} onSort={toggleSort} align="right" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpanVazio} className="py-4 text-center text-sm text-muted-foreground">
                  {busca.trim() ? 'Nenhum resultado para a busca.' : 'Sem vendas no período.'}
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
                  {linkavel && (
                    <TableCell className="align-top">
                      {l.id.startsWith('MLB') && (
                        <Button asChild variant="ghost" size="sm" className="h-6 px-1.5 text-xs text-muted-foreground">
                          <a href={urlAnuncioML(l.id)} target="_blank" rel="noreferrer" title="Ver anúncio no Mercado Livre">
                            <ExternalLink className="mr-1 h-3 w-3" /> ML
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="align-top text-right text-sm tabular-nums">{l.unidades}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums">{fmtBRL(l.valor)}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums">{pct(l.pctTotal)}</TableCell>
                  <TableCell className="align-top text-right text-sm tabular-nums text-muted-foreground">
                    <CelulaTaxas taxas={l.taxas} />
                  </TableCell>
                  {mostrarMargem && (
                    <TableCell className="align-top text-right text-sm tabular-nums text-muted-foreground">
                      {l.custo != null ? fmtBRL(l.custo) : '—'}
                    </TableCell>
                  )}
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
                <TableCell colSpan={colSpanSubtotal} className="text-sm">Subtotal</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{totais.unidades}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{fmtBRL(totais.valor)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{pct(totais.pctTotal)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  <CelulaTaxas taxas={totais.taxas} />
                </TableCell>
                {mostrarMargem && (
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {totais.custo > 0 ? fmtBRL(totais.custo) : '—'}
                  </TableCell>
                )}
                {mostrarMargem && (
                  <TableCell className={cn('text-right text-sm tabular-nums', corValor(totais.markup))}>
                    {totais.markup != null ? fmtMarkup(totais.markup) : '—'}
                  </TableCell>
                )}
                {mostrarMargem && (
                  <TableCell className={cn('text-right text-sm tabular-nums', corValor(totais.lucro))}>
                    {totais.markup != null ? fmtBRL(totais.lucro) : '—'}
                  </TableCell>
                )}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      </TooltipProvider>
    </div>
  );
}

export default function DetalheVendas() {
  const [busca, setBusca] = useState('');
  const [search, setSearch] = useSearchParams();
  const periodo = useMemo(() => periodoFromParams((k) => search.get(k)), [search]);
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  // Trocar o período reescreve a URL (mantém o link compartilhável e dispara o refetch).
  const onPeriodo = (p: Periodo) => setSearch(periodoToParams(p));

  // Fonte única dos KPIs: tabela ml_vendas (ADR-0038) — mesmo número do card de Faturamento.
  const { data: vendas = [], isFetching, refetch, isError } = useVendas(janela, 'todos');
  const { data: custos } = useCustos();
  const { data: aliquotas } = useAliquotas();
  const detalhe = useMemo(
    () => montarDetalheVendas(
      vendas,
      montarCustoResolver(custos),
      montarPesoResolver(custos),
      montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 }),
    ),
    [vendas, custos, aliquotas],
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

      <div className="mb-3">
        <Input
          placeholder="Buscar por título, código, EAN…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-8 w-[280px] text-sm"
        />
      </div>

      <SecaoTabela titulo="Seus anúncios (PubliAI)" secao={detalhe.app} mostrarMargem linkavel busca={busca} />
      <SecaoTabela titulo="Fora do PubliAI" sub="publicados direto no ML" secao={detalhe.externo} busca={busca} />
    </div>
  );
}
