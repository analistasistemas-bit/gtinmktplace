// Vendas SKU Fatia 2c — coleta diária de Product Ads por grupo (só GET no ML).
// Worker QStash puro (schedule `17 14 * * *` UTC = 11:17 BRT; runbook docs/runbooks/coletar-ads-ml.md):
//  - {} → fan-out de 1 mensagem por org com conexão ML e, depois, a retenção de 13 meses;
//  - { org_id, primeira | rodada, cursor, tentativa, falhou } → uma mensagem da cadeia da org.
// `tratarRequisicao` (2b) não conhece `falhou` — campo específico da orquestração de Ads (Ruling 2c-5) —,
// então o corpo é clonado e lido de novo aqui (msgAdsDoCorpo) antes de `tratarRequisicao` consumir o
// original; a assinatura do QStash é validada nos bytes crus por `verificarAssinatura`, não no clone.
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { tratarRequisicao } from '../_shared/trafego/fiacao.ts';
import { msgAdsDoCorpo } from '../_shared/ads/fiacao.ts';
import { sincronizarAdsOrg } from '../_shared/ads/sincronizar.ts';
import { depsAds, limparRetencao, publicarFanout } from './deps.ts';

Deno.serve(async (req) => {
  const corpoTexto = await req.clone().text();
  let corpo: unknown = null;
  try { corpo = corpoTexto ? JSON.parse(corpoTexto) : null; } catch { /* corpo inválido: tratarRequisicao devolve 400 */ }
  return tratarRequisicao(req, {
    rotulo: 'coletar-ads-ml',
    verificar: verificarAssinatura,
    fanout: () => publicarFanout(adminClient()),
    limpar: () => limparRetencao(adminClient()),
    sincronizar: (msg) => sincronizarAdsOrg(depsAds(adminClient(), msg.org_id), msgAdsDoCorpo(msg, corpo)),
  });
});
