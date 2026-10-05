import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buscarPainelAds, janelaBRT, lucroPorFamilia, resolverPeriodoAds, type DiasAds, type JanelaDiasAds, type PeriodoAds,
} from '@/lib/ads-painel-dados';
import { BASE_ACOS_VALIDADA, montarPainelAds, type PainelAds } from '@/lib/ads-painel';
import { buscarCodigosMlbs, buscarUltimoOkAds } from '@/lib/sku-dossie-dados';
import { diaBRT } from '@/lib/calendario-brt';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { metricas, somarAcumuladores } from '@/lib/vendas-sku';

export interface RetornoAdsPainel {
  painel: PainelAds | null;
  janela: JanelaDiasAds | null;
  situacaoPeriodo: 'carregando' | 'pronto' | 'aguardando_mes';
  historicoDesde: string | null;
  ultimoOkEm: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

const meioDiaBRT = (dia: string) => new Date(`${dia}T12:00:00-03:00`);
const selecionar = (tipo: PeriodoAds['tipo'], dias: DiasAds | null): PeriodoAds =>
  tipo === 'preset' && dias !== null ? { tipo: 'preset', dias } : { tipo: 'mes_atual' };

/** Painel de Ads (ADR-0179): gasto do Ads × lucro das vendas no MESMO recorte de dias BRT.
 *  A janela é resolvida uma vez (resolverPeriodoAds) e compartilhada por RPC, vendas e montagem. */
export function useAdsPainel(periodo: PeriodoAds): RetornoAdsPainel {
  // O fim do período depende da última coleta (fimDiasAds): fonte e vendas só rodam depois dela,
  // para não baixar as vendas de uma janela provisória e de novo na certa (egress, ADR-0081).
  const syncQ = useQuery({ queryKey: ['ads-sync-fim'], queryFn: buscarUltimoOkAds, staleTime: 5 * 60_000 });
  // Dia BRT a cada render, sem timer: a virada do dia aparece no próximo render/consulta/interação.
  const hoje = diaBRT(Date.now());
  const tipo = periodo.tipo;
  const dias = periodo.tipo === 'preset' ? periodo.dias : null;
  const ultimoOkEm = syncQ.data ?? null;

  const resolucao = useMemo(
    () => resolverPeriodoAds(selecionar(tipo, dias), meioDiaBRT(hoje), ultimoOkEm),
    [tipo, dias, hoje, ultimoOkEm],
  );
  const habilitado = syncQ.isSuccess && resolucao.tipo === 'pronto';
  const desde = habilitado ? resolucao.janela!.desde : null;
  const ate = habilitado ? resolucao.janela!.ate : null;
  const janela = useMemo(() => (desde && ate ? { desde, ate } : null), [desde, ate]);

  // Sem janela pronta, vendas recebem um dia interno válido (início do mês) sempre com enabled=false;
  // ele nunca sai no retorno nem chega à montagem.
  const interno = `${hoje.slice(0, 7)}-01`;
  const vDesde = desde ?? interno;
  const vAte = ate ?? interno;
  const periodoRange = useMemo(() => ({ tipo: 'range' as const, desde: vDesde, ate: vAte }), [vDesde, vAte]);
  const janelaVendas = useMemo(() => janelaBRT(vDesde, vAte), [vDesde, vAte]);
  const vendas = useVendasSku(periodoRange, janelaVendas, habilitado);
  const catQ = useCatalogoVendasSku();
  // Chave com o intervalo efetivo e sem placeholderData: a resposta de outro recorte nunca monta este.
  const fonteQ = useQuery({ queryKey: ['ads-painel', desde, ate], queryFn: () => buscarPainelAds(desde!, ate!),
    enabled: habilitado, staleTime: 5 * 60_000 });
  const mlbs = useMemo(() => [...new Set((fonteQ.data?.grupos ?? []).flatMap((g) => g.membros))].sort(), [fonteQ.data]);
  const codQ = useQuery({ queryKey: ['ads-painel-codigos', mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: habilitado && fonteQ.isSuccess, staleTime: 5 * 60_000 });

  const painel = useMemo(() => {
    if (!janela || !fonteQ.data || !codQ.data || !catQ.data || !vendas.dados) return null;
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
    });
  }, [janela, fonteQ.data, codQ.data, catQ.data, vendas.dados]);

  // Precedência: erro de sync → sync carregando → aguardando_mes → erro das fontes → carregando → painel.
  const situacaoPeriodo = syncQ.isSuccess ? resolucao.tipo : 'carregando';
  const erroFontes = habilitado && (fonteQ.isError || codQ.isError || vendas.isError || catQ.isError);
  const isError = syncQ.isError || erroFontes;
  const isLoading = !syncQ.isError && (syncQ.isPending || (habilitado && !erroFontes && painel === null));
  const isFetching = syncQ.isFetching
    || (habilitado && (fonteQ.isFetching || codQ.isFetching || vendas.isFetching || catQ.isFetching));

  // Identidade primitiva da seleção: troca de preset durante o refetch abandona a atualização manual.
  const selecao = `${tipo}:${dias}`;
  const selecaoRef = useRef(selecao);
  selecaoRef.current = selecao;

  const refetch = async () => {
    const pedida = selecao;
    const r = await syncQ.refetch();
    if (r.isError || selecaoRef.current !== pedida) return;
    const nova = resolverPeriodoAds(selecionar(tipo, dias), meioDiaBRT(diaBRT(Date.now())), r.data ?? null);
    // Mês aguardando: nada financeiro. Janela nova: as novas chaves carregam sozinhas.
    if (nova.tipo !== 'pronto' || nova.janela.desde !== desde || nova.janela.ate !== ate) return;
    await Promise.all([
      fonteQ.refetch().then((f) => (f.isSuccess ? codQ.refetch() : undefined)),
      vendas.refetch(),
      catQ.refetch(),
    ]);
  };

  return {
    painel, janela, situacaoPeriodo, historicoDesde: vendas.dados?.historicoDesde ?? null, ultimoOkEm,
    isLoading, isFetching, isError, refetch,
  };
}
