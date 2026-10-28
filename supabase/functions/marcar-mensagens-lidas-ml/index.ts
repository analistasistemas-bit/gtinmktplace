// Marca como lidas NO ML as mensagens de um pack (pós-venda do ML, Task 7). Chamada pelo frontend (JWT)
// ao expandir um card com mensagem não lida. É o ÚNICO lugar que passa mark_as_read=true; todo o
// resto lê com false. Não mexe em `ml_mensagens.lida` (dispensada/tratada localmente) — só grava a
// leitura do ML (`lida_ml_em`, monotônico) pelo upsert estrito, com o dono da conexão como user_id.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import {
  lerPackMarcandoLido,
  ERRO_RECONECTAR_ML,
  resolverMetaPack,
  upsertMensagensEstrito,
} from '../_shared/faturamento/mensagens-io.ts';

interface Body { pack_id?: string }

const resposta = (corpo: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);
const erro = (msg: string, status: number) => resposta({ ok: false, erro: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const packId = String(body.pack_id ?? '').trim();
  if (!/^\d+$/.test(packId)) return erro('pack_id inválido', 400);

  const admin = adminClient();
  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);
  const sellerId = conexao.contaExternaId;
  const dono = (cxRow?.criado_por as string | null) ?? null; // mesma chave user_id do sync/backfill.
  if (!dono) return erro('Conexão ML sem dono definido.', 400);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  try {
    const msgs = await lerPackMarcandoLido(token, packId, sellerId);
    if (msgs.length) {
      const meta = await resolverMetaPack(admin, dono, packId);
      await upsertMensagensEstrito(admin, dono, orgId, packId, meta, sellerId, msgs);
    }
  } catch (e) {
    const msg = (e as Error).message;
    return erro(msg, msg === ERRO_RECONECTAR_ML ? 403 : 502);
  }
  return resposta({ ok: true });
});
