import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, CloudOff, PackageOpen, SearchX } from 'lucide-react';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { CabecalhoDossie } from '@/components/sku-dossie/cabecalho-dossie';
import { QualidadeHistorico } from '@/components/sku-dossie/qualidade-historico';
import { KpisDossie } from '@/components/sku-dossie/kpis-dossie';
import { SerieDossie } from '@/components/sku-dossie/serie-dossie';
import { TrafegoDossie } from '@/components/sku-dossie/trafego-dossie';
import { PainelAds } from '@/components/sku-dossie/ads-dossie';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventosDossie } from '@/components/sku-dossie/eventos-dossie';
import { EstoqueDossie } from '@/components/sku-dossie/estoque-dossie';
import { DevolucoesDossie } from '@/components/sku-dossie/devolucoes-dossie';
import { UfsDossie } from '@/components/sku-dossie/ufs-dossie';
import { MixFamilia } from '@/components/sku-dossie/mix-familia';
import { CampanhasDossie } from '@/components/sku-dossie/campanhas-dossie';
import { useSkuDossie } from '@/hooks/useSkuDossie';
import { cn } from '@/lib/utils';
import { formatarNomeProduto } from '@/lib/texto';
import { rotuloAnterior, type Periodo } from '@/lib/metricas';
import type { Passo } from '@/lib/calendario-brt';
import type { AlvoDossie } from '@/lib/sku-dossie';

const ORIGEM_PADRAO = '/faturamento?aba=sku';
const PAGINA = 'flex min-w-0 flex-col gap-6 p-4 sm:p-6';
// No escuro `bg-muted` quase some sobre `bg-card`; dentro de cartão a barra usa o texto com 10%.
const SOBRE_CARD = 'bg-foreground/10';

