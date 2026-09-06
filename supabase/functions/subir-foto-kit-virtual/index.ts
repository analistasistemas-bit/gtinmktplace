// ADR-0154 D-5 / ADR-0033: sobe a foto do Kit Virtual ao ML assim que o operador escolhe a foto
// no diálogo (não no clique de publicar) — a propagação de foto no ML é assíncrona e um
// `picture_id` recém-criado costuma ser recusado por minutos. Admin-only (mesmo gate das outras
// edges de kit virtual), sem escrita em banco: o diálogo guarda o `picture_id` devolvido e manda
// no publicar; `criar-kit-virtual` mantém o upload como fallback quando esta chamada falha.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { subirFotoKitVirtual, type MotivoSubirFotoKitVirtual, type SubirFotoKitVirtualInput } from './processar.ts';

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — mesmo TTL de criar-kit-virtual/index.ts (o ML baixa a foto de forma assíncrona)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<MotivoSubirFotoKitVirtual, number> = {
  path_invalido: 400,
  falha_url_assinada: 500,
  falha_upload_ml: 502,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;

  const admin = adminClient();

  // Gate admin (ADR-0060), mesmo padrão das demais edges de kit virtual.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  let body: { foto_storage_path?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof body.foto_storage_path !== 'string' || !body.foto_storage_path) {
    return json({ error: 'foto_storage_path é obrigatório.' }, 400);
  }
  const input: SubirFotoKitVirtualInput = { fotoStoragePath: body.foto_storage_path };
  const target = { type: 'kit_virtual_foto', id: input.fotoStoragePath };

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ error: 'Organização sem conexão com o Mercado Livre', motivo: 'sem_conexao_ml' }, 409);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch (e) {
    console.error('subir_foto_kit_virtual_token_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao renovar credencial do Mercado Livre' }, 502);
  }

  const resultado = await subirFotoKitVirtual({
    urlAssinadaFoto: async (path) => {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      return data?.signedUrl ?? null;
    },
    subirFoto: (sourceUrl) => subirFotoML(token, sourceUrl),
  }, input);

  if (!resultado.ok) {
    console.error('subir_foto_kit_virtual_falhou', { orgId, motivo: resultado.motivo, erro: resultado.mensagem });
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json(
      { error: resultado.mensagem ?? resultado.motivo, motivo: resultado.motivo },
      STATUS_POR_MOTIVO[resultado.motivo] ?? 400,
    );
  }

  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({ ok: true, picture_id: resultado.pictureId });
});
