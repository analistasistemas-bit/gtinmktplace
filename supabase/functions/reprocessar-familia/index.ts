import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarFamilias } from '../_shared/queue.ts';

interface Body {
  familia_id?: string;
  lote_id?: string;
}

// Reprocessa famílias travadas em 'erro' (ADR-0030). Re-dispara o process-familia pelo
// mesmo caminho do app (enfileirarFamilia → QStash do projeto, assinatura válida); o claim
// atômico do worker exige status 'pendente', então resetamos antes de enfileirar. Idempotente:
// só age sobre famílias da org do chamador em 'erro' (guard no UPDATE), tolera duplo clique.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Gate de auth: membro autenticado da operação (ADR-0047/0056) + org (E7). O escopo
  // das famílias é a org do chamador, não o usuário individual.
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
    ({ orgId } = context = await requireUserOrg(req, { access: 'write' }));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400, headers: corsHeaders });
  }
  if (!body.familia_id && !body.lote_id) {
    return new Response('familia_id ou lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // Famílias-alvo: da org do chamador e em 'erro'. familia_id tem precedência sobre lote_id.
  let q = admin
    .from('familias')
    .select('id, lote_id')
    .eq('status', 'erro')
    .eq('org_id', orgId);
  q = body.familia_id ? q.eq('id', body.familia_id) : q.eq('lote_id', body.lote_id!);

  const { data: alvos, error: selErr } = await q;
  if (selErr) {
    await auditarOperacaoSuporte(admin, context, { type: body.familia_id ? 'familia' : 'lote', id: body.familia_id ?? body.lote_id! }, 'failed');
    return new Response(`Erro ao buscar famílias: ${selErr.message}`, { status: 500, headers: corsHeaders });
  }
  if (!alvos || alvos.length === 0) {
    await auditarOperacaoSuporte(admin, context, { type: body.familia_id ? 'familia' : 'lote', id: body.familia_id ?? body.lote_id! }, 'succeeded');
    return new Response(
      JSON.stringify({ reenviadas: 0 }),
      { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  const lotesAfetados = new Set<string>();
  let reenviadas = 0;

  // Guard idempotente por família primeiro (duplo clique → 0 linhas → pula), DEPOIS 1 batch
  // pro QStash — não 1 publish por família em loop (mesmo bug do lote #44 em ingest-lote:
  // estourava o burst rate limit do QStash com lotes grandes).
  const resetadas: { id: string; lote_id: string }[] = [];
  for (const f of alvos) {
    const { data: resetada, error: upErr } = await admin
      .from('familias')
      .update({ status: 'pendente', erro_mensagem: null })
      .eq('id', f.id)
      .eq('status', 'erro')
      .select('id')
      .maybeSingle();
    if (upErr || !resetada) continue;
    resetadas.push(f);
  }

  if (resetadas.length > 0) {
    try {
      const messageIds = await enfileirarFamilias(resetadas.map((f) => ({ familia_id: f.id, lote_id: f.lote_id })));
      for (const [i, f] of resetadas.entries()) {
        await admin.from('familias').update({ qstash_message_id: messageIds[i] }).eq('id', f.id);
        lotesAfetados.add(f.lote_id);
        reenviadas++;
      }
    } catch (e) {
      // Falha ao enfileirar o bloco: devolve TODAS ao estado de erro para não ficarem
      // 'pendente' órfãs (ninguém processaria), com a causa registrada.
      await admin
        .from('familias')
        .update({ status: 'erro', erro_mensagem: `Falha ao reenfileirar: ${(e as Error).message}` })
        .in('id', resetadas.map((f) => f.id));
    }
  }

  // Lote volta a 'processando'; o trigger update_lote_counters o devolve a 'revisao'
  // quando a última família terminar a IA.
  if (lotesAfetados.size > 0) {
    await admin
      .from('lotes')
      .update({ status: 'processando' })
      .in('id', [...lotesAfetados]);
  }

  await auditarOperacaoSuporte(admin, context, { type: body.familia_id ? 'familia' : 'lote', id: body.familia_id ?? body.lote_id! }, 'succeeded');

  return new Response(
    JSON.stringify({ reenviadas }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});
