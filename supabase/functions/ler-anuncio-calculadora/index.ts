import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { lerSalePriceML } from '../_shared/ml/sale-price.ts';
import { lerAnuncioCalculadora, lerCategoriaNome, lerItem } from './processar.ts';

// Somente leitura, sem cache: preço vivo/modalidade/categoria do anúncio de uma variação (calculadora).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const body = await req.json().catch(() => null);
  const admin = adminClient();
  const r = await lerAnuncioCalculadora({
    db: admin,
    obterToken: async () => {
      const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
      if (!conexao) return null;
      try { return await getValidAccessTokenConexao(conexao); }
      catch (e) { console.warn('ler-anuncio-calculadora: token ML indisponível:', (e as Error).message); return null; }
    },
    lerItem,
    lerSalePrice: lerSalePriceML,
    lerCategoriaNome,
  }, orgId, body && typeof body === 'object' ? body : {});

  if (r.status !== 200) return new Response(null, { status: r.status, headers: corsHeaders });
  return new Response(JSON.stringify(r.body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
