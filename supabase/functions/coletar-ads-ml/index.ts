// Vendas SKU Fatia 2c — coleta diária de Product Ads por grupo (só GET no ML).
// Worker QStash puro (schedule `17 14 * * *` UTC = 11:17 BRT; runbook docs/runbooks/coletar-ads-ml.md):
//  - {} → fan-out de 1 mensagem por org com conexão ML e, depois, a retenção de 13 meses;
//  - { org_id, primeira | rodada, cursor, tentativa, falhou } → uma mensagem da cadeia da org.
// `tratarRequisicao` (2b) não conhece `falhou` — campo específico da orquestração de Ads (Ruling 2c-5) —
// mas repassa o corpo já parseado como 2º argumento de `sincronizar`; `msgAdsDoCorpo` junta a flag de volta.
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { tratarRequisicao } from '../_shared/trafego/fiacao.ts';
import { msgAdsDoCorpo, resultadoParaFiacaoTrafego } from '../_shared/ads/fiacao.ts';
import { sincronizarAdsOrg } from '../_shared/ads/sincronizar.ts';
import { depsAds, limparRetencao, publicarFanout } from './deps.ts';

Deno.serve((req) => tratarRequisicao(req, {
  rotulo: 'coletar-ads-ml',
  verificar: verificarAssinatura,
  fanout: () => publicarFanout(adminClient()),
  limpar: () => limparRetencao(adminClient()),
  // `tratarRequisicao` (2b) só conhece ResultadoTrafego; sincronizarAdsOrg distingue mais estados
  // (sem_permissao/sem_advertiser) — resultadoParaFiacaoTrafego colapsa só nesta borda HTTP.
  sincronizar: async (msg, p) => {
    const { resultado } = await sincronizarAdsOrg(depsAds(adminClient(), msg.org_id), msgAdsDoCorpo(msg, p));
    return { resultado: resultadoParaFiacaoTrafego(resultado) };
  },
}));
