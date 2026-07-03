// Responde a pergunta no ML (ADR-0037). Chamada pelo frontend (JWT). Texto vem do operador
// (podendo ter sido sugerido por IA) — revisão humana sempre.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { userIdCredencialOperacaoML } from '../_shared/ml/operacao.ts';
import { buscarPergunta, responderAnswer, upsertPergunta, buscarTituloItem } from '../_shared/faturamento/perguntas-io.ts';

interface Body { question_id?: number; text?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: só membro autenticado da operação (a conta ML usada é a da operação).
  try { await requireUser(req); }
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
  // Conexão ML da operação, não a do chamador (ADR-0056): qualquer membro responde pela conta da operação.
  const ownerUserId = await userIdCredencialOperacaoML(admin);
  if (!ownerUserId) {
    return new Response(JSON.stringify({ ok: false, erro: 'Conta ML não conectada.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  let token: string;
  try { token = await getValidAccessToken(ownerUserId); }
  catch { return new Response(JSON.stringify({ ok: false, erro: 'Conta ML não conectada.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  try {
    await responderAnswer(token, body.question_id, text);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: (e as Error).message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Re-busca a pergunta (agora respondida) e atualiza a tabela.
  const atualizada = await buscarPergunta(token, String(body.question_id));
  if (atualizada) {
    const titulo = await buscarTituloItem(token, atualizada.item_id ?? null);
    await upsertPergunta(admin, ownerUserId, atualizada, titulo);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
