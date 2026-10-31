import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarX2, Megaphone, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdsPainel } from '@/hooks/useAdsPainel';
import { useAdsCampanhas } from '@/hooks/useAdsCampanhas';
import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import type { PedidoAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';
import {
  MOTIVOS_PERIODO_ADS, PERIODO_PADRAO_ADS, resolverPeriodoAds, type DiasAds, type PeriodoAds,
} from '@/lib/ads-painel-dados';
import { indicadoresAds } from '@/lib/ads-metricas';
import { ATALHO_ACIMA_EQUILIBRIO, contarFamiliasAds, ehEstadoAcesso } from '@/lib/ads-apresentacao';
import { inicioAtribuicaoAberta } from '@/lib/sku-ads';
import { PeriodoAdsSeletor, type CompararAds } from '@/components/ads/periodo-ads';
import { FaixaKpis } from '@/components/ads/faixa-kpis';
import { SerieDiaria } from '@/components/ads/serie-diaria';
import { LinhaResultado, ResumoConta } from '@/components/ads/resumo-conta';
import { RankingFamilias } from '@/components/ads/ranking-familias';
import { IntegridadeAds } from '@/components/ads/integridade-ads';
import { Aviso, AvisoAcesso, AVISO } from '@/components/ads/aviso';
import { AbaCampanhas } from '@/components/ads/campanhas/aba-campanhas';
import type { PedidoBaseDetalhe } from '@/components/ads/campanhas/detalhe-campanha';
import { contarFamiliasEmAlerta } from '@/components/ads/campanhas/formato-campanha';
import { TELA_ADS } from '@/components/ads/tela-ads';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

// Contexto único (plano ads-redesign §3.1): período, comparação e aba valem para as duas abas e vivem na URL
// (?aba=&periodo=7|30|90|mes_atual|range&desde=&ate=&comparar=). A preferência antiga só entra quando a URL não diz.
const CHAVE = 'ads-painel-dias';
const CHAVE_ABA = 'ads-aba';

function presetDe(v: string | null): PeriodoAds | null {
  if (v === 'mes_atual') return { tipo: 'mes_atual' };
  if (v === '7' || v === '30' || v === '90') return { tipo: 'preset', dias: Number(v) as DiasAds };
  return null;
}

function periodoSalvo(): PeriodoAds {
  try {
    return presetDe(localStorage.getItem(CHAVE)) ?? PERIODO_PADRAO_ADS;
  } catch {
    return PERIODO_PADRAO_ADS;
  }
}

/** `periodo=range` passa como veio, até com datas ausentes ou ilegíveis: o resolvedor dá o motivo (data_invalida,
 *  ordem, futuro, retenção) e nenhuma outra janela é consultada. Só `periodo` ausente ou desconhecido recai na
 *  preferência. */
function periodoDaUrl(p: URLSearchParams): PeriodoAds | null {
  if (p.get('periodo') !== 'range') return presetDe(p.get('periodo'));
  return { tipo: 'range', desde: p.get('desde') ?? '', ate: p.get('ate') ?? '' };
}

const identidade = (p: PeriodoAds) =>
  (p.tipo === 'preset' ? String(p.dias) : p.tipo === 'range' ? `range:${p.desde}:${p.ate}` : p.tipo);

/** Dia literal YYYY-MM-DD → DD/MM/AAAA (sem `new Date`, que leria o dia em UTC). */
const dataDia = (dia: string) =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

const BOTAO_ACAO = 'h-8 max-sm:h-11 pointer-coarse:h-11';

type Aba = 'desempenho' | 'campanhas';
const abaValida = (v: string | null): Aba | null => (v === 'desempenho' || v === 'campanhas' ? v : null);
// Desempenho sem dado para mostrar (ou campanha recém-criada): a aba útil é Campanhas.
const ESTADOS_SEM_DADO: readonly string[] = ['sem_ads', 'aguardando_mes', 'sem_coleta', 'coletando'];

function abaSalva(): Aba | null {
  try {
    return abaValida(localStorage.getItem(CHAVE_ABA));
  } catch {
    return null;
  }
}

export default function Ads() {
  const [params, setParams] = useSearchParams();
  const periodo = periodoDaUrl(params) ?? periodoSalvo();
  const comparar: CompararAds = params.get('comparar') === 'nenhum' ? 'nenhum' : 'anterior';
  const {
    painel,
    resultadoConta,
    metricasConta,
    janela,
    comparacao,
    situacaoPeriodo,
    historicoDesde,
    ultimoOkEm,
    faturamentoConta,
    blocos,
    isFetching,
    isError,
    refetch,
    atualizar,
  } = useAdsPainel(periodo, comparar);

  const [automatica, setAutomatica] = useState<Aba | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  // Contador do atalho "Ver famílias acima do equilíbrio": cada clique remonta o ranking já filtrado.
  const [atalho, setAtalho] = useState(0);

  // URL > escolha guardada > decisão automática (uma única vez, quando o estado do painel já é conhecido, sem
  // piscar). A automática nunca vai para a URL e nunca vence uma escolha explícita, por mais tardia a resposta.
  const escolha = abaValida(params.get('aba')) ?? abaSalva();
  // Período inválido já decide (Desempenho): o motivo aparece nas duas abas e o seletor fica acima delas.
  // Sem acesso à Publicidade (conexão, anunciante, permissão): um aviso só, no lugar das duas abas. A leitura ao
  // vivo da conta manda; o estado do painel (vem da coleta, pode ser antigo) só vale enquanto ela não responde.
  // Leitura ao vivo válida com coleta recusada: os blocos ficam e o aviso da coleta vai para as famílias.
  const estadoAcesso = metricasConta
    ? (ehEstadoAcesso(metricasConta.estado) ? metricasConta.estado : null)
    : painel && ehEstadoAcesso(painel.estado) ? painel.estado : null;
  const estadoPainel = situacaoPeriodo === 'aguardando_mes' || situacaoPeriodo === 'invalido'
    ? situacaoPeriodo : painel?.estado ?? (isError || blocos.grupos.isError ? 'erro' : estadoAcesso);
  if (escolha === null && automatica === null && estadoPainel !== null) {
    setAutomatica(ESTADOS_SEM_DADO.includes(estadoPainel) ? 'campanhas' : 'desempenho');
  }
  const aba: Aba | null = escolha ?? automatica;
  const campanhasDados = useAdsCampanhas(aba === 'campanhas');
  const emAlerta = contarFamiliasEmAlerta(campanhasDados.campanhas);

  const gravarUrl = (mudar: (p: URLSearchParams) => void) =>
    setParams(atual => {
      const p = new URLSearchParams(atual);
      mudar(p);
      return p;
    }, { replace: true });

  const trocarAba = (proxima: Aba) => {
    gravarUrl(p => p.set('aba', proxima));

    try {
      localStorage.setItem(CHAVE_ABA, proxima);
    } catch {
      // A escolha continua válida nesta visita (está na URL).
    }
  };
  const codigosComDesempenho = new Set((painel?.familias ?? []).map(f => f.codigoPai));
  const verDesempenho = (codigoPai: string) => {
    setFoco(codigoPai);
    setAtalho(0);
    trocarAba('desempenho');
  };

  const escolherContexto = ({ periodo: proximo, comparar: cmp }: { periodo: PeriodoAds; comparar: CompararAds }) => {
    const valor = proximo.tipo === 'preset' ? String(proximo.dias) : proximo.tipo;
    if (identidade(proximo) !== identidade(periodo)) {
      setFoco(null);
      setAtalho(0);
    }
    gravarUrl(p => {
      p.set('periodo', valor);
      if (proximo.tipo === 'range') {
        p.set('desde', proximo.desde);
        p.set('ate', proximo.ate);
      } else {
        p.delete('desde');
        p.delete('ate');
      }
      if (cmp === 'nenhum') p.set('comparar', 'nenhum');
      else p.delete('comparar');
    });

    // Preferência antiga só guarda presets: um range vive só na URL.
    if (proximo.tipo === 'range') return;
    try {
      localStorage.setItem(CHAVE, valor);
    } catch {
      // A seleção continua válida nesta visita.
    }
  };
  const escolherPeriodo = (proximo: PeriodoAds) => escolherContexto({ periodo: proximo, comparar });
  const atual = periodo.tipo === 'preset' ? String(periodo.dias) : periodo.tipo;

  const pedido = useMemo<PedidoBaseDetalhe | null>(
    () => (janela ? { desde: janela.desde, ate: janela.ate, comparar } : null),
    [janela, comparar],
  );
  // Tabela de campanhas do período: lida aqui (só com a aba aberta) para o Atualizar do cabeçalho alcançá-la.
  const pedidoCampanhas = useMemo<PedidoAdsMetricas | null>(() => (pedido ? { ...pedido, escopo: 'campanhas' } : null), [pedido]);
  const metricasCampanhas = useAdsMetricas(pedidoCampanhas, aba === 'campanhas' && pedidoCampanhas !== null);
  const atualizarTudo = () => {
    void atualizar();
    if (aba !== 'campanhas') return;
    void metricasCampanhas.atualizar();
    void campanhasDados.atualizar();
  };

  const provisoria = comparar === 'anterior' && metricasConta?.comparacao.estado === 'provisoria';
  const contexto = (
    <div className="mb-6 space-y-2">
      <PeriodoAdsSeletor valor={periodo} comparar={comparar} onChange={escolherContexto} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        {janela && <span>{`${dataDia(janela.desde)} a ${dataDia(janela.ate)} · BRT`}</span>}
        {janela && comparar === 'anterior' && comparacao?.tipo === 'pronta' && (
          <span className="inline-flex items-center gap-1.5">
            {`Comparado com ${dataDia(comparacao.janela.desde)} a ${dataDia(comparacao.janela.ate)}`}
            {provisoria && <StatusPill tone="warning" title="O ML ainda pode revisar a atribuição de vendas.">Provisória</StatusPill>}
          </span>
        )}
        {janela && comparar === 'anterior' && comparacao?.tipo === 'indisponivel' && (
          <span>Sem comparação: o período anterior está fora do histórico disponível no ML.</span>
        )}
        {isFetching && <span role="status">Atualizando…</span>}
      </div>
    </div>
  );

  const verificar = (
    <Button variant="outline" size="sm" className={BOTAO_ACAO} onClick={() => refetch()}>Verificar novamente</Button>
  );

  // Sem janela pronta não há número em nenhuma das abas.
  let semPeriodo: ReactNode = null;
  if (situacaoPeriodo === 'aguardando_mes') {
    semPeriodo = (
      <EmptyState
        icon={CalendarClock}
        title="Aguardando o primeiro dia de Ads deste mês"
        description="Os dados de hoje ainda não entram no painel. O mês aparecerá quando houver um dia encerrado coletado."
        action={(
          <Button variant="outline" size="sm" className={BOTAO_ACAO}
            onClick={() => escolherPeriodo({ tipo: 'preset', dias: 30 })}>
            Ver últimos 30 dias
          </Button>
        )}
      />
    );
  } else if (situacaoPeriodo === 'invalido') {
    const r = resolverPeriodoAds(periodo, new Date(), null);
    semPeriodo = (
      <EmptyState
        icon={CalendarX2}
        title="Período inválido"
        description={r.tipo === 'invalido' ? MOTIVOS_PERIODO_ADS[r.motivo] : 'Escolha outro período.'}
        action={(
          <Button variant="outline" size="sm" className={BOTAO_ACAO} onClick={() => escolherPeriodo(PERIODO_PADRAO_ADS)}>
            Ver mês atual
          </Button>
        )}
      />
    );
  }

  // ---- Conta inteira: os mesmos KPIs, gráfico e resultado nas duas abas ----
  const kpiAtual = useMemo(
    () => (metricasConta?.atual ? indicadoresAds(metricasConta.atual.resumo, faturamentoConta?.atual ?? null) : null),
    [metricasConta, faturamentoConta],
  );
  const kpiAnterior = useMemo(
    () => (comparar === 'anterior' && metricasConta?.anterior
      ? indicadoresAds(metricasConta.anterior.resumo, faturamentoConta?.anterior ?? null) : null),
    [comparar, metricasConta, faturamentoConta],
  );
  let kpis: ReactNode;
  if (!metricasConta) {
    kpis = blocos.conta.isError ? (
      <div role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          Não foi possível ler as métricas da conta no Mercado Livre.
        </p>
        <Button variant="outline" size="sm" className={`mt-3 ${BOTAO_ACAO}`} onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    ) : <FaixaKpis atual={{}} anterior={null} comparacao="desligada" loading />;
  } else if (!kpiAtual || (metricasConta.estado !== 'ok' && metricasConta.estado !== 'parcial')) {
    kpis = <Aviso texto={AVISO[metricasConta.estado] ?? 'Não foi possível ler as métricas da conta neste período.'} />;
  } else {
    // Comparação que falhou na leitura (a de fora da retenção já é explicada no cabeçalho): o período atual fica.
    const motivoComparacao = comparar === 'anterior' && comparacao?.tipo === 'pronta'
      && metricasConta.comparacao.estado === 'indisponivel' ? metricasConta.comparacao.motivo : undefined;
    kpis = (
      <>
        {motivoComparacao !== undefined && (
          <p className="text-xs text-muted-foreground">
            {motivoComparacao ? `Comparação indisponível: ${motivoComparacao}` : 'Comparação indisponível.'}
          </p>
        )}
        <FaixaKpis atual={kpiAtual} anterior={kpiAnterior}
          comparacao={comparar === 'nenhum' ? 'desligada' : metricasConta.comparacao.estado} />
        {metricasConta.atual && (
          <SerieDiaria serie={metricasConta.atual.serie} janela={metricasConta.atual.janela} completo={metricasConta.atual.completo}
            provisorioDesde={inicioAtribuicaoAberta(metricasConta.atual.janela, metricasConta.atual.lidoEm)} />
        )}
      </>
    );
  }

  const liberado = painel?.semaforoLiberado ?? false;
  const contagem = painel ? contarFamiliasAds(painel.familias, liberado) : null;
  const temAcima = contagem != null && contagem.acima + contagem.semEspaco > 0;
  const rankingRef = useRef<HTMLDivElement>(null);
  const verAcima = () => {
    setFoco(null);
    setAtalho(n => n + 1);
    trocarAba('desempenho');
    // O ranking remonta já filtrado; rola até ele depois do commit.
    requestAnimationFrame(() => rankingRef.current?.scrollIntoView?.({
      block: 'start',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }));
  };

  const erroLeituraConta = !metricasConta && blocos.conta.isError;
  const resumo = (comComposicao: boolean) => {
    if (!resultadoConta) {
      // Leitura da conta com erro: o alerta dos KPIs já explica e oferece a nova consulta.
      if (erroLeituraConta) return null;
      if (isError || blocos.conta.isError) {
        return (
          <div role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
            <p className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              Não foi possível carregar as vendas do período. O resultado da conta e o das famílias ficam indisponíveis.
            </p>
            <Button variant="outline" size="sm" className={`mt-3 ${BOTAO_ACAO}`} onClick={() => refetch()}>Tentar novamente</Button>
          </div>
        );
      }
      return <Skeleton aria-hidden className="h-48 w-full rounded-lg" />;
    }
    return (
      <ResumoConta
        conta={resultadoConta.conta}
        motivo={blocos.conta.motivo ?? resultadoConta.motivo}
        historicoDesde={historicoDesde}
        faturamentoConta={faturamentoConta?.atual.valor ?? null}
        // Composição só com a coleta conciliada com a leitura ao vivo (já implica grupos cobertos): sem isso,
        // famílias/compartilhado da coleta ficariam ao lado de um investimento de outra base (ADR-0179 emenda, item 6).
        composicao={comComposicao && painel?.conciliacao?.estado === 'ok' ? painel.conta ?? undefined : undefined}
        onVerAcima={temAcima && !comComposicao ? verAcima : undefined}
      />
    );
  };

  // Linha-resumo acima da faixa: mesmo resultado do ResumoConta (sem recalcular), atalho só em Desempenho.
  const linhaResumo = (comAtalho: boolean) => resultadoConta && (
    <LinhaResultado conta={resultadoConta.conta} motivo={blocos.conta.motivo ?? resultadoConta.motivo}
      historicoDesde={historicoDesde} onVerAcima={comAtalho && temAcima ? verAcima : undefined} />
  );

  const blocoConta = (comComposicao: boolean) => (
    <div className="space-y-6">
      {linhaResumo(comComposicao)}
      <section aria-labelledby="ads-conta-inteira" className="space-y-3">
        <h2 id="ads-conta-inteira" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conta inteira</h2>
        {kpis}
      </section>
      {resumo(comComposicao)}
    </div>
  );

  // Integridade e procedência: fim das duas abas (plano §3.2, linha 5), só com o painel montado.
  // `divergenciaNoResumo`: em Desempenho o resumo (com composição) já avisa; em Campanhas avisa aqui.
  const integridade = (divergenciaNoResumo: boolean) => painel && janela && painel.estado === 'ok' && (
    <IntegridadeAds painel={painel} janelaDesde={janela.desde} historicoDesde={historicoDesde}
      coletadoEm={ultimoOkEm} lidoEm={metricasConta?.atual?.lidoEm ?? null} divergenciaNoResumo={divergenciaNoResumo} />
  );

  // ---- Desempenho: famílias e integridade ----
  let corpo: ReactNode;
  if (isError) {
    // A nova consulta fica no alerta do resultado (mesma causa: vendas).
    corpo = <p className="text-sm text-muted-foreground">Famílias indisponíveis: as vendas do período não carregaram.</p>;
  } else if (blocos.grupos.isError) {
    corpo = (
      <div role="alert" className="rounded-lg border border-border bg-card p-4 text-sm">
        <p className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          Não foi possível carregar as famílias do período.
        </p>
        <Button variant="outline" size="sm" className={`mt-3 ${BOTAO_ACAO}`} onClick={() => refetch()}>Tentar novamente</Button>
      </div>
    );
  } else if (!painel) {
    corpo = <CarregandoMarca rotulo="Carregando" mensagem="Calculando o gasto e o resultado das famílias…" />;
  } else if (painel.estado === 'sem_coleta' || painel.estado === 'coletando') {
    corpo = <Aviso texto={AVISO[painel.estado]!} acao={verificar} />;
  } else if (ehEstadoAcesso(painel.estado)) {
    corpo = <AvisoAcesso estado={painel.estado} />;
  } else if (painel.estado === 'sem_ads') {
    corpo = (
      <EmptyState
        icon={Megaphone}
        title="Sem investimento em Ads neste período"
        description="Suas campanhas continuam disponíveis."
        action={(
          <div className="flex flex-wrap justify-center gap-2">
            {atual !== '90' && (
              <Button variant="outline" size="sm" className={BOTAO_ACAO}
                onClick={() => escolherPeriodo({ tipo: 'preset', dias: 90 })}>
                Ver últimos 90 dias
              </Button>
            )}
            <Button variant="outline" size="sm" className={BOTAO_ACAO} onClick={() => trocarAba('campanhas')}>
              Ver campanhas
            </Button>
          </div>
        )}
      />
    );
  } else {
    corpo = (
      <>
        {!painel.semaforoLiberado && (
          <p className="text-xs text-muted-foreground">Semáforo em validação: por ora o painel mostra o ACOS de equilíbrio de cada família como referência, sem verde ou vermelho.</p>
        )}
        {/* A key reinicia filtro e detalhes ao trocar seleção, janela ou atalho; refetch da mesma janela não muda a key. */}
        <div ref={rankingRef} className="scroll-mt-4 space-y-6">
        <RankingFamilias key={`${atual}:${janela?.desde}:${janela?.ate}:${foco}:${atalho}`} painel={painel}
          historicoDesde={historicoDesde} focoCodigoPai={foco} inicial={atalho > 0 ? ATALHO_ACIMA_EQUILIBRIO : undefined} />
        {integridade(true)}
        </div>
      </>
    );
  }

  const bloqueio = estadoAcesso && <AvisoAcesso estado={estadoAcesso} />;
  const contagemAlerta = (
    <StatusPill tone="warning" title={emAlerta === 1 ? '1 família em alerta' : `${emAlerta} famílias em alerta`}>
      <span aria-hidden>{emAlerta}</span>
      <span className="sr-only">{emAlerta === 1 ? '1 família em alerta' : `${emAlerta} famílias em alerta`}</span>
    </StatusPill>
  );
  const desempenho = (
    <div className="space-y-6">
      {semPeriodo ?? bloqueio ?? (
        <>
          {blocoConta(true)}
          {corpo}
        </>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Despesa informada pela API de Ads do Mercado Livre.</p>
        {!resultadoConta && <p>Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.</p>}
        <p>
          {historicoDesde
            ? `Vendas desde ${dataBRT(historicoDesde)}, quando a organização começou a vender pelo PubliAI.`
            : 'Vendas desde a entrada da organização no PubliAI.'}
        </p>
      </div>
    </div>
  );

  return (
    <div className={`mx-auto w-full min-w-0 max-w-[1440px] p-4 sm:p-6 ${TELA_ADS}`}>
      <PageHeader
        title="Ads"
        subtitle="Quanto o Ads custa e o que sobra depois dele."
        actions={(
          <Button variant="outline" size="sm" className={BOTAO_ACAO} disabled={isFetching} onClick={atualizarTudo}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            Atualizar
          </Button>
        )}
      />
      {contexto}
      {aba === null ? (
        <CarregandoMarca rotulo="Carregando" mensagem="Abrindo o Ads…" />
      ) : (
        <Tabs value={aba} onValueChange={v => trocarAba(v as Aba)} className="gap-6">
          <TabsList className="group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="desempenho" className="h-8 px-3 max-sm:h-11 pointer-coarse:h-11">Desempenho</TabsTrigger>
            <TabsTrigger value="campanhas" className="h-8 px-3 max-sm:h-11 pointer-coarse:h-11">
              Campanhas
              {emAlerta > 0 && contagemAlerta}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="desempenho">{desempenho}</TabsContent>
          <TabsContent value="campanhas">
            {semPeriodo ?? bloqueio ?? (
              <AbaCampanhas dados={campanhasDados} metricas={metricasCampanhas} pedido={pedido} conta={blocoConta(false)}
                integridade={integridade(false) || undefined}
                acoes={{ verDesempenho, temDesempenho: codigo => codigosComDesempenho.has(codigo) }} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
