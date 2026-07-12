// Responde a pergunta no ML (ADR-0037). Chamada pelo frontend (JWT). Texto vem do operador
// (podendo ter sido sugerido por IA) — revisão humana sempre.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { buscarPergunta, responderAnswer, upsertPergunta, buscarTituloItem } from '../_shared/faturamento/perguntas-io.ts';

interface Body { question_id?: number; text?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: só membro autenticado da operação (a conta ML usada é a da própria org).
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const text = (body.text ?? '').trim();
  if (!body.question_id || !text) {
    return new Response(JSON.stringify({ ok: false, erro: 'question_id e text obrigatórios' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (text.length > 2000) {
    return new Response(JSON.stringify({ ok: false, erro: 'Resposta excede 2000 caracteres.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = adminClient();
  // Conexão ML da org (E7), não a do chamador: qualquer membro responde pela conta da organização.
  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao) {
    return new Response(JSON.stringify({ ok: false, erro: 'Conta ML não conectada.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // ml_perguntas.user_id é a mesma chave usada pelo sync-pergunta (resolverIdentidade → criado_por
  // da conexão) — preciso bater com o onConflict 'user_id,question_id' para não duplicar linha.
  const donoPergunta = (cxRow?.criado_por as string | null) ?? null;
  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return new Response(JSON.stringify({ ok: false, erro: 'Conta ML não conectada.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  try {
    await responderAnswer(token, body.question_id, text);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: (e as Error).message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Re-busca a pergunta (agora respondida) e atualiza a tabela. Best-effort: a resposta já foi
  // enviada ao ML acima (linha ~52); buscarPergunta agora LANÇA em erro HTTP (ADR-0069) — qualquer
  // falha aqui é só cache local desatualizado, não pode virar erro pro comprador/operador.
  try {
    const atualizada = await buscarPergunta(token, String(body.question_id));
    if (donoPergunta) {
      const titulo = await buscarTituloItem(token, atualizada.item_id ?? null);
      await upsertPergunta(admin, donoPergunta, orgId, atualizada, titulo);
    }
  } catch { /* re-fetch de cache é best-effort; a resposta ao comprador já foi enviada com sucesso. */ }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
