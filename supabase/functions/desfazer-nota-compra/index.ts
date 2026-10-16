// ADR-0181 D-11 — desfazer/cancelar importação de NF-e de compra. JWT do app; gate estoque; só admin.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { autorizarDesfazer, validarDesfazer } from './validar.ts';
import { processarDesfazer } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { userId, orgId } = ctx;
  const admin = adminClient();

  if (!(await exigirModulo(admin, orgId, 'estoque'))) return json({ error: 'Módulo de estoque não habilitado.' }, 403);
  const recusa = autorizarDesfazer(ctx);
  if (recusa) return json({ error: recusa }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const v = validarDesfazer(body);
  if (!v.ok) return json({ error: v.erro }, 400);

  try {
    const r = await processarDesfazer({
      rpc: async (nome, args) => {
        const { data, error } = await admin.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      enfileirar: enfileirarSincronizacaoEstoque,
    }, { orgId, userId, notaId: v.notaId, status: v.status });
    await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: v.notaId }, 'succeeded');
    return json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
