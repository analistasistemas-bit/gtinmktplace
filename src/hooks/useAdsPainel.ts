import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buscarPainelAds, comparacaoAds, janelaBRT, lucroPorFamilia, resolverPeriodoAds,
  type ComparacaoAds, type JanelaDiasAds, type PeriodoAds,
} from '@/lib/ads-painel-dados';
import { BASE_ACOS_VALIDADA, montarPainelAds, type ContaAoVivo, type PainelAds } from '@/lib/ads-painel';
import { buscarCodigosMlbs, buscarUltimoOkAds } from '@/lib/sku-dossie-dados';
import { diaBRT } from '@/lib/calendario-brt';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';
import { metricas, somarAcumuladores } from '@/lib/vendas-sku';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

export interface EstadoBlocoAds { isLoading: boolean; isError: boolean }

export interface RetornoAdsPainel {
  painel: PainelAds | null;
  janela: JanelaDiasAds | null;
  /** null sem janela pronta. */
  comparacao: ComparacaoAds | null;
  /** Resposta da edge para o escopo 'conta' (série ao vivo, resumo, anterior). */
  metricasConta: RespostaAdsMetricas | null;
  /** Denominador do TACOS: vendas faturáveis do canal ML na janela (e na anterior, se houver comparação). */
  faturamentoConta: { atual: number; anterior: number | null } | null;
  situacaoPeriodo: 'carregando' | 'pronto' | 'aguardando_mes' | 'invalido';
  historicoDesde: string | null;
  ultimoOkEm: string | null;
  /** conta = vendas + leitura ao vivo; grupos = RPC + códigos + catálogo; sync = última coleta (só informativo). */
  blocos: { conta: EstadoBlocoAds; grupos: EstadoBlocoAds; sync: EstadoBlocoAds };
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

const meioDiaBRT = (dia: string) => new Date(`${dia}T12:00:00-03:00`);
/** Leitura ao vivo ausente (sem acesso, erro): série vazia e incompleta → conta indisponível com motivo.
 *  Nunca `undefined`: montarPainelAds recairia na série coletada, misturando bases. */
const SEM_LEITURA: ContaAoVivo = { serie: [], completo: false, lidoEm: '' };

/** Painel de Ads (ADR-0179, plano §5.6): gasto do Ads × lucro das vendas no MESMO recorte de dias BRT.
 *  A janela é resolvida uma vez (resolverPeriodoAds, até ontem BRT, sem depender da coleta) e compartilhada por
 *  RPC, vendas, leitura ao vivo e montagem. A conta usa só a série ao vivo; grupos/famílias seguem pela coleta.
 *  Toda chave leva a org e não há placeholderData: resposta tardia de outra org/janela nunca monta esta tela. */
export function useAdsPainel(periodo: PeriodoAds): RetornoAdsPainel {
  const orgId = useOrgEfetivaId();
  // O sync só alimenta `ultimoOkEm`: não bloqueia nem a janela nem as finanças.
  const syncQ = useQuery({ queryKey: ['ads-sync-fim', orgId], queryFn: buscarUltimoOkAds, staleTime: 5 * 60_000,
    enabled: orgId != null });
  // Dia BRT a cada render, sem timer: a virada do dia aparece no próximo render/consulta/interação.
  const hoje = diaBRT(Date.now());
  const tipo = periodo.tipo;
  const dias = periodo.tipo === 'preset' ? periodo.dias : null;
  const rDesde = periodo.tipo === 'range' ? periodo.desde : null;
  const rAte = periodo.tipo === 'range' ? periodo.ate : null;
  // Primitivos na identidade: o objeto do chamador pode mudar de referência sem mudar a seleção.
  const selecionado = useMemo<PeriodoAds>(
    () => (tipo === 'range' ? { tipo, desde: rDesde!, ate: rAte! }
      : tipo === 'preset' ? { tipo, dias: dias! } : { tipo }),
    [tipo, dias, rDesde, rAte],
  );
  const ultimoOkEm = syncQ.data ?? null;

  const resolucao = useMemo(() => resolverPeriodoAds(selecionado, meioDiaBRT(hoje), null), [selecionado, hoje]);
  const habilitado = orgId != null && resolucao.tipo === 'pronto';
  const desde = resolucao.tipo === 'pronto' ? resolucao.janela.desde : null;
  const ate = resolucao.tipo === 'pronto' ? resolucao.janela.ate : null;
  const janela = useMemo(() => (desde && ate ? { desde, ate } : null), [desde, ate]);
  const comparacao = useMemo(() => (janela ? comparacaoAds(janela, meioDiaBRT(hoje)) : null), [janela, hoje]);
  const aDesde = comparacao?.tipo === 'pronta' ? comparacao.janela.desde : null;
  const aAte = comparacao?.tipo === 'pronta' ? comparacao.janela.ate : null;

  // Sem janela pronta, vendas recebem um dia interno válido (início do mês) sempre com enabled=false;
  // ele nunca sai no retorno nem chega à montagem.
  const interno = `${hoje.slice(0, 7)}-01`;
  const vDesde = desde ?? interno;
  const vAte = ate ?? interno;
  const periodoRange = useMemo(() => ({ tipo: 'range' as const, desde: vDesde, ate: vAte }), [vDesde, vAte]);
  const janelaVendas = useMemo(() => janelaBRT(vDesde, vAte), [vDesde, vAte]);
  // Canal ML (origem 'todos' é fixa no useVendasSku): o mesmo universo do Ads. Anterior só com comparação pronta.
  const opcoesVendas = useMemo(() => ({ canal: 'mercado_livre' as const,
    anteriorFixa: aDesde && aAte ? janelaBRT(aDesde, aAte) : undefined }), [aDesde, aAte]);
  const vendas = useVendasSku(periodoRange, janelaVendas, habilitado, opcoesVendas);

  const pedidoConta = useMemo<PedidoAdsMetricas | null>(() => (desde && ate
    ? { desde, ate, escopo: 'conta', comparar: aDesde ? 'anterior' : 'nenhum' } : null), [desde, ate, aDesde]);
  const metricasQ = useAdsMetricas(pedidoConta, habilitado);

  const catQ = useCatalogoVendasSku();
  // Chave com org e intervalo efetivo, sem placeholderData: a resposta de outro recorte nunca monta este.
  const fonteQ = useQuery({ queryKey: ['ads-painel', orgId, desde, ate], queryFn: () => buscarPainelAds(desde!, ate!),
    enabled: habilitado, staleTime: 5 * 60_000 });
  const mlbs = useMemo(() => [...new Set((fonteQ.data?.grupos ?? []).flatMap((g) => g.membros))].sort(), [fonteQ.data]);
  const codQ = useQuery({ queryKey: ['ads-painel-codigos', orgId, mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: habilitado && fonteQ.isSuccess, staleTime: 5 * 60_000 });

  // Leitura assentada (dado ou erro): antes disso não monta, senão a conta piscaria indisponível.
  const leituraAssentada = metricasQ.data !== undefined || metricasQ.isError;
  const contaAoVivo = useMemo<ContaAoVivo | null>(() => {
    if (!leituraAssentada) return null;
    const atual = metricasQ.data?.atual;
    return atual ? { serie: atual.serie, completo: atual.completo, lidoEm: atual.lidoEm } : SEM_LEITURA;
  }, [leituraAssentada, metricasQ.data]);

  const painel = useMemo(() => {
    if (!janela || !contaAoVivo || !fonteQ.data || !codQ.data || !catQ.data || !vendas.dados) return null;
    const acc = somarAcumuladores(vendas.dados.linhas.map((l) => l.acc));
    const total = metricas(acc);
    // Nenhuma venda faturável no período (com histórico coberto): lucro 0, não "sem custo" (achado #9).
    const lucroConta = acc.pedidos === 0 ? { lucro: 0, fonteCusto: 'real' as const } : { lucro: total.lucro, fonteCusto: total.fonteCusto };
    return montarPainelAds({
      fonte: fonteQ.data, janela, agora: new Date(), codigosPorMlb: codQ.data,
      familiaDoCodigo: new Map(catQ.data.filter((c) => c.codigoPai).map((c) => [c.codigo, c.codigoPai!])),
      nomeDaFamilia: new Map(catQ.data.filter((c) => c.codigoPai && c.nomeFamilia).map((c) => [c.codigoPai!, c.nomeFamilia!])),
      lucroPorFamilia: lucroPorFamilia(vendas.dados.linhas), lucroConta,
      historicoDesde: vendas.dados.historicoDesde, baseAcosValidada: BASE_ACOS_VALIDADA,
      // Sem base fiscal declarada não há lucro: o default é bloquear, nunca liberar (ADR-0055).
      baseFiscal: vendas.baseFiscal ?? { ok: false, motivo: 'aliquotas_carregando' },
      contaAoVivo,
    });
  }, [janela, contaAoVivo, fonteQ.data, codQ.data, catQ.data, vendas.dados, vendas.baseFiscal]);

  const situacaoPeriodo = resolucao.tipo;
  const erroGrupos = habilitado && (fonteQ.isError || codQ.isError || catQ.isError);
  const blocos = {
    conta: { isLoading: habilitado && !vendas.isError && !metricasQ.isError && (!vendas.dados || !leituraAssentada),
      isError: habilitado && (vendas.isError || metricasQ.isError) },
    grupos: { isLoading: habilitado && !erroGrupos && (!fonteQ.data || !codQ.data || !catQ.data), isError: erroGrupos },
    sync: { isLoading: syncQ.isPending && orgId != null, isError: syncQ.isError },
  };
  // Erro da leitura ao vivo não derruba a tela: a conta sai indisponível com motivo; sync é só informativo.
  const isError = erroGrupos || (habilitado && vendas.isError);
  const isLoading = habilitado && !isError && painel === null;
  const isFetching = syncQ.isFetching
    || (habilitado && (fonteQ.isFetching || codQ.isFetching || vendas.isFetching || catQ.isFetching || metricasQ.isFetching));

  // ponytail: sem esperar o sync, o refetch dispara já nas chaves da janela atual; troca de período no meio
  // só deixa a busca terminar na chave antiga (sem placeholderData, ela nunca aparece na nova).
  const refetch = async () => {
    if (!habilitado) { await syncQ.refetch(); return; }
    await Promise.all([
      syncQ.refetch(),
      fonteQ.refetch().then((f) => (f.isSuccess ? codQ.refetch() : undefined)),
      vendas.refetch(),
      catQ.refetch(),
      metricasQ.refetch(),
    ]);
  };

  return {
    painel, janela, comparacao, metricasConta: metricasQ.data ?? null, faturamentoConta: habilitado ? vendas.faturamentoConta : null,
    situacaoPeriodo, historicoDesde: vendas.dados?.historicoDesde ?? null, ultimoOkEm, blocos,
    isLoading, isFetching, isError, refetch,
  };
}
