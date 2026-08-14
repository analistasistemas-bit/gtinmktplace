// Re-enfileira vincular-catalogo para família publicada com catálogo retentável (ADR-0021).
// Retry manual imediato (delay 60s) — não reseta catalog_status; o worker relê elegibilidade.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { familiaTemCatalogoRetentavel } from '../_shared/ml/catalogo-retentavel.ts';

interface Body { familia_id?: string; }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function carregarItensUpRetentaveis(
  admin: ReturnType<typeof adminClient>,
  orgId: string,
  codigoPai: string,
): Promise<Array<{ catalog_status: string | null; catalog_listing_id: string | null; item_externo_id: string | null }>> {
  const { data: raizes, error: errRaizes } = await admin.from('anuncios_externos')
    .select('id')
    .eq('org_id', orgId)
    .eq('codigo_pai', codigoPai)
    .eq('canal', 'mercado_livre')
    .eq('particao', 0);
  if (errRaizes) throw new Error(`Erro ao buscar anúncios externos: ${errRaizes.message}`);
  const rootIds = (raizes ?? []).map((r: { id: string }) => r.id);
  if (rootIds.length === 0) return [];

  const { data: itens, error: errItens } = await admin.from('anuncios_externos_itens')
    .select('item_externo_id, catalog_listing_id, catalog_status')
    .in('anuncio_externo_id', rootIds)
    .eq('retirado', false);
  if (errItens) throw new Error(`Erro ao buscar itens UP: ${errItens.message}`);
  return (itens ?? []) as Array<{ catalog_status: string | null; catalog_listing_id: string | null; item_externo_id: string | null }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let orgId: string;
  try {
    ({ orgId } = await requireUserOrg(req, { access: 'write' }));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ erro: 'JSON inválido' }, 400);
  }
  const familiaId = body.familia_id?.trim();
  if (!familiaId) return json({ erro: 'familia_id obrigatório' }, 400);

  const admin = adminClient();

  const { data: familia, error: famErr } = await admin
    .from('familias')
    .select('id, ml_item_id, status, codigo_pai, org_id')
    .eq('id', familiaId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (famErr) return json({ erro: `Erro ao buscar família: ${famErr.message}` }, 500);
  if (!familia) return json({ erro: 'Família não encontrada.' }, 404);

  if (!familia.ml_item_id) {
    return json({ erro: 'Família sem anúncio publicado no Mercado Livre.' }, 409);
  }
  if (familia.status !== 'publicado') {
    return json({ erro: 'Só famílias publicadas podem retentar o vínculo de catálogo.' }, 409);
  }

  const { data: variacoes, error: varErr } = await admin
    .from('variacoes')
    .select('catalog_status, catalog_listing_id, ml_variation_id')
    .eq('familia_id', familiaId);
  if (varErr) return json({ erro: `Erro ao buscar variações: ${varErr.message}` }, 500);

  let itensUp: Awaited<ReturnType<typeof carregarItensUpRetentaveis>> = [];
  try {
    itensUp = await carregarItensUpRetentaveis(admin, orgId, familia.codigo_pai);
  } catch (e) {
    return json({ erro: (e as Error).message }, 500);
  }

  if (!familiaTemCatalogoRetentavel(variacoes ?? [], itensUp)) {
    return json({ erro: 'Nenhuma variação ou item com catálogo retentável (erro ou não elegível, sem vínculo).' }, 409);
  }

  try {
    await enfileirarVinculacaoCatalogo(familiaId, 60, 1, 5);
  } catch (e) {
    return json({ erro: `Falha ao enfileirar: ${(e as Error).message}` }, 500);
  }

  return json({ enfileirado: true });
});
