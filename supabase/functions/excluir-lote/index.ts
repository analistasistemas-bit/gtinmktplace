import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { particionarExclusao, type FamiliaExclusao } from '../_shared/lote/exclusao.ts';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';

const BLOQUEADOS = ['processando', 'publicando'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id) return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const { data: lote } = await admin.from('lotes')
    .select('id, user_id, status, planilha_path, imagens_paths').eq('id', lote_id).maybeSingle();
  if (!lote || lote.user_id !== user.id) return new Response('Lote não encontrado', { status: 404, headers: corsHeaders });
  if (BLOQUEADOS.includes(lote.status)) {
    return new Response(JSON.stringify({ erro: 'Aguarde o processamento/publicação terminar antes de excluir.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id, capa_storage_path, capa2_storage_path, variacoes(imagem_path)')
    .eq('lote_id', lote_id);

  const part = particionarExclusao({
    familias: (familias ?? []) as FamiliaExclusao[],
    planilhaPath: lote.planilha_path, imagensPaths: lote.imagens_paths,
  });

  if (part.pathsRemover.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(part.pathsRemover);
    if (error) console.warn('excluir-lote storage remove falhou (segue):', error.message);
  }

  const ids = part.paraExcluir.map((f) => f.id);
  if (ids.length > 0) await admin.from('familias').delete().in('id', ids);

  // Reconta (ou remove se vazio) a partir do estado real do DB. Sobrou só publicada → concluido.
  const loteRemovido = await recontarOuRemoverLote(admin, lote_id, true);

  return new Response(JSON.stringify({
    familias_removidas: ids.length, imagens_removidas: part.pathsRemover.length,
    familias_preservadas: part.preservadas.length, lote_removido: loteRemovido,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
