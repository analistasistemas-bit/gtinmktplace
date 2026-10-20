// ADR-0186/0188: casca fina (molde sincronizar-fiscal-ml). Valida a assinatura do QStash e delega o
// miolo, que vive em processar.ts com dependências injetadas para ser testável.
// Enfileirado pelo "Editar marca" (atualizar-marca-familia) com { org_id, codigo_pai, versao }.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarSincronizacaoMarca, verificarAssinatura } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
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
  const raizQ = () => admin.from('anuncios_externos').select('id, marca_sync_versao')
    .eq('org_id', job.org_id).eq('codigo_pai', job.codigo_pai).eq('canal', 'mercado_livre').eq('particao', 0);
  const conexao = await resolverConexao(admin, job.org_id, 'mercado_livre');
  if (!conexao) {
    // Status durável também aqui: sem conexão não há o que retentar.
    const { data: raiz } = await raizQ().maybeSingle();
    if (raiz && (job.versao == null || job.versao === raiz.marca_sync_versao)) {
      await admin.from('anuncios_externos')
        .update({ marca_sync_status: 'erro', marca_sync_erro: 'Organização sem conexão com o Mercado Livre.', marca_sync_em: new Date().toISOString() })
        .eq('org_id', job.org_id).eq('codigo_pai', job.codigo_pai).eq('canal', 'mercado_livre');
    }
    return new Response('Organização sem conexão com o Mercado Livre', { status: 400, headers: corsHeaders });
  }
  const token = () => getValidAccessTokenConexao(conexao);

  const r = await processarSincronizacaoMarca({
    lerEstado: async (orgId, codigoPai) => {
      const { data: raiz, error } = await raizQ().maybeSingle();
      if (error) throw new Error(`raiz: ${error.message}`);
      if (!raiz) return null;
      // Família vigente: a última publicada (edges usam publicado_em desc — ver canônica × última).
      const { data: fam, error: fErr } = await admin.from('familias').select('marca')
        .eq('org_id', orgId).eq('codigo_pai', codigoPai)
        .order('publicado_em', { ascending: false, nullsFirst: false }).order('criado_em', { ascending: false })
        .limit(1).maybeSingle();
      if (fErr) throw new Error(`família: ${fErr.message}`);
      return { raizId: raiz.id as string, versao: raiz.marca_sync_versao as number, marca: (fam?.marca as string | null) ?? null };
    },
    adquirirLease: async (raizId, ttl) => {
      const { data, error } = await admin.rpc('adquirir_lease_marca', { p_raiz: raizId, p_ttl_s: ttl });
      if (error) throw new Error(`lease: ${error.message}`);
      return data === true;
    },
    liberarLease: async (raizId) => {
      const { error } = await admin.rpc('liberar_lease_marca', { p_raiz: raizId });
      if (error) throw new Error(`liberar lease: ${error.message}`);
    },
    versaoAtual: async (raizId) => {
      const { data, error } = await admin.from('anuncios_externos').select('marca_sync_versao').eq('id', raizId).single();
      if (error) throw new Error(`versão: ${error.message}`);
      return data.marca_sync_versao as number;
    },
    gravarStatus: async (raizId, versao, status, erro) => {
      const patch = { marca_sync_status: status, marca_sync_erro: erro ?? null, marca_sync_em: new Date().toISOString() };
      // Condicional na raiz: job de versão antiga não toca o status de uma edição nova.
      const { data: raiz, error } = await admin.from('anuncios_externos').update(patch)
        .eq('id', raizId).eq('marca_sync_versao', versao).select('org_id, codigo_pai').maybeSingle();
      if (error) throw new Error(`status: ${error.message}`);
      if (!raiz) return;
      await admin.from('anuncios_externos').update(patch)
        .eq('org_id', raiz.org_id).eq('codigo_pai', raiz.codigo_pai).eq('canal', 'mercado_livre').neq('id', raizId);
    },
    reagendar: async (proximo, delay) => { await enfileirarSincronizacaoMarca(proximo, delay); },
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
      gravarFamilyIdLocal: async (orgId, itemIds, familyId) => {
        const { error } = await admin.from('anuncios_externos_itens').update({ family_id: familyId })
          .eq('org_id', orgId).in('item_externo_id', itemIds).eq('retirado', false);
        if (error) throw new Error(`family_id local: ${error.message}`);
      },
      putAtributos: async (itemId, attrs) => {
        await chamarML(await token(), `/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ attributes: attrs }) });
      },
    },
  }, job).catch((e) => ({ status: 500, body: { erro: (e as Error).message } }));

  console.info(`sincronizar-marca-ml ${job.codigo_pai}:`, JSON.stringify(r.body));
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
