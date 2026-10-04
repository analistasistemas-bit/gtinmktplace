import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleX, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import { calcularMarkup } from '@/lib/markup';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtMarkup, fmtPct } from '@/lib/formato';
import { formatarNomeProduto } from '@/lib/texto';
import type { AcaoPromocao } from '@/lib/operacoes';
import {
  URL_PROMOCOES_ML, ateQuantoDaLinha, corDeReferencia, descontoPct, emLeitura, filtrarItens, rotuloSemLiquido, rotuloTipo,
  type ItemPromocao, type SemaforoPromo,
} from '@/lib/promocoes';
import { ChipFiltro, ContagemSemaforo, SEMAFORO_UI } from '@/components/promocoes/contagem-semaforo';
import { SheetCores } from '@/components/promocoes/sheet-cores';
import { BarraSelecao } from '@/components/promocoes/barra-selecao';
import { PreviewOperacao } from '@/components/promocoes/preview-operacao';

const PESO: Record<SemaforoPromo, number> = { vermelho: 0, amarelo: 1, verde: 2, indisponivel: 3 };

// Reutilizados pela coluna da tabela desktop e pelo cartão da lista mobile — mesmo conteúdo, um só lugar.
function precoPromo(r: ItemPromocao) {
  const d = descontoPct(r.preco_original, r.preco_avaliado);
  return (
    <span className="block">
      <span className="block font-medium">{r.preco_avaliado != null ? fmtBRL(r.preco_avaliado) : '—'}</span>
      {r.preco_original != null && (
        <span className="block text-xs text-muted-foreground">
          <s>{fmtBRL(r.preco_original)}</s>{d != null && ` · −${d}%`}
        </span>
      )}
    </span>
  );
}

function liquidoCel(r: ItemPromocao) {
  const c = corDeReferencia(r);
  if (!c || c.custo == null) return <span className="text-muted-foreground">{rotuloSemLiquido(r)}</span>;
  return <span className="font-medium">{fmtBRL(c.liquido!)}</span>;
}

function markupCel(r: ItemPromocao) {
  const c = corDeReferencia(r);
  if (!c || c.custo == null) return '—';
  const { markup } = calcularMarkup(c.liquido!, c.custo);
  return <span className={markup < 0 ? 'text-danger' : undefined}>{fmtMarkup(markup)}</span>;
}

function ateQuanto(r: ItemPromocao, { tooltip }: { tooltip: boolean }) {
  if (r.preco_min == null || r.preco_max == null) return '—';
  const a = ateQuantoDaLinha(r);
  if (a.motivo === 'nenhum') {
    const conteudo = <><CircleX className="size-3.5" aria-hidden />Sem preço viável</>;
    if (!tooltip) return <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">{conteudo}</span>;
    return (
      <Tooltip>
        <TooltipTrigger className="inline-flex items-center gap-1 text-xs font-medium text-danger">{conteudo}</TooltipTrigger>
        <TooltipContent>Nenhum preço da faixa da promoção atinge o líquido mínimo.</TooltipContent>
      </Tooltip>
    );
  }
  if (a.motivo === 'qualquer') return <span className="text-xs text-success">Qualquer preço da faixa</span>;
  return a.valor != null ? <span className="font-medium tabular-nums">{fmtBRL(a.valor)}</span> : '—';
}

