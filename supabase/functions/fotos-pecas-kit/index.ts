// ADR-0200 (adendo 12/11): proposta de galeria com as fotos das peças da combinação, para a prévia da etapa 2 do Criar kit e
// do Gerenciar kit. SÓ leitura: nada é gravado, nem no banco nem no ML. Os itens das peças saem dos vínculos da org (nunca
// do corpo). Falha de conexão ou de leitura não é erro da tela: volta 200 com a combinação "indisponível".
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { galeriaDasPecas, lerLimiteFotos } from '../_shared/kit-variacao/galeria-leitura.ts';
import { propostaDeGalerias, type CombinacaoPedida } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'kit_variacao'))) {
    return json({ error: 'Kit com variação não habilitado para esta organização.' }, 403);
  }

  let familiaBaseId: unknown; let bruto: unknown;
  try { ({ familia_base_id: familiaBaseId, combinacoes: bruto } = await req.json()); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof familiaBaseId !== 'string' || !familiaBaseId || !Array.isArray(bruto)) return json({ error: 'familia_base_id e combinacoes são obrigatórios.' }, 400);
  const combinacoes: CombinacaoPedida[] = bruto.slice(0, 60).flatMap((c: { rotulo?: unknown; cores?: unknown }) =>
    typeof c?.rotulo === 'string' && Array.isArray(c.cores) ? [{ rotulo: c.rotulo, cores: c.cores.map(String) }] : []);

  // Mesma leitura de criar-kit-variacao (lerBase): variações vivas da base e o vínculo ML de cada SKU, só da org.
  const { data: familia, error: errF } = await admin.from('familias')
    .select('codigo_pai, categoria_ml_id, variacoes(codigo, cor, excluida_da_publicacao)')
    .eq('id', familiaBaseId).eq('org_id', orgId).maybeSingle();
  if (errF) return json({ error: 'Falha ao carregar a família base.' }, 500);
  if (!familia) return json({ error: 'Família base não encontrada.' }, 404);
  const variacoes = ((familia.variacoes ?? []) as Array<{ codigo: string; cor: string | null; excluida_da_publicacao: boolean | null }>)
    .filter((v) => !v.excluida_da_publicacao && v.cor).map((v) => ({ codigo: v.codigo, cor: String(v.cor).trim() }));
  const { data: vinculos, error: errV } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id, anuncios_externos!inner(codigo_pai)')
    .eq('org_id', orgId).eq('anuncios_externos.codigo_pai', familia.codigo_pai as string).eq('retirado', false)
    .in('sku', variacoes.map((v) => v.codigo));
  if (errV) return json({ error: 'Falha ao carregar os anúncios das peças.' }, 500);

  const indisponivel = (aviso: string) => Object.fromEntries(combinacoes.map((c) => [c.rotulo, { fotos: [], avisos: [aviso], indisponivel: true }]));
  let token: string;
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return json({ galerias: indisponivel('Fotos das peças indisponíveis (sem conexão com o Mercado Livre).') });
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    console.warn('fotos_pecas_token_falhou', orgId, String(e));
    return json({ galerias: indisponivel('Fotos das peças indisponíveis (conexão com o Mercado Livre).') });
  }
  if (!familia.categoria_ml_id) return json({ galerias: indisponivel('Fotos das peças indisponíveis (base sem categoria).') });

  const galerias = await propostaDeGalerias({
    variacoes,
    vinculos: (vinculos ?? []).map((v) => ({ sku: v.sku as string, item_externo_id: v.item_externo_id as string | null })),
    categoriaId: familia.categoria_ml_id as string,
    lerLimite: (cat) => lerLimiteFotos(cat),
    galeria: (pecas, limite) => galeriaDasPecas(token, pecas, limite),
  }, combinacoes);
  return json({ galerias });
});
