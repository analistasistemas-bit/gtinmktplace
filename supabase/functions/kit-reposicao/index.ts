// ADR-0197 (Task 14): worker QStash da reposição automática de um kit ("Vender só em kit"). Casca fina: liga
// `executarReposicao` no banco (decisões versionadas), no ML (reativar a pausa da automação) e no Telegram.
// Disparado em lote por kit (`enfileirarReposicao`) depois de venda, fim de transferência (entrada, ajuste,
// estorno, cancelamento) e desligar a opção. 500 = algo ficou para depois; o QStash repete.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarSaga, verificarAssinatura, type KitReposicaoJob } from '../_shared/queue.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { atualizarStatusML } from '../_shared/ml/atualizar-item.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { lerStatusMLEstrito } from '../_shared/operacoes/ml-status.ts';
import {
  depsBanco, executarReposicao, reativarPausaAutomatica, type DepsReposicao,
} from '../_shared/kit-variacao/reposicao.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function deps(admin: SupabaseClient, orgId: string, kitId: string): DepsReposicao {
  let token: Promise<string> | null = null;
  const getToken = () => token ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx) throw new Error('org sem conexão com o Mercado Livre');
    return await getValidAccessTokenConexao(cx);
  })();

  return {
    ...depsBanco(admin, orgId, kitId),
    enfileirarSaga: (id) => enfileirarSaga(id, orgId),
    avisar: async (texto, chave) => { await notificarCategoria(admin, orgId, 'estoque', texto, { chave }); },
    reativar: (codigo, itemId) => reativarPausaAutomatica(admin, {
      orgId, codigo, itemId,
      lerStatus: async (id) => lerStatusMLEstrito(await getToken(), id),
      // PUT só neste item, sem a propagação do conector aos relacionados (cópia de catálogo pausada à mão fica).
      putAtivo: async (id) => {
        try {
          await atualizarStatusML(await getToken(), id, 'active');
          return { ok: true };
        } catch (e) {
          return { ok: false, erro: { status: (e as { status?: number }).status } };
        }
      },
      alertar: (texto) => notificarCategoria(admin, orgId, 'estoque', texto),
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: KitReposicaoJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }
  if (!job?.org_id || !job.kit_id) return new Response('Body inválido', { status: 400, headers: corsHeaders });

  try {
    const admin = adminClient();
    const r = await executarReposicao(deps(admin, job.org_id, job.kit_id), job.kit_id);
    return json(r.retentar ? 500 : 200, r);
  } catch (e) {
    console.error(`kit-reposicao ${job.kit_id}: ${(e as Error).message}`);
    return json(500, { erro: (e as Error).message });
  }
});
