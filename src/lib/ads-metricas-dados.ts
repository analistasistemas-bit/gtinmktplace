import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge, erroDaEdge } from '@/lib/edge-erro';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

/** Lê as métricas do Mercado Ads por período pela edge `ads-metricas`. `pedido.fresco` ignora o cache da edge. */
export async function buscarMetricasAds(pedido: PedidoAdsMetricas): Promise<RespostaAdsMetricas> {
  const { data, error } = await supabase.functions.invoke('ads-metricas', { body: pedido });
  if (error) {
    // A edge responde `{ ok:false, erro, motivo? }` (o `erroDaEdge` só lê `error`): extrai a mensagem daqui.
    const r = await corpoDoErroDaEdge(error);
    if (!r) throw await erroDaEdge(error);
    const { erro, motivo } = r.corpo as { erro?: string; motivo?: string };
    throw new Error(erro ? (motivo ? `${erro}: ${motivo}` : erro) : 'Não foi possível ler as métricas do Ads.');
  }
  const r = data as { ok?: boolean; erro?: string } | null;
  if (!r || r.ok !== true) throw new Error(r?.erro ?? 'Não foi possível ler as métricas do Ads.');
  return data as RespostaAdsMetricas;
}
