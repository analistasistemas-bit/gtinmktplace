import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolverJanela, janelaAnterior, type Periodo } from '@/lib/metricas';
import { useCustos } from '@/hooks/useCustos';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useCoresProduto } from '@/hooks/useCoresProduto';
import { useAnuncioCanonico } from '@/hooks/useAnuncioCanonico';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { montarCorResolver } from '@/lib/cor-produto';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { buscarVendasPorIds, type Venda } from '@/lib/faturamento';
import {
  buscarIdsDossie, buscarMlbsDossie, buscarMovimentos, buscarModeracoes, buscarPerguntas, buscarCampanhas,
  buscarVisitasDia, buscarPrecoDia, buscarTrafegoSync, buscarFonteAds,
} from '@/lib/sku-dossie-dados';
import { intervalosBRT, type Passo } from '@/lib/calendario-brt';
import { montarDossie, type AlvoDossie, type DossieSku, type EstadoDossie } from '@/lib/sku-dossie';
import { conjuntoTrafego, faixaTrafego, montarTrafego } from '@/lib/sku-trafego';
import { montarAds, type AdsDossie } from '@/lib/sku-ads';

const HOJE_30: Periodo = { tipo: 'preset', dias: 30 };

/** Dossiê do SKU (ou da família): busca e entrega a `montarDossie`. Mesmos resolvers e mesma
 *  espera de custos/devoluções de useVendasSku — é isso que faz o lucro bater com o ranking. */
