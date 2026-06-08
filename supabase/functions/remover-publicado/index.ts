import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { pathsDaFamilia } from '../_shared/lote/exclusao.ts';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_id } = await req.json().catch(() => ({}));
  if (!familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const { data: familia } = await admin.from('familias')
    .select('id, user_id, lote_id, codigo_pai, ml_item_id, capa_storage_path, capa2_storage_path, variacoes(imagem_path)')
    .eq('id', familia_id).maybeSingle();
  if (!familia || familia.user_id !== user.id) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
  // Invariante ADR-0019: este escape hatch só remove famílias PUBLICADAS.
  if (!familia.ml_item_id) {
    return new Response(JSON.stringify({ erro: 'Família não publicada — nada a remover aqui.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Guarda: bloqueia se há família com o mesmo codigo_pai em 'publicando' (UPDATE em voo depende do ml_item_id)
  const { data: emVoo } = await admin.from('familias')
    .select('id').eq('user_id', user.id).eq('codigo_pai', familia.codigo_pai).eq('status', 'publicando').limit(1);
  if (emVoo && emVoo.length > 0) {
    return new Response(JSON.stringify({ erro: 'Há uma publicação em andamento para este código. Aguarde terminar antes de remover.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const paths = pathsDaFamilia({
    capa_storage_path: familia.capa_storage_path,
    capa2_storage_path: familia.capa2_storage_path,
    variacoes: familia.variacoes ?? [],
  });
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('remover-publicado storage falhou (segue):', error.message);
  }

  const loteId = familia.lote_id;
  await admin.from('familias').delete().eq('id', familia_id);

  // Remover 1 anúncio não "conclui" o lote → setConcluido=false.
  const loteRemovido = await recontarOuRemoverLote(admin, loteId, false);

  return new Response(JSON.stringify({ ok: true, lote_removido: loteRemovido }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
