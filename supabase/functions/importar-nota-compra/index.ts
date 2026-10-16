// ADR-0181 — importação de NF-e de compra. JWT do app; gate estoque; exige PJ + CNPJ.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { validarImportacao } from './validar.ts';
import { processarImportacao, reenviarPush } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
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
  const { data: org } = await admin.from('organizations').select('tipo_pessoa').eq('id', orgId).maybeSingle();
  const { data: emp } = await admin.from('empresa_fiscal').select('cnpj').eq('org_id', orgId).maybeSingle();
  if (org?.tipo_pessoa !== 'pj' || !emp?.cnpj) {
    return json({ error: 'Cadastre o CNPJ da empresa em Configurações › Fiscal antes de importar notas.' }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const reenvio = (body as { reenviarPush?: { chave?: unknown } })?.reenviarPush;
  if (reenvio) {
    if (typeof reenvio.chave !== 'string' || !/^\d{44}$/.test(reenvio.chave)) return json({ error: 'chave inválida' }, 400);
    const chave = reenvio.chave;
    try {
      const r = await reenviarPush({
        codigosDaNota: async (o, c) => {
          const { data, error } = await admin.rpc('codigos_pai_da_nota', { p_org: o, p_chave: c });
          if (error) throw new Error(error.message);
          return (data as string[] | null) ?? [];
        },
        statusDaNota: async (o, c) => {
          const { data, error } = await admin.from('notas_compra').select('status').eq('org_id', o).eq('chave', c).maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.status as string | undefined) ?? null;
        },
        enfileirar: enfileirarSincronizacaoEstoque,
      }, orgId, chave);
      await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra_reenvio', id: chave }, 'succeeded');
      return json(r);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  const v = validarImportacao(body, emp.cnpj as string);
  if (!v.ok) return json({ error: v.erro }, 400);

  try {
    const r = await processarImportacao({
      notaExistente: async (o, chave) => {
        const { data, error } = await admin.from('notas_compra').select('status').eq('org_id', o).eq('chave', chave).maybeSingle();
        if (error) throw new Error(error.message);
        return data as { status: string } | null;
      },
      upload: async (path, xml) => {
        const { error } = await admin.storage.from('notas-compra')
          .upload(path, new Blob([xml], { type: 'application/xml' }), { upsert: false, contentType: 'application/xml' });
        if (!error) return 'criado';
        // Objeto já existe com o MESMO hash no path: mesmo conteúdo (retry/corrida). storage-js 2.108.2
        // (deno.lock:9) devolve "The resource already exists"/"Duplicate" com statusCode 400/409.
        if (/exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) return 'ja_existia';
        throw new Error(`upload do XML: ${error.message}`);
      },
      rpc: async (nome, args) => {
        const { data, error } = await admin.rpc(nome, args);
        return { data, error: error ? { message: error.message } : null };
      },
      enfileirar: enfileirarSincronizacaoEstoque,
    }, { orgId, userId, nota: v.nota, itens: v.itens, decisoes: v.decisoes, xml: v.xml,
         sha256: await sha256(v.xml), divergenciaTotal: v.divergenciaTotal });
    await auditarOperacaoSuporte(admin, ctx, { type: 'nota_compra', id: v.nota.chave }, 'succeeded');
    return json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
