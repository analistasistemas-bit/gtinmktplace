// ADR-0154 (Kit Virtual): preview do diálogo de criação — título por template, margem/rateio
// (Decisões 6/7/15) e descrição por IA sob pedido (Decisão 4). Admin-only (mesmo gate de
// criar-kit-vinculado/buscar-componentes-kit-virtual), read-only e idempotente: não escreve nada.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarListingPrice, comissaoDe } from '../_shared/ml/listing-prices.ts';
import { gerarCopy } from '../_shared/ai/copywriter.ts';
import { posProcessarDescricao } from '../_shared/ai/copywriter-prompt.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { montarPreviewKit, type ComponenteEntrada, type PreviewKitDeps, type PreviewKitInput } from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Modo Clássico (gold_special) — mesma referência usada pelo grosso da precificação do app
// (ver `PRECO_REF_COMISSAO`/`buscarListingPrice(..., 'gold_special')` em process-familia/index.ts).
const LISTING_TYPE = 'gold_special';

async function buscarComissaoML(token: string, categoriaMlId: string, precoKitEstimado: number) {
  try {
    const lp = await buscarListingPrice(token, precoKitEstimado, categoriaMlId, LISTING_TYPE);
    return comissaoDe(lp);
  } catch (e) {
    console.error('preview_kit_virtual_comissao_falhou', { categoriaMlId, erro: String(e) });
    return null;
  }
}

/** Alíquotas confirmadas da org (ADR-0055/0086) — mesma trava LOUD de process-familia/index.ts:
 * sem confirmação explícita nunca defaulta em silêncio, vira `faltando` no preview (Decisão 6). */
async function lerAliquotasOrg(admin: SupabaseClient, orgId: string) {
  const { data } = await admin.from('configuracoes')
    .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em')
    .eq('org_id', orgId).maybeSingle() as {
      data: { aliquota_nacional_pct: number | null; aliquota_importado_pct: number | null; aliquotas_confirmadas_em: string | null } | null;
    };
  if (!data?.aliquotas_confirmadas_em) return null;
  return {
    nacional: Number(data.aliquota_nacional_pct ?? 8),
    importado: Number(data.aliquota_importado_pct ?? 16),
  };
}

/** Descrição por IA (Decisão 4): reusa `gerarCopy`/`posProcessarDescricao` — a mesma esteira de
 * copy do app (ver `regenerar-copy-familia/index.ts`) — em vez de escrever prompt novo. Os
 * componentes viram "variações" para os guards de pós-processamento (embalagem/tonalidade). */
async function gerarDescricaoKitViaIA(
  admin: SupabaseClient, orgId: string, componentes: ComponenteEntrada[], tituloKit: string,
): Promise<string> {
  const modeloTexto = await resolverModeloTexto(admin, orgId);
  const variacoes = componentes.map((c) => ({ codigo: c.userProductId, cor: null, preco: c.precoAtualML, nome: c.titulo }));
  const descricaoFonte = componentes.map((c) => `${c.quantidade}x ${c.titulo}`).join('\n');
  const result = await gerarCopy({ nome: tituloKit, descricao_detalhado: descricaoFonte, variacoes }, modeloTexto);
  return posProcessarDescricao(result.descricao, tituloKit, descricaoFonte, variacoes);
}

// ─── Parsing do body ────────────────────────────────────────────────────────

function parseComponente(raw: unknown): ComponenteEntrada | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.user_product_id !== 'string' || !r.user_product_id
    || typeof r.quantidade !== 'number' || !(r.quantidade >= 1)
    || typeof r.preco_atual_ml !== 'number' || !(r.preco_atual_ml > 0)
    || typeof r.titulo !== 'string' || !r.titulo
    || typeof r.ordem !== 'number'
  ) {
    return null;
  }
  const origem = r.origem === 'nacional' || r.origem === 'importado' ? r.origem : null;
  return {
    ordem: r.ordem,
    userProductId: r.user_product_id,
    quantidade: r.quantidade,
    precoAtualML: r.preco_atual_ml,
    custo: typeof r.custo === 'number' ? r.custo : null,
    origem,
    titulo: r.titulo,
    kitMultiplicador: typeof r.kit_multiplicador === 'number' ? r.kit_multiplicador : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId } = context;

  const admin = adminClient();

  // Gate admin (D-7/ADR-0060), mesmo padrão de criar-kit-vinculado/index.ts:96-101 e
  // buscar-componentes-kit-virtual/index.ts.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  let body: {
    componentes?: unknown; desconto_pct?: unknown; categoria_ml_id?: unknown;
    gerar_descricao?: unknown; frete?: unknown;
  };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  if (!Array.isArray(body.componentes) || body.componentes.length < 2 || body.componentes.length > 6) {
    return json({ error: 'Informe entre 2 e 6 componentes.' }, 400);
  }
  const componentes = body.componentes.map(parseComponente);
  if (componentes.some((c) => c === null)) {
    return json({ error: 'Componente inválido no payload.' }, 400);
  }
  if (!componentes.some((c) => c!.ordem === 0)) {
    return json({ error: 'A composição precisa de um componente principal (ordem 0).' }, 400);
  }
  if (typeof body.desconto_pct !== 'number' || !(body.desconto_pct >= 0) || !(body.desconto_pct < 1)) {
    return json({ error: 'desconto_pct precisa ser decimal entre 0 (inclusive) e 1 (exclusivo).' }, 400);
  }
  if (typeof body.categoria_ml_id !== 'string' || !body.categoria_ml_id) {
    return json({ error: 'categoria_ml_id é obrigatório.' }, 400);
  }
  const frete = typeof body.frete === 'number' && body.frete >= 0 ? body.frete : 0;
  const gerarDescricao = body.gerar_descricao === true;

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao || !conexao.contaExternaId) {
    return json({ error: 'Organização sem conexão com o Mercado Livre', motivo: 'sem_conexao_ml' }, 409);
  }

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch (e) {
    console.error('preview_kit_virtual_token_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao renovar credencial do Mercado Livre' }, 502);
  }

  const input: PreviewKitInput = {
    componentes: componentes as ComponenteEntrada[],
    descontoPct: body.desconto_pct,
    categoriaMlIdPrincipal: body.categoria_ml_id,
    gerarDescricao,
    frete,
  };

  const deps: PreviewKitDeps = {
    buscarComissao: (categoriaMlId, precoKitEstimado) => buscarComissaoML(token, categoriaMlId, precoKitEstimado),
    lerAliquotasOrg: () => lerAliquotasOrg(admin, orgId),
    gerarDescricaoKit: (componentesEntrada, tituloKit) => gerarDescricaoKitViaIA(admin, orgId, componentesEntrada, tituloKit),
  };

  try {
    const resultado = await montarPreviewKit(deps, input);
    return json({
      ok: true,
      titulo: resultado.titulo,
      desconto_pct: resultado.descontoPct,
      descricao: resultado.descricao,
      descricao_gerada_por_ia: resultado.descricaoGeradaPorIA,
      aviso_kit_vinculado: resultado.avisoKitVinculado,
      margem_estimativa: resultado.margemEstimativa,
      margem: resultado.margem,
    });
  } catch (e) {
    console.error('preview_kit_virtual_falhou', { orgId, erro: String(e) });
    return json({ error: 'Falha ao montar o preview do kit' }, 502);
  }
});
