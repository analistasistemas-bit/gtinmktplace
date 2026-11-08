// ADR-0197 (Task 14): worker QStash da reposição automática de um kit ("Vender só em kit"). Casca fina: liga
// `executarReposicao` no banco (decisões versionadas), no ML (reativar a pausa da automação) e no Telegram.
// Disparado em lote por kit (`enfileirarReposicao`) depois de venda, fim de transferência (entrada, ajuste,
// estorno, cancelamento) e desligar a opção. 500 = algo ficou para depois; o QStash repete.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarSaga, verificarAssinatura, type KitReposicaoJob } from '../_shared/queue.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { lerStatusMLEstrito } from '../_shared/operacoes/ml-status.ts';
import {
  lerPoliticas, MSG_KIT_MODERADO, podeReativar, prepararStatusOperador,
} from '../_shared/kit-variacao/politica.ts';
import { depsBanco, executarReposicao, type DepsReposicao } from '../_shared/kit-variacao/reposicao.ts';
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
  const conn = getConnector('mercado_livre');
  const alertar = (texto: string) => notificarCategoria(admin, orgId, 'estoque', texto);

  return {
    ...depsBanco(admin, orgId, kitId),
    enfileirarSaga: (id) => enfileirarSaga(id, orgId),
    avisar: async (texto, chave) => { await notificarCategoria(admin, orgId, 'estoque', texto, { chave }); },
    // Mesmo caminho da reativação do operador (exclusão `ativacao`, CAS da versão, confirmação por leitura), mas
    // como automação: pausa do operador, moderação e retirada nunca são desfeitas.
    async reativar(codigo, itemId) {
      const politica = (await lerPoliticas(admin, orgId, [codigo])).get(codigo) ?? null;
      if (!podeReativar({ politica, origem: 'automatico' }).pode) return politica?.estado === 'guardado' ? 'manter' : 'abandonar';
      const prep = await prepararStatusOperador(admin, {
        orgId, mlItemId: itemId, alvo: 'ativo', ligado: true, automatico: true,
        lerStatus: async (id) => lerStatusMLEstrito(await getToken(), id),
        alertar,
      });
      if ('recusa' in prep) return prep.recusa === MSG_KIT_MODERADO ? 'abandonar' : 'manter';
      let r: Awaited<ReturnType<typeof conn.atualizarStatus>> = { ok: false };   // exceção = ambíguo
      let confirmado = false;
      try {
        r = await conn.atualizarStatus({ getToken }, itemId, 'ativo');
      } finally {
        confirmado = await prep.concluir(r);
      }
      if (r.ok) return confirmado ? 'reativado' : 'manter';
      const st = r.erro?.status;
      if (st !== undefined && st >= 400 && st < 500 && st !== 408 && st !== 429) {
        // Recusa definitiva do ML: repetir não muda nada; o operador decide.
        await alertar(`Kit com variação: o Mercado Livre recusou reativar ${itemId} (${codigo}), pausado pela reposição. `
          + 'Confira o anúncio e reative em Publicados.').catch((e) => console.error('kit_reposicao_alerta_falhou', String(e)));
        return 'abandonar';
      }
      return 'manter';
    },
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
