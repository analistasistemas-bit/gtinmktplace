// Análise PubliAI — seções 2/3/7 via pulse_vendedores + amostra Sonar (ADR-0142).
// POST { itens: ItemVendas[] } → payload contrato + meta. Só leitura.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { anunciosDaAmostra } from '../_shared/analise/amostra-sonar.ts';
import { carregarSeriePulseVendedores } from '../_shared/analise/carregar-serie-vendedores.ts';
import { montarSecoes237 } from '../_shared/analise/relatorio-secoes-237.ts';
import { resolverSellerIdsPorItem } from '../_shared/analise/resolver-seller-ids.ts';
import { normalizarSellerId } from '../_shared/pulse/vendas-mensais-vendedor.ts';
import type { ItemVendas } from '../_shared/pulse/sonar-vendas.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try {
    ({ orgId } = await requireUserOrg(req, { access: 'read' }));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  let body: { itens?: ItemVendas[] };
  try {
    body = await req.json();
  } catch {
    return json({ erro: 'JSON inválido' }, 400);
  }

  if (!Array.isArray(body.itens)) return json({ erro: 'itens obrigatório (array)' }, 400);

  const db = adminClient();
  const itemIds = body.itens
    .map((i) => i.item_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const sellerPorItem = await resolverSellerIdsPorItem(db, orgId, itemIds);
  const { anuncios, semSellerId } = anunciosDaAmostra(body.itens, sellerPorItem);

  const sellerIds = [
    ...new Set(anuncios.map((a) => Number(normalizarSellerId(a.seller_id)))),
  ].filter((id) => Number.isFinite(id));

  const serie = await carregarSeriePulseVendedores(db, orgId, sellerIds);
  const secoes237 = montarSecoes237(anuncios, serie, body.itens.length);

  const vendedoresDistintos = new Set(anuncios.map((a) => normalizarSellerId(a.seller_id))).size;

  return json({
    secoes237,
    meta: {
      vendedores_distintos: vendedoresDistintos,
      sem_seller_id: semSellerId,
      anuncios_na_amostra: body.itens.length,
      serie_linhas: serie.length,
    },
  });
});
