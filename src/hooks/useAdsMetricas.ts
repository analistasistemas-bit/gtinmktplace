import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buscarMetricasAds } from '@/lib/ads-metricas-dados';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

const STALE = 5 * 60_000;

/**
 * Métricas do /ads por período (plano ads-redesign §5/7.1). A chave leva a org e o pedido completo (escopo,
 * campanhaId, comparar, datas; `fresco` fica de fora): resposta tardia de outra org/período cai na chave dela e
 * nunca na tela atual. Sem polling e sem placeholderData: trocar de período mostra carregando, não o dado antigo.
 * `refetch` fura o cache da edge (`fresco: true`, uma vez) e grava na chave do pedido que o disparou.
 */
export function useAdsMetricas(pedido: PedidoAdsMetricas | null, habilitado: boolean) {
  const qc = useQueryClient();
  const orgId = useOrgEfetivaId();
  const chave = useMemo(() => {
    if (!pedido) return null;
    // Reconstruído campo a campo: `fresco` e chaves extras do chamador não fragmentam o cache.
    const { desde, ate, comparar, escopo, campanhaId } = pedido;
    return ['ads-metricas', orgId, { desde, ate, comparar, escopo, campanhaId: campanhaId ?? null }] as const;
  }, [orgId, pedido]);
  const q = useQuery<RespostaAdsMetricas>({
    queryKey: chave ?? ['ads-metricas', orgId, null],
    queryFn: () => buscarMetricasAds({ ...pedido!, fresco: undefined }),
    staleTime: STALE,
    enabled: habilitado && pedido !== null && chave !== null && orgId != null,
  });
  const refetch = async () => {
    if (!pedido || !chave) return;
    // Falha não rejeita: vira isError/error da própria query e o dado anterior da chave fica.
    await qc.fetchQuery({ queryKey: chave, queryFn: () => buscarMetricasAds({ ...pedido, fresco: true }), staleTime: 0 })
      .catch(() => undefined);
  };
  return { data: q.data, isLoading: q.isLoading, isFetching: q.isFetching, isError: q.isError, error: q.error, refetch };
}
