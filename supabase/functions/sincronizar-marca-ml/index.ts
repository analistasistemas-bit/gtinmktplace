// ADR-0186: casca fina (molde sincronizar-fiscal-ml). Valida a assinatura do QStash e delega o
// miolo, que vive em processar.ts com dependências injetadas para ser testável.
// Disparo manual (operação pontual): publicar no QStash { org_id, codigo_pai, dry_run? }.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerMarcaOrg } from '../_shared/categoria/marca-org.ts';
import { processarSincronizacaoMarca, type ItemLido, type SincronizarMarcaJob } from './processar.ts';

const ML = 'https://api.mercadolibre.com';

async function chamarML(token: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const resp = await fetch(`${ML}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok) {
    throw Object.assign(new Error(`HTTP ${resp.status} ${JSON.stringify(json).slice(0, 500)}`), { status: resp.status });
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: SincronizarMarcaJob;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }
  if (!job?.org_id || !job?.codigo_pai) return new Response('org_id e codigo_pai obrigatórios', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const conexao = await resolverConexao(admin, job.org_id, 'mercado_livre');
  if (!conexao) return new Response('Organização sem conexão com o Mercado Livre', { status: 400, headers: corsHeaders });
  const token = () => getValidAccessTokenConexao(conexao);

  const r = await processarSincronizacaoMarca({
    lerMarcaOrg: (orgId) => lerMarcaOrg(admin, orgId),
    portas: {
      listarFilhos: async (orgId, codigoPai) => {
        const { data, error } = await admin.from('anuncios_externos_itens')
          .select('sku, item_externo_id, anuncios_externos!inner(org_id, canal, codigo_pai)')
          .eq('anuncios_externos.org_id', orgId).eq('anuncios_externos.canal', 'mercado_livre')
          .eq('anuncios_externos.codigo_pai', codigoPai)
          .eq('retirado', false).not('item_externo_id', 'is', null)
          .order('sku');
        if (error) throw new Error(`listarFilhos: ${error.message}`);
        return (data ?? []).map((l) => ({ sku: l.sku as string, itemId: l.item_externo_id as string }));
      },
      lerItem: async (itemId): Promise<ItemLido> => {
        const j = await chamarML(await token(), `/items/${itemId}?attributes=id,status,family_id,attributes`);
        return {
          status: String(j.status ?? ''),
          familyId: j.family_id != null ? String(j.family_id) : null,
          attrs: (j.attributes as ItemLido['attrs'] | undefined) ?? [],
        };
      },
      putAtributos: async (itemId, attrs) => {
        await chamarML(await token(), `/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ attributes: attrs }) });
      },
    },
  }, job).catch((e) => ({ status: 500, body: { erro: (e as Error).message } }));

  console.info(`sincronizar-marca-ml ${job.codigo_pai}:`, JSON.stringify(r.body));
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
