// ADR-0200 (adendos 08/11 e 11/11): preço avulso (normal, em promoção, fim da promoção e promoções futuras) das peças da base do kit com
// variação, lido do ML na hora com o token da org. SÓ leitura: nada é gravado, nem no banco nem no ML.
// Falha de conexão ou de leitura não é erro da tela: volta 200 com a peça sem preço ("indisponível").
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { criarClienteReajusteML } from '../_shared/operacoes/reajuste/ml.ts';
import { lerPrecosAvulsos, type GetML, type PrecoAvulso } from './processar.ts';

/** 5 s por chamada: uma leitura pendurada não segura a tela (mesma espera de lerSalePriceML). */
const getML = (token: string): GetML => async (path) => {
  const r = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) throw new Error(`ML ${r.status} em ${path.split('?')[0]}`);
  return r.json();
};

/** fetch das promoções: 5 s por chamada e uma repetição em 500/502/503 (/seller-promotions oscila; o 409 a leitura
 *  do reajuste já repete). Só GET passa por aqui: `lerOfertas` não escreve. */
const fetchPromocoes: typeof fetch = async (url, init) => {
  const uma = () => fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
  const r = await uma();
  return [500, 502, 503].includes(r.status) ? uma() : r;
};

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

  let familiaBaseId: unknown;
  try { ({ familia_base_id: familiaBaseId } = await req.json()); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof familiaBaseId !== 'string' || !familiaBaseId) return json({ error: 'familia_base_id é obrigatório.' }, 400);

  // Mesma leitura de criar-kit-variacao (lerBase): variações vivas da família pedida e o vínculo ML de cada SKU.
  const { data: familia, error: errF } = await admin.from('familias').select('codigo_pai, variacoes(codigo, excluida_da_publicacao)')
    .eq('id', familiaBaseId).eq('org_id', orgId).maybeSingle();
  if (errF) return json({ error: 'Falha ao carregar a família base.' }, 500);
  if (!familia) return json({ error: 'Família base não encontrada.' }, 404);
  const skus = ((familia.variacoes ?? []) as Array<{ codigo: string; excluida_da_publicacao: boolean | null }>)
    .filter((v) => !v.excluida_da_publicacao).map((v) => v.codigo);
  const { data: vinculos, error: errV } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id, anuncios_externos!inner(codigo_pai)')
    .eq('org_id', orgId).eq('anuncios_externos.codigo_pai', familia.codigo_pai as string).eq('retirado', false)
    .in('sku', skus);
  if (errV) return json({ error: 'Falha ao carregar os anúncios das peças.' }, 500);
  const itemDe = new Map((vinculos ?? []).map((v) => [v.sku as string, v.item_externo_id as string | null]));
  const pedidos = skus.map((sku) => ({ sku, item_id: itemDe.get(sku) ?? null }));

  const vazio = () => Object.fromEntries(skus.map((s) => [s, { normal: null, promocao: null, fim_promocao: null, futuras: [], futuras_indisponivel: true } as PrecoAvulso]));
  let token: string;
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return json({ pecas: vazio(), indisponivel: true });
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    console.warn('preco_avulso_token_falhou', orgId, String(e));
    return json({ pecas: vazio(), indisponivel: true });
  }
  const { lerOfertas } = criarClienteReajusteML(token, fetchPromocoes);
  const pecas = await lerPrecosAvulsos({ get: getML(token), lerOfertas, agora: Date.now() }, pedidos);
  return json({ pecas });
});
