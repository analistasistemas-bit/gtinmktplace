// ADR-0113: exclusão de produto pelo módulo Estoque — só produto NÃO publicado em canal nenhum.
// Admin-only por paridade com ajustar/zerar (ADR-0110) e pausar (ADR-0060): excluir é mais pesado
// que ambos. Esconder o item no menu é coerência de navegação; a trava real é o 403 daqui.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { excluirProduto } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let isAdmin: boolean;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ orgId, isAdmin } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  if (!isAdmin) return json({ erro: 'Somente administradores podem excluir produtos.' }, 403);

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ erro: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { codigo_pai?: string };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const codigoPai = body.codigo_pai?.trim();
  if (!codigoPai) return json({ erro: 'codigo_pai obrigatório' }, 400);

  const r = await excluirProduto(admin, { codigoPai, orgId });
  // `produto`, não `familia`: o alvo é o codigo_pai (D-4), e as outras portas gravam um UUID de
  // família em `target_id` — reusar o mesmo type com um código faria a auditoria mentir.
  const target = { type: 'produto', id: codigoPai };

  switch (r.tipo) {
    case 'nao_encontrada':
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({ erro: 'Produto não encontrado.' }, 404);
    case 'publicado':
      await auditarOperacaoSuporte(admin, context, target, 'denied');
      return json({ erro: 'Produto publicado — remova pela tela Publicados primeiro.' }, 409);
    case 'em_voo':
      await auditarOperacaoSuporte(admin, context, target, 'denied');
      return json({ erro: 'Há um processamento em andamento para este produto. Aguarde terminar.' }, 409);
    case 'ok':
      await auditarOperacaoSuporte(admin, context, target, 'succeeded');
      return json({
        ok: true,
        familias_removidas: r.familiasRemovidas,
        lotes_removidos: r.lotesRemovidos,
        movimentos_removidos: r.movimentosRemovidos,
      });
  }
});
