import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { motivoMigracaoPxvPorItem } from '../_shared/user-products/guard-migracao-pxv.ts';
import { EMBED_MODULOS, kitLigado, prepararStatusOperador } from '../_shared/kit-variacao/politica.ts';
import { lerStatusML } from '../_shared/operacoes/ml-status.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só admin (ADR-0060) — diferente das demais ações de escrita (só requireUser),
  // pausar/reativar tem efeito imediato na visibilidade do anúncio pros compradores.
  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
      const r = context = await requireUserOrg(req, { access: 'write' });
    if (!r.isAdmin && r.support?.scope !== 'full') {
      await auditarOperacaoSuporte(adminClient(), context, { type: 'org', id: r.orgId }, 'denied');
      throw new Response('Somente administradores podem executar esta ação', { status: 403 });
    }
    orgId = r.orgId;
  }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { ml_item_id, status } = await req.json().catch(() => ({}));
  if (!ml_item_id || (status !== 'ativo' && status !== 'pausado')) {
    return new Response('ml_item_id e status (ativo|pausado) obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // Token da conexão ML da org (E7), não a do chamador, igual status-publicados.
  // = `resolverConexao`, com o módulo da org embutido (ADR-0197): org sem kit não ganha consulta nova.
  const { data: linhaConexao } = await admin.from('marketplace_connections')
    .select(`id, org_id, canal, conta_externa_id, expires_at, ${EMBED_MODULOS}`)
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(linhaConexao ?? null);
  if (!conexao) {
    return new Response(JSON.stringify({ erro: 'Conecte sua conta ML nas Configurações.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ADR-0161 (J13): pausar/reativar durante a migração "preço por variação". O ML recusa alterações
  // no item em migração, e o encerramento que ele faz no fim pode colidir com um `paused` nosso —
  // deixando o anúncio num estado que ninguém pediu.
  const motivoMigracao = await motivoMigracaoPxvPorItem(admin, orgId, ml_item_id);
  if (motivoMigracao) {
    await auditarOperacaoSuporte(admin, context, { type: 'item', id: ml_item_id }, 'denied');
    return new Response(JSON.stringify({ erro: motivoMigracao }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
  // ADR-0197: SKU de kit com variação. Guardado, moderado, em transferência ou sem leitura no ML não reativa
  // (409); a pausa do operador fica gravada antes do PUT; a exclusão da ativação só sai com o resultado confirmado.
  const kit = await prepararStatusOperador(admin, {
    orgId, mlItemId: ml_item_id, alvo: status, ligado: kitLigado(linhaConexao),
    lerStatus: async (id) => lerStatusML(await ctx.getToken(), id),
    alertar: (texto) => notificarCategoria(admin, orgId, 'estoque', texto),
  });
  if ('recusa' in kit) {
    await auditarOperacaoSuporte(admin, context, { type: 'item', id: ml_item_id }, 'denied');
    return new Response(JSON.stringify({ erro: kit.recusa }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  let resultado: Awaited<ReturnType<typeof conn.atualizarStatus>> = { ok: false };   // exceção = ambíguo
  try {
    resultado = await conn.atualizarStatus(ctx, ml_item_id, status);
  } finally {
    await kit.concluir(resultado);
  }
  if (!resultado.ok) {
    await auditarOperacaoSuporte(admin, context, { type: 'item', id: ml_item_id }, 'failed');
    return new Response(
      JSON.stringify({ erro: resultado.erro?.mensagemOperador ?? 'Falha ao atualizar status no Mercado Livre.' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  await auditarOperacaoSuporte(admin, context, { type: 'item', id: ml_item_id }, 'succeeded');
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
