// ADR-0199 — "Tirar da revisão": apaga UMA família não publicada. Permissão = a do excluir-lote.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { excluirFamilia } from './processar.ts';
import type { MotivoRecusa } from './decidir.ts';

const MENSAGENS: Record<MotivoRecusa, string> = {
  publicada: 'Família já publicada — use a tela Publicados.',
  em_voo: 'Há processamento ou publicação em andamento para este produto. Aguarde terminar.',
  vinculada: 'Família ligada a anúncio no Mercado Livre e é a única que o representa — não pode sair. Basta não selecioná-la.',
  kit: 'Produto tem kit vinculado: remova os kits antes.',
  nao_conferido: 'Não deu para conferir o vínculo com o Mercado Livre. Nada foi apagado — tente de novo.',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { familia_id?: string };
  try { body = await req.json(); } catch { body = {}; }
  const familiaId = typeof body.familia_id === 'string' ? body.familia_id.trim() : '';
  if (!familiaId) return json({ erro: 'familia_id obrigatório' }, 400);

  const admin = adminClient();
  const r = await excluirFamilia(admin, {
    familiaId, orgId: context.orgId, userId: context.userId, suporteFull: context.support?.scope === 'full',
  });
  const target = { type: 'familia', id: familiaId };

  switch (r.tipo) {
    case 'nao_encontrada':
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({ erro: 'Família não encontrada.' }, 404);
    case 'recusada':
      await auditarOperacaoSuporte(admin, context, target, 'denied');
      // pxv e o 23514 do trigger de kit trazem a mensagem própria.
      return json({ erro: r.mensagem ?? MENSAGENS[r.motivo as MotivoRecusa] }, 409);
    case 'ok':
      await auditarOperacaoSuporte(admin, context, target, 'succeeded');
      return json({ ok: true, lote_removido: r.loteRemovido });
  }
});
