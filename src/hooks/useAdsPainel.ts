import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarPainelAds, janelaBRT, lucroPorFamilia, periodoAds, type DiasAds } from '@/lib/ads-painel-dados';
import { BASE_ACOS_VALIDADA, montarPainelAds } from '@/lib/ads-painel';
import { buscarCodigosMlbs } from '@/lib/sku-dossie-dados';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { metricas, somarAcumuladores } from '@/lib/vendas-sku';

/** Painel de Ads (ADR-0179): gasto do Ads × lucro das vendas no MESMO recorte de dias BRT. */
export function useAdsPainel(dias: DiasAds) {
  const janela = useMemo(() => periodoAds(dias, new Date()), [dias]);
  const periodoRange = useMemo(() => ({ tipo: 'range' as const, ...janela }), [janela]);
  const janelaVendas = useMemo(() => janelaBRT(janela.desde, janela.ate), [janela]);
  const vendas = useVendasSku(periodoRange, janelaVendas);
  const catQ = useCatalogoVendasSku();
  const fonteQ = useQuery({ queryKey: ['ads-painel', janela], queryFn: () => buscarPainelAds(janela.desde, janela.ate),
    staleTime: 5 * 60_000 });
  const mlbs = useMemo(() => [...new Set((fonteQ.data?.grupos ?? []).flatMap((g) => g.membros))].sort(), [fonteQ.data]);
  const codQ = useQuery({ queryKey: ['ads-painel-codigos', mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: fonteQ.isSuccess, staleTime: 5 * 60_000 });

  const painel = useMemo(() => {
    if (!fonteQ.data || !codQ.data || !catQ.data || !vendas.dados) return null;
    const acc = somarAcumuladores(vendas.dados.linhas.map((l) => l.acc));
    const total = metricas(acc);
    // Nenhuma venda faturável no período (com histórico coberto): lucro 0, não "sem custo" (achado #9).
    const lucroConta = acc.pedidos === 0 ? { lucro: 0, fonteCusto: 'real' as const } : { lucro: total.lucro, fonteCusto: total.fonteCusto };
    return montarPainelAds({
      fonte: fonteQ.data, janela, agora: new Date(), codigosPorMlb: codQ.data,
      familiaDoCodigo: new Map(catQ.data.filter((c) => c.codigoPai).map((c) => [c.codigo, c.codigoPai!])),
      lucroPorFamilia: lucroPorFamilia(vendas.dados.linhas), lucroConta,
      historicoDesde: vendas.dados.historicoDesde, baseAcosValidada: BASE_ACOS_VALIDADA,
    });
  }, [fonteQ.data, codQ.data, catQ.data, vendas.dados, janela]);

  return {
    painel, janela, historicoDesde: vendas.dados?.historicoDesde ?? null,
    isLoading: fonteQ.isLoading || codQ.isLoading || vendas.isLoading,
    isError: fonteQ.isError || codQ.isError || vendas.isError || catQ.isError,
    refetch: () => { void fonteQ.refetch(); void codQ.refetch(); void vendas.refetch(); },
  };
}
