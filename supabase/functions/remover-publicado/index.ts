import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Missing auth', { status: 401, headers: corsHeaders });
  const { data: { user } } = await userClient(auth.slice(7)).auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  const { familia_id } = await req.json().catch(() => ({}));
  if (!familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const { data: familia } = await admin.from('familias')
    .select('id, user_id, lote_id, codigo_pai, ml_item_id, capa_storage_path, capa2_storage_path, variacoes(imagem_path)')
    .eq('id', familia_id).maybeSingle();
  if (!familia || familia.user_id !== user.id) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });

  // Guarda: bloqueia se há família com o mesmo codigo_pai em 'publicando' (UPDATE em voo depende do ml_item_id)
  const { data: emVoo } = await admin.from('familias')
    .select('id').eq('user_id', user.id).eq('codigo_pai', familia.codigo_pai).eq('status', 'publicando').limit(1);
  if (emVoo && emVoo.length > 0) {
    return new Response(JSON.stringify({ erro: 'Há uma publicação em andamento para este código. Aguarde terminar antes de remover.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const paths = [
    familia.capa_storage_path, familia.capa2_storage_path,
    ...((familia.variacoes ?? []).map((v: { imagem_path: string | null }) => v.imagem_path)),
  ].filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('remover-publicado storage falhou (segue):', error.message);
  }

  const loteId = familia.lote_id;
  await admin.from('familias').delete().eq('id', familia_id);

  let loteRemovido = false;
  const { data: rest } = await admin.from('familias').select('status').eq('lote_id', loteId);
  if (!rest || rest.length === 0) {
    await admin.from('lotes').delete().eq('id', loteId);
    loteRemovido = true;
  } else {
    const publicadas = rest.filter((f) => f.status === 'publicado').length;
    const erros = rest.filter((f) => f.status === 'erro').length;
    await admin.from('lotes').update({ total_familias: rest.length, total_publicadas: publicadas, total_erros: erros }).eq('id', loteId);
  }

  return new Response(JSON.stringify({ ok: true, lote_removido: loteRemovido }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
