// Pulse (ADR-0119): adiciona manualmente um produto de catálogo ao radar. Item avulso de
// terceiro é impossível de coletar (403, ver Fatos empíricos do plano) — só link de catálogo
// (/p/MLBxxxx) ou GTIN.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { resolverEntrada } from '../_shared/pulse/entrada.ts';

const API = 'https://api.mercadolibre.com';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { entrada?: string };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const entrada = body.entrada?.trim() ?? '';
  if (!entrada) return json({ erro: 'Informe o link de catálogo ou o GTIN.' }, 400);

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ erro: 'Conecte o Mercado Livre antes de adicionar um produto ao Pulse.' }, 400);
  const token = await getValidAccessTokenConexao(conexao);

  const resolvida = resolverEntrada(entrada);
  let catalogProductId: string | null;
  if (resolvida.tipo === 'cpid') {
    catalogProductId = resolvida.valor;
  } else if (resolvida.tipo === 'gtin') {
    const busca = await mlGet(
      `${API}/products/search?status=active&site_id=MLB&product_identifier=${encodeURIComponent(resolvida.valor!)}`,
      token,
    );
    const results = (busca as { results?: Array<{ id?: string }> } | null)?.results;
    catalogProductId = results?.[0]?.id ?? null;
    if (!catalogProductId) return json({ erro: 'GTIN sem produto de catálogo no ML' }, 404);
  } else {
    return json({ erro: 'Informe o link de catálogo (…/p/MLBxxxx) ou um GTIN. Anúncio avulso de terceiro não é acessível pela API do ML.' }, 400);
  }

  const produto = await mlGet(`${API}/products/${catalogProductId}`, token);
  const titulo = (produto as { name?: string } | null)?.name ?? null;

  const { data, error } = await admin.from('pulse_produtos')
    .upsert(
      { org_id: orgId, catalog_product_id: catalogProductId, titulo, origem: 'manual', status: 'ativo' },
      { onConflict: 'org_id,catalog_product_id' },
    )
    .select('id').single();
  if (error) return json({ erro: error.message }, 400);

  return json({ produto_id: data.id });
});
