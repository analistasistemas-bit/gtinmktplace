// ADR-0188: "Editar marca" — casca fina. Auth (admin ou suporte full, como o Pausar — ADR-0060) e
// portas reais; a regra vive em processar.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { lerMarcaOrg } from '../_shared/categoria/marca-org.ts';
import { enfileirarSincronizacaoMarca } from '../_shared/queue.ts';
import { processarEdicaoMarca } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const body = await req.json().catch(() => ({})) as { codigo_pai?: unknown; marca?: unknown };
  const codigoPai = typeof body.codigo_pai === 'string' ? body.codigo_pai.trim() : '';
  const marca = typeof body.marca === 'string' ? body.marca : null;
  const admin = adminClient();
  const orgId = context.orgId;

  const r = await processarEdicaoMarca({
    lerMarcaOrg: (id) => lerMarcaOrg(admin, id),
    gravarMarca: async (id, cp, m) => {
      const { data, error } = await admin.rpc('gravar_marca_familia', { p_org_id: id, p_codigo_pai: cp, p_marca: m });
      if (error) throw new Error(error.message);
      const d = data as { publicado: boolean; versao: number | null };
      return { publicado: d.publicado === true, versao: d.versao ?? null };
    },
    enfileirar: async (id, cp, versao) => { await enfileirarSincronizacaoMarca({ org_id: id, codigo_pai: cp, versao }); },
    marcarErro: async (id, cp, versao, erro) => {
      const patch = { marca_sync_status: 'erro', marca_sync_erro: erro, marca_sync_em: new Date().toISOString() };
      const { data: raiz } = await admin.from('anuncios_externos').select('marca_sync_versao')
        .eq('org_id', id).eq('codigo_pai', cp).eq('canal', 'mercado_livre').eq('particao', 0).maybeSingle();
      if (raiz?.marca_sync_versao !== versao) return; // já há edição mais nova
      await admin.from('anuncios_externos').update(patch)
        .eq('org_id', id).eq('codigo_pai', cp).eq('canal', 'mercado_livre');
    },
    auditar: (resultado) => auditarOperacaoSuporte(admin, context, { type: 'familia', id: `${orgId}:${codigoPai}` }, resultado),
  }, {
    orgId, codigoPai, marca,
    podeEditar: context.isAdmin || context.support?.scope === 'full',
  });

  return new Response(JSON.stringify(r.body), {
    status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
