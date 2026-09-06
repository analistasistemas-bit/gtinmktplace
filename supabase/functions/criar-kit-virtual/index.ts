// ADR-0154: publica um Kit Virtual no Mercado Livre. Admin-only (D-"Herdadas por precedente" /
// ADR-0060), idempotente por `chave_cadastro` e sem nenhum toque no pipeline de produto —
// o kit vive só em `kits_virtuais`/`kits_virtuais_componentes` (D-2).
//
// A revisão humana exigida pelo projeto é o preview do próprio diálogo (D-"Herdadas"), que é
// quem chama esta edge; não há card na tela Revisão para kit.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { subirFotoML, buscarSecureUrlFotoML } from '../_shared/ml/fotos.ts';
import { garantirDescricaoML } from '../_shared/ml/criar-item.ts';
import { criarKitVirtualML, buscarListingTypeItensML } from '../_shared/ml/kit-virtual.ts';
import {
  criarKitVirtual, type ComponenteKitVirtual, type CriarKitVirtualInput, type MotivoCriarKitVirtual,
} from './processar.ts';

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — o ML baixa a foto de forma assíncrona (mesmo TTL de pre-subir-fotos.ts)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<MotivoCriarKitVirtual, number> = {
  chave_invalida: 400,
  titulo_invalido: 400,
  componentes_invalidos: 400,
  componente_duplicado: 400,
  quantidade_invalida: 400,
  desconto_invalido: 400,
  desconto_divergente: 400,
  listing_type_divergente: 400,
  listing_type_indisponivel: 400,
  falha_listing_type: 502,
  foto_obrigatoria: 400,
  falha_leitura: 500,
  // Outra chamada está no meio do CREATE desta mesma chave — conflito, não erro do operador.
  em_andamento: 409,
  falha_criar_kit: 500,
  falha_componentes: 500,
  falha_foto: 502,
  ml_recusou: 400,
  falha_publicar: 500,
};

function parseComponente(raw: unknown): ComponenteKitVirtual | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.user_product_id !== 'string' || !r.user_product_id) return null;
  if (typeof r.quantidade !== 'number' || typeof r.desconto_pct !== 'number') return null;
  return {
    userProductId: r.user_product_id,
    quantidade: r.quantidade,
    descontoPct: r.desconto_pct,
    itemExternoId: typeof r.item_externo_id === 'string' ? r.item_externo_id : null,
    codigo: typeof r.codigo === 'string' ? r.codigo : null,
    codigoPai: typeof r.codigo_pai === 'string' ? r.codigo_pai : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = context;

  const admin = adminClient();

  // Gate admin (ADR-0060), mesmo padrão de criar-kit-vinculado/index.ts.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (typeof body.chave_cadastro !== 'string' || !body.chave_cadastro) {
    return json({ error: 'chave_cadastro é obrigatória.' }, 400);
  }
  if (typeof body.titulo !== 'string' || !body.titulo.trim()) {
    return json({ error: 'titulo é obrigatório.' }, 400);
  }
  if (!Array.isArray(body.componentes)) {
    return json({ error: 'componentes é obrigatório.' }, 400);
  }
  const componentes = body.componentes.map(parseComponente);
  if (componentes.some((c) => c === null)) return json({ error: 'Componente inválido no payload.' }, 400);

  const input: CriarKitVirtualInput = {
    chaveCadastro: body.chave_cadastro,
    titulo: body.titulo,
    descricao: typeof body.descricao === 'string' ? body.descricao : null,
    fotoStoragePath: typeof body.foto_storage_path === 'string' ? body.foto_storage_path : null,
    fotoMlPictureId: typeof body.foto_ml_picture_id === 'string' ? body.foto_ml_picture_id : null,
    // `listing_type_id` NÃO é entrada: a edge sempre deriva do listing type real dos componentes
    // desta submissão (bug real 2026-09-06 — um valor fixo, ou o do kit antigo num Refazer, não
    // bate com o listing type publicado e o ML recusa o kit inteiro com `listing_type_mismatch`).
    componentes: componentes as ComponenteKitVirtual[],
  };

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return json({ error: 'Organização sem conexão com o Mercado Livre', motivo: 'sem_conexao_ml' }, 409);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch (e) {
    console.error('criar_kit_virtual_token_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao renovar credencial do Mercado Livre' }, 502);
  }

  const target = { type: 'kit_virtual', id: input.chaveCadastro };
  const resultado = await criarKitVirtual({
    admin,
    orgId,
    userId,
    urlAssinadaFoto: async (path) => {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      return data?.signedUrl ?? null;
    },
    subirFoto: (sourceUrl) => subirFotoML(token, sourceUrl),
    buscarSecureUrlFoto: (pictureId) => buscarSecureUrlFotoML(token, pictureId),
    buscarListingTypeComponentes: (itemIds) => buscarListingTypeItensML(token, itemIds),
    criarKitML: (payload) => criarKitVirtualML(token, payload),
    garantirDescricao: (itemId, texto) => garantirDescricaoML(token, itemId, texto),
  }, input);

  if (!resultado.ok) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json(
      { error: resultado.mensagem ?? resultado.motivo, motivo: resultado.motivo, kit_id: resultado.kitId },
      STATUS_POR_MOTIVO[resultado.motivo] ?? 400,
    );
  }

  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({
    ok: true,
    kit_id: resultado.kitId,
    ml_item_id: resultado.mlItemId,
    ml_user_product_id: resultado.mlUserProductId,
    ml_permalink: resultado.mlPermalink,
    ja_existia: resultado.jaExistia,
  });
});
