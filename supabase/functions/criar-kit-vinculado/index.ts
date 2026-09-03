// ADR-0151: cria kit(s) vinculado(s) a partir de uma família-base existente, direto da tela
// Estoque. Clona categoria/atributos/descrição da base com SALE_FORMAT forçado para "Kit",
// registra uma família técnica por tamanho (status='pronto', em lote dedicado nascido em
// 'publicando' — nunca aparece como card de Revisão) e encadeia a publicação quando a base já
// está no ar. Se a base ainda não publicou, é o CREATE dela que encadeia os kits pendentes
// depois (publish-familia-ml/processar.ts) — nunca esta edge.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { criarKitsVinculados, type CriarKitInput, type KitSolicitado } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<string, number> = {
  multiplicador_invalido: 400,
  titulo_longo: 400,
  preco_invalido: 400,
  kit_duplicado: 400,
  base_nao_encontrada: 404,
  base_sem_variacao: 409,
  base_multivariacao: 409,
  base_e_kit: 409,
  base_sem_custo: 400,
  base_sem_peso: 400,
  base_sem_categoria: 400,
  categoria_sem_kit: 400,
  sem_conexao_ml: 409,
  falha_numeracao: 500,
  falha_lote: 500,
  falha_criar_familia: 500,
  falha_criar_variacao: 500,
  falha_leitura: 500,
};

// Encadeia publicar-familias com o JWT do chamador (server-to-server) — mesmo padrão de
// adicionar-variacoes-familia/index.ts:35-48, em UMA chamada para todos os kits novos deste
// clique (o endpoint já aceita `familia_ids: string[]`).
async function encadearPublicacao(authorization: string, familiaIds: string[]): Promise<boolean> {
  if (familiaIds.length === 0) return true;
  try {
    const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/publicar-familias`, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ familia_ids: familiaIds }),
    });
    const corpo = await resp.json().catch(() => null) as { enfileiradas?: number } | null;
    return resp.ok && Number(corpo?.enfileiradas ?? 0) > 0;
  } catch (e) {
    console.error('criar_kit_vinculado_publicar_falhou', { familiaIds, erro: String(e) });
    return false;
  }
}

function parseKit(raw: unknown): KitSolicitado | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.multiplicador !== 'number' || typeof r.chave_cadastro !== 'string' || !r.chave_cadastro
    || typeof r.titulo !== 'string' || typeof r.descricao !== 'string' || typeof r.preco !== 'number'
  ) {
    return null;
  }
  return {
    multiplicador: r.multiplicador,
    chaveCadastro: r.chave_cadastro,
    titulo: r.titulo,
    descricao: r.descricao,
    preco: r.preco,
    gtin: typeof r.gtin === 'string' ? r.gtin : null,
    imagemPath: typeof r.imagem_path === 'string' ? r.imagem_path : null,
    alturaCm: typeof r.altura_cm === 'number' ? r.altura_cm : 0,
    larguraCm: typeof r.largura_cm === 'number' ? r.largura_cm : 0,
    comprimentoCm: typeof r.comprimento_cm === 'number' ? r.comprimento_cm : 0,
    atacado: Array.isArray(r.atacado) ? r.atacado : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string, orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();

  // Gate admin (D-7/ADR-0060), mesmo padrão de adicionar-variacoes-familia:64 — kit vinculado
  // muda a composição de anúncios (existente ou futuro), mesma classe de risco.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { familia_base_id?: unknown; kits?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (typeof body.familia_base_id !== 'string' || !body.familia_base_id) {
    return json({ error: 'familia_base_id é obrigatório.' }, 400);
  }
  if (!Array.isArray(body.kits) || body.kits.length === 0) {
    return json({ error: 'Informe ao menos um kit.' }, 400);
  }
  const kitsParseados = body.kits.map(parseKit);
  if (kitsParseados.some((k) => k === null)) {
    return json({ error: 'Kit inválido no payload.' }, 400);
  }

  const input: CriarKitInput = {
    familiaBaseId: body.familia_base_id,
    kits: kitsParseados as KitSolicitado[],
  };
  const target = { type: 'familia', id: input.familiaBaseId };

  const resultado = await criarKitsVinculados({
    admin,
    orgId,
    userId,
    resolverToken: async () => {
      const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
      if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      return getValidAccessTokenConexao(conexao);
    },
    lerSchema: lerSchemaAtributos,
    encadearPublicacao: (familiaIds) => encadearPublicacao(req.headers.get('Authorization')!, familiaIds),
  }, input);

  if (!resultado.ok) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json(
      { error: resultado.mensagem ?? resultado.motivo, motivo: resultado.motivo },
      STATUS_POR_MOTIVO[resultado.motivo ?? ''] ?? 400,
    );
  }

  await auditarOperacaoSuporte(admin, context, target, 'succeeded');
  return json({ ok: true, kits: resultado.kits });
});
