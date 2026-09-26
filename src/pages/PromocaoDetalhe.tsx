import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CircleX, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { useItensPromocao, usePromocoes } from '@/hooks/usePromocoes';
import { calcularMarkup } from '@/lib/markup';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtMarkup, fmtPct } from '@/lib/formato';
import {
  URL_PROMOCOES_ML, ateQuantoDaLinha, corDeReferencia, descontoPct, emLeitura, filtrarItens, rotuloSemLiquido, rotuloTipo,
  type ItemPromocao, type SemaforoPromo,
} from '@/lib/promocoes';
import { ChipFiltro, ContagemSemaforo, SEMAFORO_UI } from '@/components/promocoes/contagem-semaforo';
import { SheetCores } from '@/components/promocoes/sheet-cores';

const PESO: Record<SemaforoPromo, number> = { vermelho: 0, amarelo: 1, verde: 2, indisponivel: 3 };

export default function PromocaoDetalhe() {
  const { promocaoId = '' } = useParams();
  const promocoes = usePromocoes();
  const promoAtual = promocoes.data?.find((p) => p.promocao_id === promocaoId);
  const itens = useItensPromocao(promocaoId, promoAtual ? emLeitura(promoAtual, Date.now()) : false);
  const [semaforo, setSemaforo] = useState<SemaforoPromo | null>(null);
  const [participando, setParticipando] = useState(false);
  const [aberto, setAberto] = useState<ItemPromocao | null>(null);

  const promo = promocoes.data?.find((p) => p.promocao_id === promocaoId) ?? null;
  const daAba = useMemo(() => filtrarItens(itens.data ?? [], { semaforo: null, participando }), [itens.data, participando]);
  const linhas = useMemo(() => filtrarItens(itens.data ?? [], { semaforo, participando }), [itens.data, semaforo, participando]);
  const contagem = useMemo(() => {
    const c = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null };
    for (const i of daAba) c[i.pior_semaforo]++;
    return c;
  }, [daAba]);

  const colunas: Column<ItemPromocao>[] = [
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
            <p className="truncate" title={r.titulo ?? r.ml_item_id}>{r.titulo ?? r.ml_item_id}</p>
            <p className="text-xs text-muted-foreground">{r.ml_item_id}{r.estoque_min != null ? ` · Estoque mín. ${r.estoque_min}` : ''}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'preco', header: 'Preço na promoção', className: 'whitespace-normal text-right tabular-nums leading-tight',
      sortValue: (r) => r.preco_avaliado,
      cell: (r) => {
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
      },
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
      cell: (r) => {
        const c = corDeReferencia(r);
        if (!c || c.custo == null) return <span className="text-muted-foreground">{rotuloSemLiquido(r)}</span>;
        return <span className="font-medium">{fmtBRL(c.liquido!)}</span>;
      },
    },
    {
      key: 'markup', header: 'Markup', className: 'text-right tabular-nums',
      sortValue: (r) => { const c = corDeReferencia(r); return c && c.custo ? calcularMarkup(c.liquido!, c.custo).markup : null; },
      cell: (r) => {
        const c = corDeReferencia(r);
        if (!c || c.custo == null) return '—';
        const { markup } = calcularMarkup(c.liquido!, c.custo);
        return <span className={markup < 0 ? 'text-danger' : undefined}>{fmtMarkup(markup)}</span>;
      },
    },
    {
      key: 'ate', header: 'Até quanto descer', className: 'whitespace-normal w-40 text-right leading-tight',
      cell: (r) => {
        if (r.preco_min == null || r.preco_max == null) return '—';
        const a = ateQuantoDaLinha(r);
        if (a.motivo === 'nenhum') return (
          <Tooltip>
            <TooltipTrigger className="inline-flex items-center gap-1 text-xs font-medium text-danger">
              <CircleX className="size-3.5" aria-hidden />Sem preço viável
            </TooltipTrigger>
            <TooltipContent>Nenhum preço da faixa da promoção atinge o líquido mínimo.</TooltipContent>
          </Tooltip>
        );
        if (a.motivo === 'qualquer') return <span className="text-xs text-success">Qualquer preço da faixa</span>;
        return a.valor != null ? <span className="font-medium tabular-nums">{fmtBRL(a.valor)}</span> : '—';
      },
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
    <div className="flex flex-col gap-6 p-4 sm:p-6">
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
      <div className="overflow-x-auto">
        <DataTable
          columns={colunas} rows={linhas} rowKey={(r) => r.ml_item_id}
          loading={itens.isLoading} skeletonRows={8}
          defaultSort={{ key: 'semaforo', dir: 'asc' }}
          onRowClick={setAberto}
          empty={<p className="py-8 text-center text-sm text-muted-foreground">Nenhum anúncio neste filtro.</p>}
        />
      </div>
      <SheetCores item={aberto} onClose={() => setAberto(null)} />
    </div>
    </TooltipProvider>
  );
}