/** Skeleton do layout real: cabeçalho, faixa de fatos, qualidade, KPIs e o bloco do gráfico. */
function Carregando() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Carregando o dossiê</span>
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-48 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-1.5 bg-card px-3 py-2.5"><Skeleton className={cn('h-3 w-16', SOBRE_CARD)} /><Skeleton className={cn('h-4 w-20', SOBRE_CARD)} /></div>
        ))}
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      {/* Reserva a linha "Resultado no período" + SeletorPeriodo: nada salta quando os dados chegam. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Skeleton className="h-6 w-44" />
        <div className="flex flex-wrap gap-1">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-16" />)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[5.5rem] rounded-lg border bg-card px-3 py-2.5 shadow-sm">
            <Skeleton className={cn('h-4 w-20', SOBRE_CARD)} />
            <Skeleton className={cn('mt-2 h-6 w-16', SOBRE_CARD)} />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

export default function SkuDossie() {
  const { codigo, codigoPai } = useParams();
  const location = useLocation();
  const de = (location.state as { de?: unknown } | null)?.de;
  const voltar = typeof de === 'string' && de.startsWith('/') ? de : ORIGEM_PADRAO;

  const alvo = useMemo<AlvoDossie>(() => (codigoPai != null
    ? { tipo: 'familia', codigoPai } : { tipo: 'sku', codigo: codigo ?? '' }), [codigo, codigoPai]);
  const familia = alvo.tipo === 'familia';
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const [passo, setPasso] = useState<Passo>('semana');
  const { estado, dados, ads, refetch, refetchTrafego, refetchAds } = useSkuDossie(alvo, periodo, passo);

  const cat = dados?.catalogo[0];
  const trilha: BreadcrumbItem[] = [
    { label: 'Vendas por SKU', to: voltar },
    ...(!familia && cat?.codigoPai
      ? [{ label: formatarNomeProduto(cat.nomeFamilia) || `Família ${cat.codigoPai}`, to: `/faturamento/sku/familia/${encodeURIComponent(cat.codigoPai)}`, state: { de: voltar } }]
      : []),
    // Identificador curto: o título inteiro já é o h1 logo abaixo (no celular ele ocupava 3 linhas aqui).
    { label: familia ? `Família ${codigoPai}` : `Código ${codigo}` },
  ];
  const cabecaDeEstado = (titulo: string) => (
    <>
      <Breadcrumbs items={trilha} className="mb-0" />
      <h1 className="sr-only">{titulo}</h1>
    </>
  );

  if (estado === 'carregando') {
    return <div className={PAGINA}>{cabecaDeEstado('Dossiê do SKU')}<Carregando /></div>;
  }

  if (estado === 'erro') {
    return (
      <div className={PAGINA}>
        {cabecaDeEstado('Dossiê do SKU')}
        <EmptyState icon={CloudOff} title="Não foi possível carregar o dossiê"
          description="A busca das vendas, do catálogo ou das devoluções falhou. Tente de novo; se continuar, recarregue a página."
          action={<Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Tentar de novo</Button>} />
      </div>
    );
  }

  if (estado === 'nao_encontrado' || !dados) {
    return (
      <div className={PAGINA}>
        {cabecaDeEstado('Código não encontrado')}
        <EmptyState icon={SearchX} title="Não encontramos este código"
          description={familia
            ? `A família ${codigoPai} não tem variações no catálogo atual.`
            : `O código ${codigo} não está no catálogo nem nas vendas registradas no PubliAI.`}
          action={<Button asChild variant="outline" size="sm"><Link to={voltar}>Voltar para Vendas por SKU</Link></Button>} />
      </div>
    );
  }

  return (
    <div className={PAGINA}>
      <Breadcrumbs items={trilha} className="mb-0" />
      <CabecalhoDossie dados={dados} familia={familia} aviso={estado === 'sem_cadastro' && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-medium">Este código não está mais no catálogo.</span>{' '}
            <span className="text-muted-foreground">As vendas registradas continuam aqui; família e estoque ficam sem fonte atual.</span>
          </p>
        </div>
      )} />

      <QualidadeHistorico historicoDesde={dados.historicoDesde} qualidade={dados.qualidade} />

      <section aria-labelledby="dossie-periodo" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="dossie-periodo" className="text-h3">Resultado no período</h2>
          <SeletorPeriodo periodo={periodo} onPeriodo={setPeriodo} mostrarMesAtual rotulo="Período" />
        </div>
        {estado !== 'sem_vendas' && (
          <>
            <KpisDossie atual={dados.linhaPeriodo} anterior={dados.linhaAnterior} rot={rotuloAnterior(periodo)}
              unidadesKit={dados.kitVirtual?.unidadesPeriodo} />
            {!dados.linhaPeriodo && (
              <p className="text-xs text-muted-foreground">{`Nenhuma venda neste período. ${dados.linhaAnterior ? 'O Δ compara com o período anterior.' : 'Sem Δ: sem histórico no período anterior.'}`}</p>
            )}
          </>
        )}
        {/* Vendas | Tráfego: medidas diferentes (unidades × visitas) não dividem o mesmo gráfico. Sem venda
            nenhuma o tráfego continua aqui: visitas sem venda é justamente o diagnóstico. */}
        <Tabs defaultValue="vendas" className="gap-3">
          <TabsList aria-label="Série do período">
            <TabsTrigger value="vendas" className="px-3">Vendas</TabsTrigger>
            <TabsTrigger value="trafego" className="px-3">Tráfego e oferta</TabsTrigger>
            <TabsTrigger value="ads" className="px-3">Ads</TabsTrigger>
          </TabsList>
          <TabsContent value="vendas">
            {estado === 'sem_vendas' ? (
              <EmptyState icon={PackageOpen} title="Sem vendas registradas desde a entrada no PubliAI"
                description="O código está no catálogo, com o estoque acima. Idade comercial e tendência aparecem depois da primeira venda." />
            ) : (
              <SerieDossie serie={dados.serie} perguntas={dados.perguntasPorIntervalo} eventos={dados.eventos} codigos={dados.codigos}
                familia={familia} temKit={dados.kitVirtual != null} historicoDesde={dados.historicoDesde} passo={passo} onPasso={setPasso} />
            )}
          </TabsContent>
          <TabsContent value="trafego">
            <TrafegoDossie trafego={dados.trafego} familia={familia} passo={passo} onPasso={setPasso} onTentar={() => { void refetchTrafego(); }} />
          </TabsContent>
          <TabsContent value="ads">
            <PainelAds ads={ads} familia={familia} passo={passo} onPasso={setPasso} onTentar={() => { void refetchAds(); }} />
          </TabsContent>
        </Tabs>
      </section>

      {/* Ordem por relógio: o período escolhido (KPIs, série, mix, devoluções, UFs), a posição de
          hoje (estoque, campanhas) e, por fim, todo o histórico (eventos). */}
      {estado !== 'sem_vendas' && dados.mix && <MixFamilia mix={dados.mix} voltar={voltar} />}

      {/* Em lg, duas colunas que empilham sem vãos. Par medido nos prints de SKU e família:
          devoluções + campanhas | UFs + estoque (diferença de 48-80px; o par inverso deixava ~340-375px).
          No celular as colunas viram `contents` e o `order` devolve a ordem lógica. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          {estado !== 'sem_vendas' && <DevolucoesDossie linha={dados.linhaPeriodo} eventos={dados.eventos} className="order-1" />}
          <CampanhasDossie campanhas={dados.campanhas} className="order-4" />
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          {estado !== 'sem_vendas' && <UfsDossie ufs={dados.ufs} className="order-2" />}
          <EstoqueDossie dados={dados} familia={familia} voltar={voltar} className="order-3" />
        </div>
      </div>

      {(estado !== 'sem_vendas' || dados.eventos.length > 0) && (
        <EventosDossie eventos={dados.eventos} />
      )}
    </div>
  );
}
