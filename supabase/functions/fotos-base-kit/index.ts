// ADR-0204: proposta das fotos 2 a 7 do anúncio da base para o kit vinculado (prévia do Criar kit). SÓ leitura:
// nada é gravado, nem no banco nem no ML. A família sai só da org do usuário. Falha de conexão/leitura do ML não é
// erro da tela: volta 200 com `indisponivel:true`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { ehCategoriaMlValida } from '../_shared/categoria/schema.ts';
import { itemIdDaBase, propostaGaleriaBase } from '../_shared/kit-variacao/galeria-base.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;
  const admin = adminClient();
  // Mesmo gate do criar-kit-vinculado: a prévia só existe para quem pode criar o kit (ADR-0060).
  if (!context.isAdmin && context.support?.scope !== 'full') {
    return json({ error: 'Somente administradores podem ver a prévia da galeria' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { familia_base_id?: unknown; categoria_ml_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof body.familia_base_id !== 'string' || !body.familia_base_id) return json({ error: 'familia_base_id é obrigatório.' }, 400);
  if (body.categoria_ml_id != null && (typeof body.categoria_ml_id !== 'string' || !ehCategoriaMlValida(body.categoria_ml_id))) {
    return json({ error: 'categoria_ml_id inválido (formato esperado: MLB seguido de dígitos).' }, 400);
  }

  const { data: familia, error } = await admin.from('familias')
    .select('id, ml_item_id, categoria_ml_id').eq('id', body.familia_base_id).eq('org_id', orgId).maybeSingle();
  if (error) return json({ error: 'Falha ao carregar a família base.' }, 500);
  if (!familia) return json({ error: 'Família base não encontrada.' }, 404);

  const itemIdBase = itemIdDaBase(familia as { ml_item_id: string | null });
  const categoriaKitId = (body.categoria_ml_id as string | undefined) ?? (familia.categoria_ml_id as string | null);
  const vazio = (aviso: string) => json({ fotos: [], avisos: [aviso], indisponivel: true, limite: null });
  if (!itemIdBase) return json(await propostaGaleriaBase({ token: '', itemIdBase: null, categoriaKitId }));

  let token: string;
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return vazio('Fotos da base indisponíveis (sem conexão com o Mercado Livre).');
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    console.warn('fotos_base_token_falhou', orgId, String(e));
    return vazio('Fotos da base indisponíveis (conexão com o Mercado Livre).');
  }
  return json(await propostaGaleriaBase({ token, itemIdBase, categoriaKitId }));
});