export default function PromocaoDetalhe() {
  const { promocaoId = '' } = useParams();
  const promocoes = usePromocoes();
  const promoAtual = promocoes.data?.find((p) => p.promocao_id === promocaoId);
  const itens = useItensPromocao(promocaoId, promoAtual ? emLeitura(promoAtual, Date.now()) : false);
  const [semaforo, setSemaforo] = useState<SemaforoPromo | null>(null);
  const [participando, setParticipando] = useState(false);
  const [aberto, setAberto] = useState<ItemPromocao | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ acao: AcaoPromocao; itens: ItemPromocao[] } | null>(null);

  const promo = promocoes.data?.find((p) => p.promocao_id === promocaoId) ?? null;
  // Trocar de campanha (navegação entre detalhes) não deve arrastar a seleção anterior.
  useEffect(() => { setSelecionados(new Set()); setPreview(null); }, [promocaoId]);

  const podeSelecionar = promo != null && (promo.tipo === 'DEAL' || promo.tipo === 'SMART') && promo.status !== 'finished';
  const daAba = useMemo(() => filtrarItens(itens.data ?? [], { semaforo: null, participando }), [itens.data, participando]);
  const linhas = useMemo(() => filtrarItens(itens.data ?? [], { semaforo, participando }), [itens.data, semaforo, participando]);
  const linhasMobile = useMemo(() => [...linhas].sort((a, b) => PESO[a.pior_semaforo] - PESO[b.pior_semaforo]), [linhas]);

  const selecionadosItens = useMemo(() => (itens.data ?? []).filter((i) => selecionados.has(i.ml_item_id)), [itens.data, selecionados]);
  const convidadosSelecionados = selecionadosItens.filter((i) => i.status === 'candidate');
  const participandoSelecionados = selecionadosItens.filter((i) => i.status === 'started' || i.status === 'pending');
  const todosMarcadosNoFiltro = linhas.length > 0 && linhas.every((r) => selecionados.has(r.ml_item_id));

  function alternarItem(id: string) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }
  function alternarTodos(marcar: boolean) {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      for (const r of linhas) { if (marcar) novo.add(r.ml_item_id); else novo.delete(r.ml_item_id); }
      return novo;
    });
  }
  const contagem = useMemo(() => {
    const c = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null };
    for (const i of daAba) c[i.pior_semaforo]++;
    return c;
  }, [daAba]);

  const colunas: Column<ItemPromocao>[] = [
    ...(podeSelecionar ? [{
      key: 'sel', header: (
        <Checkbox aria-label="Selecionar todos" checked={todosMarcadosNoFiltro} onCheckedChange={(v) => alternarTodos(!!v)} />
      ), className: 'w-10',
      cell: (r: ItemPromocao) => (
        <Checkbox
          aria-label={`Selecionar ${r.ml_item_id}`} checked={selecionados.has(r.ml_item_id)}
          onCheckedChange={() => alternarItem(r.ml_item_id)} onClick={(e) => e.stopPropagation()}
        />
      ),
    } satisfies Column<ItemPromocao>] : []),
    {
      key: 'semaforo', header: 'Semáforo', className: 'w-12',
      sortValue: (r) => PESO[r.pior_semaforo],
      cell: (r) => {
        const ui = SEMAFORO_UI[r.pior_semaforo];
        return (
          <span title={ui.label} className="inline-flex">
            <ui.Icon className={cn('size-4', ui.text)} aria-hidden />
            <span className="sr-only">{ui.label}</span>
          </span>
        );
      },
    },
    {
      key: 'anuncio', header: 'Anúncio',
      cell: (r) => (
        <div className={`flex min-w-0 items-center gap-3 ${r.pior_semaforo === 'indisponivel' ? 'text-muted-foreground' : ''}`}>
          {r.thumbnail && <img src={r.thumbnail} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" />}
          <div className="min-w-0 max-w-[14rem] 2xl:max-w-[24rem]">
            <p className="truncate" title={formatarNomeProduto(r.titulo) || r.ml_item_id}>{formatarNomeProduto(r.titulo) || r.ml_item_id}</p>
            <p className="text-xs text-muted-foreground">{r.ml_item_id}{r.estoque_min != null ? ` · Estoque mín. ${r.estoque_min}` : ''}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'preco', header: 'Preço na promoção', className: 'whitespace-normal text-right tabular-nums leading-tight',
      sortValue: (r) => r.preco_avaliado,
      cell: (r) => precoPromo(r),
    },
    {
      key: 'banca', header: 'ML banca', className: 'text-right tabular-nums',
      cell: (r) => r.ml_pct ? (
        <Tooltip>
          <TooltipTrigger className="underline decoration-dotted">{fmtPct(r.ml_pct)}</TooltipTrigger>
          <TooltipContent>Parte do desconto paga pelo Mercado Livre — não incluída no líquido.</TooltipContent>
        </Tooltip>
      ) : '—',
    },
    {
      key: 'liquido', header: 'Líquido', className: 'text-right tabular-nums',
      sortValue: (r) => corDeReferencia(r)?.liquido ?? null,
      cell: (r) => liquidoCel(r),
    },
    {
      key: 'markup', header: 'Markup', className: 'text-right tabular-nums',
      sortValue: (r) => { const c = corDeReferencia(r); return c && c.custo ? calcularMarkup(c.liquido!, c.custo).markup : null; },
      cell: (r) => markupCel(r),
    },
    {
      key: 'ate', header: 'Até quanto descer', className: 'whitespace-normal w-40 text-right leading-tight',
      cell: (r) => ateQuanto(r, { tooltip: true }),
    },
    {
      key: 'ml', header: <span className="sr-only">Abrir no Mercado Livre</span>, stickyRight: true,
      cell: (r) => r.permalink ? (
        <a href={r.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          aria-label={`Abrir ${r.ml_item_id} no Mercado Livre`} className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ) : null,
    },
  ];

  if (!promocoes.isLoading && !promo) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <EmptyState title="Campanha não encontrada." description="Ela pode ter saído da lista do Mercado Livre na última atualização." />
      </div>
    );
  }

  return (
    <TooltipProvider>
    <div className="flex h-full flex-col gap-6 p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Promoções', to: '/promocoes' }, { label: promo?.nome ?? promocaoId }]} />
      <PageHeader
        title={promo?.nome ?? promocaoId}
        subtitle={promo ? `${rotuloTipo(promo.tipo)}${promo.prazo_adesao ? ` · adesão até ${new Date(promo.prazo_adesao).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : undefined}
        actions={<Button asChild variant="outline"><a href={URL_PROMOCOES_ML} target="_blank" rel="noreferrer">Abrir no Seller Center <ExternalLink className="size-4" aria-hidden /></a></Button>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChipFiltro ativo={semaforo == null} onClick={() => setSemaforo(null)}>
            <span className="font-semibold tabular-nums">{daAba.length}</span>
            <span className="text-muted-foreground">Todos</span>
          </ChipFiltro>
          <ContagemSemaforo contagem={contagem} ativo={semaforo} onFiltro={setSemaforo} />
        </div>
        <Tabs value={participando ? 'participando' : 'convidados'}
          onValueChange={(v) => { setParticipando(v === 'participando'); setSemaforo(null); }}>
          <TabsList aria-label="Filtrar por participação">
            <TabsTrigger value="convidados">Convidados</TabsTrigger>
            <TabsTrigger value="participando">Participando</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {/* Achado 1 (revisão): quem rola é este bloco, não a página — a BarraSelecao (abaixo, fora
          do scroll) fica sempre visível, presa ao rodapé da área visível. */}
      <div className="flex-1 overflow-y-auto">
        <div className="hidden overflow-x-auto md:block">
          <DataTable
            columns={colunas} rows={linhas} rowKey={(r) => r.ml_item_id}
            loading={itens.isLoading} skeletonRows={8}
            defaultSort={{ key: 'semaforo', dir: 'asc' }}
            onRowClick={setAberto}
            empty={<p className="py-8 text-center text-sm text-muted-foreground">Nenhum anúncio neste filtro.</p>}
          />
        </div>
        <div className="md:hidden" data-testid="lista-mobile">
          {podeSelecionar && (
            <div className="mb-2 flex items-center gap-2">
              <Checkbox
                id="sel-todos-mobile" aria-label="Selecionar todos" disabled={linhas.length === 0}
                checked={todosMarcadosNoFiltro} onCheckedChange={(v) => alternarTodos(!!v)}
              />
              <label htmlFor="sel-todos-mobile" className="text-sm text-muted-foreground">Selecionar todos</label>
            </div>
          )}
          <ListaMobile
            linhas={linhasMobile} loading={itens.isLoading} onAbrir={setAberto}
            podeSelecionar={podeSelecionar} selecionados={selecionados} onToggle={alternarItem}
          />
        </div>
      </div>
      <BarraSelecao
        convidados={convidadosSelecionados.length} participando={participandoSelecionados.length}
        onAderir={() => setPreview({ acao: 'aderir', itens: convidadosSelecionados })}
        onSair={() => setPreview({ acao: 'sair', itens: participandoSelecionados })}
        onLimpar={() => setSelecionados(new Set())}
      />
      <SheetCores item={aberto} onClose={() => setAberto(null)} />
      <PreviewOperacao
        acao={preview?.acao ?? 'aderir'} tipo={promo?.tipo === 'SMART' ? 'SMART' : 'DEAL'}
        promocaoId={promocaoId} promocaoNome={promo?.nome ?? promocaoId} itens={preview?.itens ?? []}
        aberto={preview != null} onClose={() => setPreview(null)} onSucesso={() => setSelecionados(new Set())}
      />
    </div>
    </TooltipProvider>
  );
}

/** Cartões abaixo de `md` — a DataTable estoura a largura e some preço/líquido/markup no scroll horizontal. */
function ListaMobile({ linhas, loading, onAbrir, podeSelecionar, selecionados, onToggle }: {
  linhas: ItemPromocao[]; loading: boolean; onAbrir: (r: ItemPromocao) => void;
  podeSelecionar: boolean; selecionados: Set<string>; onToggle: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-28 rounded-xl" />)}
      </div>
    );
  }
  if (linhas.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum anúncio neste filtro.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {linhas.map((r) => {
        const ui = SEMAFORO_UI[r.pior_semaforo];
        const temFaixa = r.preco_min != null && r.preco_max != null;
        const a = temFaixa ? ateQuantoDaLinha(r) : null;
        return (
          <li key={r.ml_item_id} className="relative rounded-xl border bg-card shadow-xs">
            {podeSelecionar && (
              <div className="absolute left-3 top-4 z-10">
                <Checkbox
                  aria-label={`Selecionar ${r.ml_item_id}`} checked={selecionados.has(r.ml_item_id)}
                  onCheckedChange={() => onToggle(r.ml_item_id)} onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <button type="button" onClick={() => onAbrir(r)}
              className={cn('w-full rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', podeSelecionar && 'pl-10')}>
              <div className={cn('flex min-w-0 items-center gap-3 pr-9', r.pior_semaforo === 'indisponivel' && 'text-muted-foreground')}>
                {r.thumbnail && <img src={r.thumbnail} alt="" className="size-12 shrink-0 rounded object-cover" loading="lazy" />}
                <span title={ui.label} className="inline-flex shrink-0">
                  <ui.Icon className={cn('size-4', ui.text)} aria-hidden />
                  <span className="sr-only">{ui.label}</span>
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{formatarNomeProduto(r.titulo) || r.ml_item_id}</p>
                  <p className="text-xs text-muted-foreground">{r.ml_item_id}{r.estoque_min != null ? ` · Estoque mín. ${r.estoque_min}` : ''}</p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Promo</dt>
                  <dd className="tabular-nums">{precoPromo(r)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Líquido</dt>
                  <dd className="tabular-nums font-medium">{liquidoCel(r)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Markup</dt>
                  <dd className="tabular-nums font-medium">{markupCel(r)}</dd>
                </div>
              </dl>
              {(temFaixa || r.ml_pct) && (
                <div className="mt-3 flex flex-col gap-0.5 text-xs">
                  {temFaixa && (
                    <>
                      <p><span className="text-muted-foreground">Até quanto descer:</span> {ateQuanto(r, { tooltip: false })}</p>
                      {a?.motivo === 'nenhum' && (
                        <p className="text-muted-foreground">Nenhum preço da faixa atinge o líquido mínimo.</p>
                      )}
                    </>
                  )}
                  {r.ml_pct ? <p className="text-muted-foreground">ML banca {fmtPct(r.ml_pct)}</p> : null}
                </div>
              )}
            </button>
            {r.permalink && (
              <a href={r.permalink} target="_blank" rel="noreferrer"
                aria-label={`Abrir ${r.ml_item_id} no Mercado Livre`}
                className="absolute right-1 top-1 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted">
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
