// Sugere uma resposta via IA (ADR-0037). Chamada pelo frontend (JWT). NÃO envia ao ML.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { sugerirResposta } from '../_shared/ai/resposta-pergunta.ts';

interface Body { pergunta?: string; item_titulo?: string | null; contexto?: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try { await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const pergunta = (body.pergunta ?? '').trim();
  if (!pergunta) {
    return new Response(JSON.stringify({ ok: false, erro: 'pergunta obrigatória' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const sugestao = await sugerirResposta({ pergunta, itemTitulo: body.item_titulo ?? null, contexto: body.contexto ?? null });
    return new Response(JSON.stringify({ ok: true, sugestao }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: (e as Error).message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
