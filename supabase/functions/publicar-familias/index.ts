import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarPublicacao, enfileirarAtualizacao, enfileirarSplit, garantirFilaSerial } from '../_shared/queue.ts';
import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: só membro autenticado da operação (ADR-0047/0056).
  try { await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_ids, listing_type_id } = await req.json().catch(() => ({}));
  if (!Array.isArray(familia_ids) || familia_ids.length === 0) {
    return new Response('familia_ids obrigatório', { status: 400, headers: corsHeaders });
  }
  // Clássico (default) ou Premium; ignora qualquer outro valor.
  const listingType = listing_type_id === 'gold_pro' ? 'gold_pro' : 'gold_special';

  const admin = adminClient();

  // Claim CREATE: 'pronto'/'erro', ainda não publicado. Escopo da operação (sem filtro por
  // user.id): qualquer membro publica as famílias selecionadas (ADR-0047/0056).
  const { data: novos, error: errC } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('operacao', 'CREATE')
    .in('status', ['pronto', 'erro'])
    .is('ml_item_id', null)
    .select('id, lote_id, user_id');
  if (errC) return new Response(`Erro no claim CREATE: ${errC.message}`, { status: 500, headers: corsHeaders });

  // Claim UPDATE: 'pronto'/'erro', já publicado (tem ml_item_id herdado).
  const { data: updates, error: errU } = await admin
    .from('familias')
    .update({ status: 'publicando', erro_mensagem: null })
    .in('id', familia_ids)
    .eq('operacao', 'UPDATE')
    .in('status', ['pronto', 'erro'])
    .not('ml_item_id', 'is', null)
    .select('id, lote_id, user_id');
  if (errU) return new Response(`Erro no claim UPDATE: ${errU.message}`, { status: 500, headers: corsHeaders });

  // Serializa as escritas no ML por CONTA de vendedor (ADR-0034): parallelism=1 evita
  // publicações concorrentes que tornam o processamento de foto do ML lento. A fila é keyed
  // pelo dono da família (familias.user_id = conta ML da operação, ADR-0056) — o mesmo id que
  // o worker usa para resolver o token —, não pelo chamador. Publica uma de cada vez.
  const donos = [...new Set([...(novos ?? []), ...(updates ?? [])].map((f) => f.user_id as string))];
  for (const dono of donos) {
    await garantirFilaSerial(dono);
  }

  // Split (ADR-0048): família com >100 cores incluídas vai para o worker de split (N anúncios),
  // tanto no CREATE quanto no UPDATE. ≤100 segue o caminho normal (publish/update), intocado.
  const idsParaEnfileirar = [...(novos ?? []), ...(updates ?? [])].map((f) => f.id);
  const coresPorFamilia = new Map<string, number>();
  if (idsParaEnfileirar.length > 0) {
    const { data: vrs } = await admin.from('variacoes')
      .select('familia_id').in('familia_id', idsParaEnfileirar).eq('excluida_da_publicacao', false);
    for (const v of vrs ?? []) coresPorFamilia.set(v.familia_id, (coresPorFamilia.get(v.familia_id) ?? 0) + 1);
  }
  const ehSplit = (familiaId: string) => (coresPorFamilia.get(familiaId) ?? 0) > MAX_VARIACOES_ML;

  let enfileiradas = 0;
  let loteId: string | null = null;
  for (const f of novos ?? []) {
    const job = { familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType };
    const messageId = ehSplit(f.id)
      ? await enfileirarSplit(job, f.user_id as string)
      : await enfileirarPublicacao(job, f.user_id as string);
    await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    loteId = f.lote_id;
    enfileiradas++;
  }
  for (const f of updates ?? []) {
    const messageId = ehSplit(f.id)
      ? await enfileirarSplit({ familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType }, f.user_id as string)
      : await enfileirarAtualizacao({ familia_id: f.id, lote_id: f.lote_id }, f.user_id as string);
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
