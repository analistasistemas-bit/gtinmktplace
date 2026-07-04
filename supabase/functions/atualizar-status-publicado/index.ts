import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { userIdCredencialOperacaoML } from '../_shared/ml/operacao.ts';
import { getConnector } from '../_shared/canais/registry.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só admin (ADR-0060) — diferente das demais ações de escrita (só requireUser),
  // pausar/reativar tem efeito imediato na visibilidade do anúncio pros compradores.
  try { await requireAdmin(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { ml_item_id, status } = await req.json().catch(() => ({}));
  if (!ml_item_id || (status !== 'ativo' && status !== 'pausado')) {
    return new Response('ml_item_id e status (ativo|pausado) obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // Token da conexão ML da operação, não a do chamador (ADR-0056), igual status-publicados.
  const operacaoUserId = await userIdCredencialOperacaoML(admin);
  if (!operacaoUserId) {
    return new Response(JSON.stringify({ erro: 'Conecte sua conta ML nas Configurações.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessToken(operacaoUserId) };
  const resultado = await conn.atualizarStatus(ctx, ml_item_id, status);
  if (!resultado.ok) {
    return new Response(
      JSON.stringify({ erro: resultado.erro?.mensagemOperador ?? 'Falha ao atualizar status no Mercado Livre.' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
