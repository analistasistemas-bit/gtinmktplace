import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarPublicacao } from '../_shared/queue.ts';

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
  const { data: alvo, error } = await admin
    .from('familias')
    .update({ status: 'publicando' })
    .in('id', familia_ids)
    .eq('user_id', user.id)
    .eq('operacao', 'CREATE')
    .eq('status', 'pronto')
    .is('ml_item_id', null)
    .select('id, lote_id');
  if (error) return new Response(`Erro no claim: ${error.message}`, { status: 500, headers: corsHeaders });

  let enfileiradas = 0;
  for (const f of alvo ?? []) {
    const messageId = await enfileirarPublicacao({ familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType });
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    enfileiradas++;
  }
  if (alvo && alvo[0]) {
    await admin.from('lotes').update({ status: 'publicando' }).eq('id', alvo[0].lote_id);
  }

  return new Response(JSON.stringify({ enfileiradas }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
