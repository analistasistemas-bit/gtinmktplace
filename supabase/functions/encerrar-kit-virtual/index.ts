// ADR-0154 D-8: encerra um Kit Virtual (composição é imutável no ML — refazer é encerrar e
// recriar). Admin-only (ADR-0060), idempotente: kit já `closed` no ML responde sucesso.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarItemML, atualizarStatusML } from '../_shared/ml/atualizar-item.ts';
import { encerrarKitVirtual, type MotivoEncerrarKitVirtual } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<MotivoEncerrarKitVirtual, number> = {
  nao_encontrado: 404,
  falha_leitura: 500,
  ml_recusou: 502,
  falha_encerrar: 500,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;

  const admin = adminClient();

  // Gate admin (ADR-0060), mesmo padrão de criar-kit-vinculado/index.ts.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  let body: { kit_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof body.kit_id !== 'string' || !body.kit_id) return json({ error: 'kit_id é obrigatório.' }, 400);
  const kitId = body.kit_id;
  const target = { type: 'kit_virtual', id: kitId };

  // Token resolvido preguiçosamente: kit que nunca chegou ao ML (`publicando`/`erro` sem item)
  // encerra sem tocar na rede, e uma org com conexão quebrada ainda consegue limpar a linha.
  let tokenCache: Promise<string> | null = null;
  const getToken = () => {
    if (!tokenCache) {
      tokenCache = (async () => {
        const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
        if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
        return getValidAccessTokenConexao(conexao);
      })();
    }
    return tokenCache;
  };

  const resultado = await encerrarKitVirtual({
    admin,
    orgId,
    buscarItem: async (itemId) => buscarItemML(await getToken(), itemId),
    fecharItem: async (itemId) => atualizarStatusML(await getToken(), itemId, 'closed'),
  }, { kitId });

  if (!resultado.ok) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json(
      { error: resultado.mensagem ?? resultado.motivo, motivo: resultado.motivo },
      STATUS_POR_MOTIVO[resultado.motivo] ?? 400,
    );
  }

  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({ ok: true, kit_id: resultado.kitId, ja_encerrado: resultado.jaEncerrado });
});
