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
    // `error` é o formato do requireUserOrg (ex.: 401 "Sessão expirada"); `erro`/`motivo` é o do handler.
    const { erro, error: msg, motivo } = r.corpo as { erro?: string; error?: string; motivo?: string };
    const texto = erro ?? msg;
    throw new Error(texto ? (motivo ? `${texto}: ${motivo}` : texto) : 'Não foi possível ler as métricas do Ads.');
  }
  const r = data as { ok?: boolean; erro?: string } | null;
  if (!r || r.ok !== true) throw new Error(r?.erro ?? 'Não foi possível ler as métricas do Ads.');
  return data as RespostaAdsMetricas;
}
