import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarPainelAds, janelaBRT, lucroPorFamilia, periodoAds, type DiasAds } from '@/lib/ads-painel-dados';
import { BASE_ACOS_VALIDADA, montarPainelAds } from '@/lib/ads-painel';
import { buscarCodigosMlbs, buscarUltimoOkAds } from '@/lib/sku-dossie-dados';
import { useVendasSku } from '@/hooks/useVendasSku';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { metricas, somarAcumuladores } from '@/lib/vendas-sku';

/** Painel de Ads (ADR-0179): gasto do Ads × lucro das vendas no MESMO recorte de dias BRT. */
export function useAdsPainel(dias: DiasAds) {
  // O fim do período depende da última coleta (fimDiasAds): fonte e vendas só rodam depois dela,
  // para não baixar as vendas de uma janela provisória e de novo na certa (egress, ADR-0081).
  const syncQ = useQuery({ queryKey: ['ads-sync-fim'], queryFn: buscarUltimoOkAds, staleTime: 5 * 60_000 });
  const pronto = syncQ.isSuccess;
  const janela = useMemo(() => periodoAds(dias, new Date(), syncQ.data ?? null), [dias, syncQ.data]);
  const periodoRange = useMemo(() => ({ tipo: 'range' as const, ...janela }), [janela]);
  const janelaVendas = useMemo(() => janelaBRT(janela.desde, janela.ate), [janela]);
  const vendas = useVendasSku(periodoRange, janelaVendas, pronto);
  const catQ = useCatalogoVendasSku();
  const fonteQ = useQuery({ queryKey: ['ads-painel', janela], queryFn: () => buscarPainelAds(janela.desde, janela.ate),
    enabled: pronto, staleTime: 5 * 60_000 });
  const mlbs = useMemo(() => [...new Set((fonteQ.data?.grupos ?? []).flatMap((g) => g.membros))].sort(), [fonteQ.data]);
  const codQ = useQuery({ queryKey: ['ads-painel-codigos', mlbs], queryFn: () => buscarCodigosMlbs(mlbs),
    enabled: fonteQ.isSuccess, staleTime: 5 * 60_000 });

  const painel = useMemo(() => {
    if (!pronto || !fonteQ.data || !codQ.data || !catQ.data || !vendas.dados) return null;
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
  }, [pronto, fonteQ.data, codQ.data, catQ.data, vendas.dados, janela]);

  return {
    painel, janela, historicoDesde: vendas.dados?.historicoDesde ?? null,
    isLoading: syncQ.isLoading || fonteQ.isLoading || codQ.isLoading || vendas.isLoading,
    isError: syncQ.isError || fonteQ.isError || codQ.isError || vendas.isError || catQ.isError,
    refetch: () => { if (!pronto) { void syncQ.refetch(); return; } void fonteQ.refetch(); void codQ.refetch(); void vendas.refetch(); },
  };
}
