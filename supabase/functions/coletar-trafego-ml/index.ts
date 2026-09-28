// Vendas SKU Fatia 2b — coleta diária de visitas/dia e preço de oferta por MLB (só GET no ML).
// Worker QStash puro (schedule `17 9 * * *` UTC = 06:17 BRT; runbook docs/runbooks/coletar-trafego-ml.md):
//  - {} → fan-out de 1 mensagem por org com conexão ML e, depois, a retenção de 13 meses;
//  - { org_id, primeira | rodada, cursor, tentativa } → uma mensagem da cadeia da org.
// Roteamento em _shared/trafego/fiacao.ts (tratarRequisicao), fiação em deps.ts.
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { tratarRequisicao } from '../_shared/trafego/fiacao.ts';
import { sincronizarTrafegoOrg } from '../_shared/trafego/sincronizar.ts';
import { depsTrafego, limparRetencao, publicarFanout } from './deps.ts';

Deno.serve((req) => tratarRequisicao(req, {
  verificar: verificarAssinatura,
  fanout: () => publicarFanout(adminClient()),
  limpar: () => limparRetencao(adminClient()),
  sincronizar: (msg) => sincronizarTrafegoOrg(depsTrafego(adminClient(), msg.org_id), msg),
}));
