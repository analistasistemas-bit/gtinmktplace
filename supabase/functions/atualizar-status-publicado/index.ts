import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só admin (ADR-0060) — diferente das demais ações de escrita (só requireUser),
  // pausar/reativar tem efeito imediato na visibilidade do anúncio pros compradores.
  let orgId: string;
  try {
    const r = await requireUserOrg(req);
    if (!r.isAdmin) throw new Response('Somente administradores podem executar esta ação', { status: 403 });
    orgId = r.orgId;
  }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { ml_item_id, status } = await req.json().catch(() => ({}));
  if (!ml_item_id || (status !== 'ativo' && status !== 'pausado')) {
    return new Response('ml_item_id e status (ativo|pausado) obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // Token da conexão ML da org (E7), não a do chamador, igual status-publicados.
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) {
    return new Response(JSON.stringify({ erro: 'Conecte sua conta ML nas Configurações.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
  const resultado = await conn.atualizarStatus(ctx, ml_item_id, status);
  if (!resultado.ok) {
    return new Response(
      JSON.stringify({ erro: resultado.erro?.mensagemOperador ?? 'Falha ao atualizar status no Mercado Livre.' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
