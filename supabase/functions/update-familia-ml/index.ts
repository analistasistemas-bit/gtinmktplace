import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarItemML, atualizarItemML } from '../_shared/ml/atualizar-item.ts';
import { montarVariacoesUpdate } from '../_shared/ml/atualizar.ts';

interface Job { familia_id: string; lote_id: string; }

// Idêntico ao publish-familia-ml: reavalia o status do lote quando o worker some da fila.
async function talvezFinalizarLote(admin: ReturnType<typeof adminClient>, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const admin = adminClient();
  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });

  try {
    if (!familia.ml_item_id) throw new Error('Família UPDATE sem ml_item_id herdado (400)');

    // Estoques desejados: cores incluídas que casaram com o anúncio (têm ml_variation_id).
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, estoque, ml_variation_id')
      .eq('familia_id', job.familia_id)
      .eq('excluida_da_publicacao', false)
      .not('ml_variation_id', 'is', null);
    if (!variacoes || variacoes.length === 0) throw new Error('Nenhuma cor casada para atualizar (400)');

    const token = await getValidAccessToken(familia.user_id);

    // GET estado real → garante reenviar todas as variações (ML deleta as omitidas).
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = variacoes.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const variations = montarVariacoesUpdate(atual.variations, desejados);

    await atualizarItemML(token, familia.ml_item_id, variations);

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && status >= 500) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
