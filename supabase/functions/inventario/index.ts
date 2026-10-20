// ADR-0181 D-12 — inventário (hoje, foto, contagem, confirmação). JWT do app; gate estoque.
// Leituras: membro. Escrita (salvar/confirmar): admin. Escrita de estoque só pelas RPCs (service_role).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarCorpo } from './validar.ts';
import { processarInventario } from './processar.ts';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const bruto: unknown = await req.json().catch(() => null);
  const v = validarCorpo(bruto);
  if (!v.ok) return json({ error: v.erro }, 400);
  const { corpo } = v;
  const leitura = corpo.acao === 'hoje' || corpo.acao === 'foto';

  let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ctx = await requireUserOrg(req, { access: leitura ? 'read' : 'write' }); }
  catch (resp) {
    if (resp instanceof Response) return json({ error: 'Sessão expirada ou sem acesso — entre de novo.' }, resp.status);
    throw resp;
  }
  if (!leitura && !ctx.isAdmin) return json({ error: 'Somente administradores podem alterar o inventário.' }, 403);

  const admin = adminClient();
  if (!(await exigirModulo(admin, ctx.orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }
  // ADR-0181 D-13 (emenda 20/10): inventário mora no pacote do contador — só org PJ.
  const { data: org, error: orgErr } = await admin.from('organizations').select('tipo_pessoa').eq('id', ctx.orgId).maybeSingle();
  if (orgErr) return json({ error: 'Falha ao ler o cadastro da organização.' }, 502);
  if (org?.tipo_pessoa !== 'pj') return json({ error: 'Inventário disponível só para pessoa jurídica.' }, 403);

  const alvo = {
    type: 'inventario',
    id: corpo.acao === 'foto' ? corpo.data_base : corpo.acao === 'hoje' ? 'hoje' : corpo.inventario_id,
  };
  try {
    const r = await processarInventario(
      {
        // `async` de propósito: o builder do supabase-js é PromiseLike (deno check).
        rpc: async (nome, args) => {
          const res = await admin.rpc(nome, args);
          return { data: res.data, error: res.error };
        },
        enfileirar: enfileirarSincronizacaoEstoque,
      },
      { corpo, orgId: ctx.orgId, userId: ctx.userId },
    );
    await auditarOperacaoSuporte(admin, ctx, alvo, r.status === 200 ? 'succeeded' : 'failed');
    return json(r.body, r.status, r.headers);
  } catch (e) {
    console.error('inventario_falhou', String(e));
    return json({ error: 'Falha interna no inventário.' }, 500);
  }
});
