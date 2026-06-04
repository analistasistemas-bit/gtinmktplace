import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarPublicacao, enfileirarAtualizacao } from '../_shared/queue.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_ids, listing_type_id } = await req.json().catch(() => ({}));
  if (!Array.isArray(familia_ids) || familia_ids.length === 0) {
    return new Response('familia_ids obrigatório', { status: 400, headers: corsHeaders });
  }
  // Clássico (default) ou Premium; ignora qualquer outro valor.
  const listingType = listing_type_id === 'gold_pro' ? 'gold_pro' : 'gold_special';

  const admin = adminClient();

  // Claim CREATE: 'pronto'/'erro', ainda não publicado.
  const { data: novos, error: errC } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'CREATE')
    .in('status', ['pronto', 'erro'])
    .is('ml_item_id', null)
    .select('id, lote_id');
  if (errC) return new Response(`Erro no claim CREATE: ${errC.message}`, { status: 500, headers: corsHeaders });

  // Claim UPDATE: 'pronto'/'erro', já publicado (tem ml_item_id herdado).
  const { data: updates, error: errU } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'UPDATE')
    .in('status', ['pronto', 'erro'])
    .not('ml_item_id', 'is', null)
    .select('id, lote_id');
  if (errU) return new Response(`Erro no claim UPDATE: ${errU.message}`, { status: 500, headers: corsHeaders });

  let enfileiradas = 0;
  let loteId: string | null = null;
  for (const f of novos ?? []) {
    const messageId = await enfileirarPublicacao({ familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    loteId = f.lote_id;
    enfileiradas++;
  }
  for (const f of updates ?? []) {
    const messageId = await enfileirarAtualizacao({ familia_id: f.id, lote_id: f.lote_id });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    loteId = f.lote_id;
    enfileiradas++;
  }
  if (loteId) {
    await admin.from('lotes').update({ status: 'publicando' }).eq('id', loteId);
  }

  return new Response(JSON.stringify({ enfileiradas }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