export function useSkuDossie(alvo: AlvoDossie, periodo: Periodo, passo: Passo) {
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const anterior = useMemo(() => janelaAnterior(janela, periodo), [janela, periodo]);
  const intervalos = useMemo(() => intervalosBRT(janela.desde, janela.ate, passo), [janela, passo]);

  const custosQ = useCustos();
  const custos = custosQ.data;
  const { data: fotos } = useFotosProduto();
  const { data: cores } = useCoresProduto();
  const { data: canonico } = useAnuncioCanonico();
  const { data: aliquotas } = useAliquotas();
  const devQ = useDevolucoes();
  const catQ = useCatalogoVendasSku();

  // alvo chega como objeto novo a cada render: estabiliza por tipo + código.
  const chaveAlvo = alvo.tipo === 'sku' ? alvo.codigo : alvo.codigoPai;
  const alvoM = useMemo<AlvoDossie>(() => (alvo.tipo === 'sku'
    ? { tipo: 'sku', codigo: chaveAlvo } : { tipo: 'familia', codigoPai: chaveAlvo }), [alvo.tipo, chaveAlvo]);
  const codigos = useMemo(() => (alvoM.tipo === 'sku'
    ? [alvoM.codigo]
    : (catQ.data ?? []).filter((c) => c.codigoPai === alvoM.codigoPai).map((c) => c.codigo).sort()),
  [alvoM, catQ.data]);
  // Kit: entradas e rupturas pertencem à base.
  const movCodigos = useMemo(() => {
    const cat = new Map((catQ.data ?? []).map((c) => [c.codigo, c]));
    return [...new Set(codigos.map((c) => cat.get(c)?.kitBaseCodigo ?? c))];
  }, [codigos, catQ.data]);

  const vendasQ = useQuery<Venda[]>({
    queryKey: ['sku-dossie-vendas', codigos],
    queryFn: async () => buscarVendasPorIds(await buscarIdsDossie(codigos)),
    enabled: codigos.length > 0,
    staleTime: 5 * 60_000,
  });
  const extrasQ = useQuery({
    queryKey: ['sku-dossie-extras', codigos, movCodigos],
    queryFn: async () => {
      const [mlbs, movimentos] = await Promise.all([buscarMlbsDossie(codigos), buscarMovimentos(movCodigos)]);
      const lista = [...mlbs.keys()];
      const [moderacoes, perguntas, campanhas] = await Promise.all([
        buscarModeracoes(lista), buscarPerguntas(lista), buscarCampanhas(lista),
      ]);
      return { mlbs, movimentos, moderacoes, perguntas, campanhas };
    },
    enabled: codigos.length > 0 && !!catQ.data,
    staleTime: 5 * 60_000,
  });

  // Tráfego (Fatia 2b): query à parte — falhar aqui não derruba o dossiê.
  const conj = useMemo(() => (extrasQ.data ? conjuntoTrafego(alvoM, codigos, extrasQ.data.mlbs) : null), [extrasQ.data, alvoM, codigos]);
  const faixa = useMemo(() => faixaTrafego(intervalos), [intervalos]);
  const temTrafego = !!conj && conj.mlbs.length > 0 && !!faixa;
  const trafegoQ = useQuery({
    queryKey: ['sku-dossie-trafego', conj?.mlbs, conj?.codigosExtras, faixa],
    queryFn: async () => {
      const { mlbs, codigosExtras } = conj!;
      const { desde, ate } = faixa!;
      const [visitas, precos, sync, vendasExtras] = await Promise.all([
        buscarVisitasDia(mlbs, desde, ate), buscarPrecoDia(mlbs, desde, ate), buscarTrafegoSync(),
        // Alcance anúncio: as vendas dos outros códigos do MLB compartilhado (as do alvo já vieram).
        codigosExtras.length ? buscarIdsDossie(codigosExtras).then(buscarVendasPorIds) : Promise.resolve([] as Venda[]),
      ]);
      return { visitas, precos, sync, vendasExtras };
    },
    enabled: temTrafego,
    staleTime: 5 * 60_000,
  });

  // Ads (Fatia 2c): query à parte, como o tráfego — falhar aqui não derruba o dossiê. Faixa do tráfego:
  // a partir do 1º dia do 1º intervalo (que pode começar antes do período).
  const mlbsAds = useMemo(() => (extrasQ.data ? [...extrasQ.data.mlbs.keys()].sort() : []), [extrasQ.data]);
  const temAds = mlbsAds.length > 0 && !!faixa;
  const adsQ = useQuery({
    queryKey: ['sku-dossie-ads', mlbsAds, faixa],
    queryFn: () => buscarFonteAds(mlbsAds, faixa!.desde, faixa!.ate),
    enabled: temAds,
    staleTime: 5 * 60_000,
  });

  const agrupar = useMemo(() => {
    const custoR = montarCustoResolver(custos);
    const pesoR = montarPesoResolver(custos);
    const fotoR = montarFotoResolver(fotos, canonico);
    const aliqR = montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 });
    const corR = montarCorResolver(cores, canonico);
    return (vs: Venda[]) => agruparPorPedido(vs, custoR, pesoR, fotoR, aliqR, corR);
  }, [custos, fotos, cores, canonico, aliquotas]);

  const r = useMemo<{ estado: EstadoDossie; dados: Omit<DossieSku, 'trafego'> | null }>(() => {
    if (catQ.isError || devQ.isError || vendasQ.isError || extrasQ.isError) return { estado: 'erro', dados: null };
    if (!catQ.data) return { estado: 'carregando', dados: null };
    if (!codigos.length) return { estado: 'nao_encontrado', dados: null }; // família fora do catálogo
    // Espera custos (sem erro) e devoluções como useVendasSku: nada de "sem custo" ou taxa 0 no load.
    if (!vendasQ.data || !extrasQ.data || !devQ.data || (!custos && !custosQ.isError)) return { estado: 'carregando', dados: null };
    const hoje = resolverJanela(HOJE_30); // posição de hoje: "agora" reancora a cada recálculo
    return montarDossie({
      alvo: alvoM, codigos, vendas: vendasQ.data, agrupar,
      catalogo: catQ.data, devolucoes: devQ.data, janela, anterior, hoje, hojeAnterior: janelaAnterior(hoje, HOJE_30), intervalos, ...extrasQ.data,
    });
  }, [catQ.isError, devQ.isError, vendasQ.isError, extrasQ.isError, catQ.data, alvoM, codigos, vendasQ.data, extrasQ.data, devQ.data,
    custos, custosQ.isError, agrupar, janela, anterior, intervalos]);

  // Memo à parte: o tráfego chegar (ou falhar) não recalcula o dossiê.
  const dados = useMemo<DossieSku | null>(() => {
    if (!r.dados || !extrasQ.data || !vendasQ.data) return null;
    const trafego = montarTrafego({
      alvo: alvoM, codigos, mlbs: extrasQ.data.mlbs, agrupar, intervalos, agora: new Date(),
      vendas: trafegoQ.data ? [...vendasQ.data, ...trafegoQ.data.vendasExtras] : vendasQ.data,
      fonte: trafegoQ.isError ? 'erro' : trafegoQ.data ?? 'carregando',
    });
    return { ...r.dados, trafego };
  }, [r.dados, extrasQ.data, vendasQ.data, alvoM, codigos, agrupar, intervalos, trafegoQ.isError, trafegoQ.data]);

  // Memo à parte: os Ads chegarem (ou falharem) não recalculam o dossiê. Só leitura: nada volta ao lucro.
  const ads = useMemo<AdsDossie | null>(() => {
    if (!r.dados || !extrasQ.data) return null;
    return montarAds({
      alvo: alvoM, codigos, mlbs: extrasQ.data.mlbs, intervalos, janela,
      lucroPeriodo: r.dados.linhaPeriodo?.m.lucro ?? null, fonteCusto: r.dados.linhaPeriodo?.m.fonteCusto ?? null, agora: new Date(),
      fonte: adsQ.isError ? 'erro' : adsQ.data ?? 'carregando',
    });
  }, [r.dados, extrasQ.data, alvoM, codigos, intervalos, janela, adsQ.isError, adsQ.data]);

  return {
    estado: r.estado, dados, ads,
    refetch: () => Promise.all([catQ.refetch(), devQ.refetch(), vendasQ.refetch(), extrasQ.refetch(),
      // refetch() roda a queryFn mesmo com enabled=false: sem conjunto, não há o que ler.
      ...(temTrafego ? [trafegoQ.refetch()] : []), ...(temAds ? [adsQ.refetch()] : [])]),
    /** "Tentar de novo" do painel de tráfego: só a query dele. */
    refetchTrafego: async () => { if (temTrafego) await trafegoQ.refetch(); },
    /** "Tentar de novo" da aba Ads: só a query dela. */
    refetchAds: async () => { if (temAds) await adsQ.refetch(); },
  };
}
