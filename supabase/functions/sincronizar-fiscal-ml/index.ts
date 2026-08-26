// ADR-0135: casca fina. Valida a assinatura do QStash e delega o miolo,
// que vive em processar.ts com dependências injetadas para ser testável.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, type SincronizarFiscalJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { empurrarFiscalSku, lerCanInvoice, vincularSkuAnuncio } from '../_shared/canais/fiscal-ml.ts';
import { processarSincronizacaoFiscal } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: SincronizarFiscalJob;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const r = await processarSincronizacaoFiscal({
    admin: adminClient(),
    resolverConexao,
    getToken: (cx) => getValidAccessTokenConexao(cx as never),
    listarVariacoes: async (admin, familiaId) => {
      const { data } = await admin.from('variacoes')
        .select('codigo, gtin, peso_gramas, ml_variation_id')
        .eq('familia_id', familiaId).eq('excluida_da_publicacao', false);
      return data ?? [];
    },
    // C1: filhos User Products (ADR-0088) — partição 0, mesmo padrão de vincular-catalogo/vinculacao.ts.
    listarItensUP: async (admin, orgId, codigoPai) => {
      const { data: raizes } = await admin.from('anuncios_externos')
        .select('id').eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('canal', 'mercado_livre').eq('particao', 0);
      const rootIds = (raizes ?? []).map((r: { id: string }) => r.id);
      if (rootIds.length === 0) return [];
      const { data: itens } = await admin.from('anuncios_externos_itens')
        .select('sku, item_externo_id').in('anuncio_externo_id', rootIds).eq('retirado', false);
      return itens ?? [];
    },
    portas: { empurrarFiscalSku, vincularSkuAnuncio, lerCanInvoice },
  }, job);
  return new Response(
    typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
