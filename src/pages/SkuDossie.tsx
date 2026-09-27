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
import { useSkuDossie } from '@/hooks/useSkuDossie';
import { cn } from '@/lib/utils';
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
  // Task 8: o alternador semana/mês da série ganha o setter.
  const [passo] = useState<Passo>('semana');
  const { estado, dados, refetch } = useSkuDossie(alvo, periodo, passo);

  const cat = dados?.catalogo[0];
  const trilha: BreadcrumbItem[] = [
    { label: 'Vendas por SKU', to: voltar },
    ...(!familia && cat?.codigoPai
      ? [{ label: cat.nomeFamilia ?? `Família ${cat.codigoPai}`, to: `/faturamento/sku/familia/${encodeURIComponent(cat.codigoPai)}`, state: { de: voltar } }]
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

      {estado === 'sem_vendas' ? (
        <EmptyState icon={PackageOpen} title="Sem vendas registradas desde a entrada no PubliAI"
          description="O código está no catálogo, com o estoque acima. Idade comercial e tendência aparecem depois da primeira venda." />
      ) : (
        <section aria-labelledby="dossie-periodo" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="dossie-periodo" className="text-h3">Resultado no período</h2>
            <SeletorPeriodo periodo={periodo} onPeriodo={setPeriodo} mostrarMesAtual rotulo="Período" />
          </div>
          <KpisDossie atual={dados.linhaPeriodo} anterior={dados.linhaAnterior} rot={rotuloAnterior(periodo)} />
          {!dados.linhaPeriodo && (
            <p className="text-xs text-muted-foreground">Nenhuma venda neste período. O Δ compara com o período anterior.</p>
          )}
          {/* Task 8: série (SerieDossie + Sheet de pedidos) entra aqui: segue o `periodo` e o `passo`. */}
        </section>
      )}

      {/* Task 8: <section aria-labelledby="dossie-eventos"> EventosDossie (não aparece em sem_vendas se não houver eventos). */}
      {/* Task 9: estoque (também em sem_vendas), devoluções, UFs, mix (só família) e campanhas, cada um na sua <section aria-labelledby>. */}
    </div>
  );
}
