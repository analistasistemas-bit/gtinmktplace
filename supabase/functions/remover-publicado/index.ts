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
  const { data: alvo } = await admin.from('familias')
    .select('id, user_id, codigo_pai, ml_item_id')
    .eq('id', familia_id).maybeSingle();
  if (!alvo || alvo.user_id !== user.id) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
  // Invariante ADR-0019: este escape hatch só remove famílias PUBLICADAS.
  if (!alvo.ml_item_id) {
    return new Response(JSON.stringify({ erro: 'Família não publicada — nada a remover aqui.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Guarda: bloqueia se há família do mesmo codigo_pai em 'publicando' (UPDATE em voo depende do ml_item_id).
  const { data: emVoo } = await admin.from('familias')
    .select('id').eq('user_id', user.id).eq('codigo_pai', alvo.codigo_pai).eq('status', 'publicando').limit(1);
  if (emVoo && emVoo.length > 0) {
    return new Response(JSON.stringify({ erro: 'Há uma publicação em andamento para este código. Aguarde terminar antes de remover.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Codex P2: o vínculo de UPDATE é GLOBAL por (user_id, codigo_pai, ml_item_id not null) —
  // o ingest-lote casa por codigo_pai. Após ciclos de UPDATE existem várias linhas publicadas
  // do mesmo codigo_pai (uma por lote). Remover só a selecionada deixaria outra satisfazendo a
  // busca → a próxima planilha ainda viraria UPDATE no anúncio morto. Removemos TODAS as linhas
  // publicadas do mesmo codigo_pai para realmente cortar o vínculo.
  const { data: familias } = await admin.from('familias')
    .select('id, lote_id, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path)')
    .eq('user_id', user.id).eq('codigo_pai', alvo.codigo_pai).not('ml_item_id', 'is', null);
  const alvos = familias ?? [];

  const paths = [...new Set(alvos.flatMap((f) => pathsDaFamilia({
    capa_storage_path: f.capa_storage_path,
    capa2_storage_path: f.capa2_storage_path,
    capa3_storage_path: f.capa3_storage_path,
    variacoes: f.variacoes ?? [],
  })))];
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('remover-publicado storage falhou (segue):', error.message);
  }

  const lotesAfetados = [...new Set(alvos.map((f) => f.lote_id))];
  await admin.from('familias').delete().in('id', alvos.map((f) => f.id));
  await admin.from('anuncios_externos')
    .delete()
    .eq('user_id', user.id)
    .eq('canal', 'mercado_livre')
    .eq('codigo_pai', alvo.codigo_pai);

  // Reconta (ou remove se vazio) cada lote afetado. Remover não "conclui" o lote → setConcluido=false.
  let lotesRemovidos = 0;
  for (const loteId of lotesAfetados) {
    if (await recontarOuRemoverLote(admin, loteId, false)) lotesRemovidos++;
  }

  return new Response(
    JSON.stringify({ ok: true, familias_removidas: alvos.length, lotes_removidos: lotesRemovidos }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
