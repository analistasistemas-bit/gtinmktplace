import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { montarTabelaFrete } from '../_shared/ml/tabela-frete.ts';

const CACHE_TTL_S = 24 * 60 * 60; // 24h

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { categoria_ml_id } = await req.json().catch(() => ({}));
  if (typeof categoria_ml_id !== 'string' || !categoria_ml_id) {
    return new Response('categoria_ml_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = adminClient();
  const [conexao, mc] = await Promise.all([
    resolverConexao(admin, orgId, 'mercado_livre'),
    admin.from('marketplace_connections').select('me2_habilitado')
      .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle(),
  ]);

  if (mc.data?.me2_habilitado === false) {
    return json({ indisponivel: true, motivo: 'sem_me2' });
  }
  if (!conexao) return json({ erro: true });

  const cacheKey = `tabela-frete:v1:${orgId}:${categoria_ml_id}`;

  try {
    const cached = await redisGet(cacheKey);
    if (cached) return json(JSON.parse(cached));

    const token = await getValidAccessTokenConexao(conexao);
    const mlUserId = conexao.contaExternaId || 'me';
    const tabela = await montarTabelaFrete(token, mlUserId, categoria_ml_id);

    await redisSet(cacheKey, JSON.stringify(tabela), CACHE_TTL_S);
    return json(tabela);
  } catch (err) {
    console.error('tabela-frete-ml falhou:', err);
    return json({ erro: true });
  }
});
