// E6b (ADR-0110): ajuste/zeragem de saldo. Escrita de estoque só passa por aqui (service_role),
// nunca do browser — o trigger do Bloco A recusa UPDATE direto em `variacoes.estoque`.
// Admin-only por paridade com pausar/reativar anúncio (ADR-0060): zerar tira o produto de venda.
// Só REDUZ: aumentar é Entrada de mercadoria, que exige custo e alimenta markup (ADR-0055).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarAjustes } from './validar.ts';
import { processarAjuste } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string;
  let orgId: string;
  let isAdmin: boolean;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId, isAdmin } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  if (!isAdmin) return json({ error: 'Somente administradores podem ajustar estoque.' }, 403);

  const admin = adminClient();
  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { ajustes?: unknown; observacao?: string | null; ref?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const validacao = validarAjustes(body.ajustes);
  if (!validacao.ok) return json({ error: validacao.erro }, 400);

  // Idempotência: o cliente gera um uuid por submissão. Sem isso, duplo clique ou retry de rede
  // aplicaria o ajuste duas vezes — e a segunda veria um saldo já reduzido.
  const ref = body.ref?.trim();
  if (!ref) return json({ error: 'Referência de idempotência ausente.' }, 400);

  const r = await processarAjuste(
    {
      rpc: (nome, args) => admin.rpc(nome, args).then((res) => ({ data: res.data, error: res.error })),
      lerMovimento: async (org, refItem) => {
        const { data } = await admin.from('estoque_movimentos')
          .select('codigo_pai, estoque_resultante')
          .eq('org_id', org).eq('referencia_externa', refItem).maybeSingle();
        return (data as { codigo_pai: string | null; estoque_resultante: number | null } | null) ?? null;
      },
      enfileirar: enfileirarSincronizacaoEstoque,
    },
    { orgId, userId, itens: validacao.itens, observacao: body.observacao?.trim() || null, ref },
  );

  await auditarOperacaoSuporte(
    admin, context, { type: 'variacao', id: validacao.itens.map((i) => i.codigo).join(',') }, 'succeeded',
  );

  return json(r);
});
