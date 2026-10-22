// Extensão PubliAI (ADR-0189 D-17/D-18/D-19): única entrada de servidor da extensão.
// Sessão Supabase do usuário → org; token ML da org só no servidor e só em leituras.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarListingPrice, comissaoDeComProveniencia } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../_shared/ml/frete.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { redisGet, redisIncrComTTL, redisSet } from '../_shared/redis/client.ts';
import { analisarAnuncio, type DepsAnuncio } from '../_shared/extensao/analisar-anuncio.ts';
import type { ComissaoML, Disponivel } from '../_shared/extensao/tipos.ts';
import { ErroExtensao, normalizarErro } from '../_shared/extensao/erros.ts';
import {
  acessoDaAcao, chaveLimite, chaveLimiteErro, escaparLike, formasGtin, itemBusca, type LinhaVariacao,
  type Pedido, SELECT_VARIACAO, unidadesDoProduto, validarPedido, variacoesDasLinhas,
} from './roteamento.ts';

const TTL_CACHE_S = 6 * 3600;
const LIMITE_ANALISES_MIN = 30;
const LIMITE_ERROS_HORA = 20;
const SEM_CONEXAO = { estado: 'indisponivel', motivo: 'Conecte o Mercado Livre à organização' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Cache é otimização: erro de Redis nunca derruba a análise; só valor `ok` é gravado. */
async function emCache<T>(chave: string, guardar: (v: T) => boolean, calcular: () => Promise<T>): Promise<T> {
  try {
    const hit = await redisGet(chave);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* segue sem cache */ }
  const v = await calcular();
  if (guardar(v)) { try { await redisSet(chave, JSON.stringify(v), TTL_CACHE_S); } catch { /* idem */ } }
  return v;
}

function falhou(onde: string, e: { message: string } | null) {
  if (e) throw new Error(`${onde}: ${e.message}`);
}

function criarDeps(admin: SupabaseClient, orgId: string): DepsAnuncio {
  const conexao = resolverConexao(admin, orgId, 'mercado_livre');
  let token: Promise<string | null> | null = null;
  // Token pedido uma vez por requisição e só quando alguma dep precisa do ML.
  const tokenML = () => (token ??= conexao.then((c) => (c ? getValidAccessTokenConexao(c) : null)));

  const variacoes = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>, onde: string) => {
    const { data, error } = await q;
    falhou(onde, error);
    return variacoesDasLinhas((data ?? []) as LinhaVariacao[]);
  };

  return {
    contaDaOrg: async () => {
      const c = await conexao;
      return c?.contaExternaId != null ? String(c.contaExternaId) : null;
    },
    aliquotas: async (org) => {
      const { data, error } = await admin.from('configuracoes')
        .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em').eq('org_id', org).maybeSingle();
      falhou('configuracoes', error);
      const n = (v: unknown) => (v == null ? null : Number(v));
      return { confirmada: data?.aliquotas_confirmadas_em != null, nacional: n(data?.aliquota_nacional_pct), importado: n(data?.aliquota_importado_pct) };
    },
    porCatalogo: (org, cpid) => variacoes(
      admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', org).eq('catalog_product_id', cpid).limit(50),
      'porCatalogo',
    ),
    porGtin: (org, gtin) => variacoes(
      admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', org).in('gtin', formasGtin(gtin)).limit(50),
      'porGtin',
    ),
    porVinculoManual: async (org, chave) => {
      const { data, error } = await admin.from('extensao_vinculos').select('variacao_id')
        .eq('org_id', org).eq('chave_tipo', chave.tipo).eq('chave', chave.valor).maybeSingle();
      falhou('extensao_vinculos', error);
      if (!data) return null;
      const r = await variacoes(
        admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', org).eq('id', data.variacao_id),
        'porVinculoManual',
      );
      return r[0] ?? null;
    },
    comissao: async (preco, categoriaId, tipo) => {
      const t = await tokenML();
      if (!t) return SEM_CONEXAO;
      return emCache<Disponivel<ComissaoML>>(`ext:lp:${categoriaId}:${tipo}:${preco}`, (v) => v.estado === 'ok', async () => {
        const lp = await buscarListingPrice(t, preco, categoriaId, tipo);
        const c = comissaoDeComProveniencia(lp);
        if (c.proveniencia !== 'official') return { estado: 'indisponivel', motivo: c.motivo ?? 'comissão não detalhada pelo Mercado Livre' };
        return { estado: 'ok', valor: { ...c.valor, saleFeeAmount: lp.sale_fee_amount, precoConsultado: preco } };
      });
    },
    frete: async (preco, categoriaId, dim) => {
      const [t, c] = await Promise.all([tokenML(), conexao]);
      if (!t || !c?.contaExternaId) return SEM_CONEXAO;
      const dims = dim ? `${dim.altura_cm}x${dim.largura_cm}x${dim.comprimento_cm},${dim.peso_gramas}` : 'padrao';
      return emCache<Disponivel<number>>(`ext:fr:${orgId}:${categoriaId}:${preco}:${dims}`, (v) => v.estado === 'ok', async () => {
        const f = await buscarFreteVendedorComProveniencia(t, String(c.contaExternaId), preco, categoriaId, dim);
        if (f.proveniencia === 'official') return { estado: 'ok', valor: f.valor };
        if (f.proveniencia === 'partial') return { estado: 'ok', valor: f.valor, aviso: 'estimado (pacote padrão)' };
        return { estado: 'indisponivel', motivo: f.motivo ?? 'frete indisponível' };
      });
    },
    unidadesPorPacote: async (cpid) => {
      if (!cpid) return 1;
      // Falha de token aqui não derruba a análise: comissão/frete já saem indisponíveis.
      const t = await tokenML().catch(() => null);
      if (!t) return 1;
      const chave = `ext:upp:${cpid}`;
      try {
        const hit = await redisGet(chave);
        if (hit) return Number(hit);
      } catch { /* segue sem cache */ }
      const produto = await mlGet(`https://api.mercadolibre.com/products/${cpid}`, t);
      const n = unidadesDoProduto(produto);
      if (produto != null) { try { await redisSet(chave, String(n), TTL_CACHE_S); } catch { /* idem */ } }
      return n;
    },
  };
}

async function buscarSku(admin: SupabaseClient, orgId: string, termo: string) {
  const like = `%${escaparLike(termo)}%`;
  const base = () => admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', orgId).limit(10);
  // Consultas separadas: o termo nunca entra numa expressão `.or()` do PostgREST.
  const consultas = [base().ilike('codigo', like), base().ilike('nome', like)];
  if (/^\d{8,14}$/.test(termo)) consultas.push(base().in('gtin', formasGtin(termo)));
  const linhas: LinhaVariacao[] = [];
  for (const { data, error } of await Promise.all(consultas)) {
    falhou('buscar_sku', error);
    linhas.push(...((data ?? []) as LinhaVariacao[]));
  }
  const vistos = new Set<string>();
  const itens = [];
  for (const l of linhas.sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : -1))) {
    if (vistos.has(l.codigo)) continue;
    vistos.add(l.codigo);
    itens.push(itemBusca(l));
    if (itens.length === 10) break;
  }
  return { itens };
}

async function executar(p: Pedido, admin: SupabaseClient, orgId: string, userId: string): Promise<unknown> {
  switch (p.acao) {
    case 'analisar_anuncio': {
      if (await redisIncrComTTL(chaveLimite(userId, new Date()), 120) > LIMITE_ANALISES_MIN) throw new ErroExtensao('limite', 429);
      const r = await analisarAnuncio(orgId, p.entrada, criarDeps(admin, orgId));
      const { error } = await admin.rpc('extensao_registrar_uso', { p_org_id: orgId, p_user_id: userId, p_tipo: p.tipoPagina });
      if (error) console.warn(`extensao_registrar_uso: ${error.message}`); // contagem não derruba a análise
      return r;
    }
    case 'buscar_sku':
      return buscarSku(admin, orgId, p.termo);
    case 'salvar_vinculo': {
      const { data, error } = await admin.from('variacoes').select('id').eq('id', p.variacaoId).eq('org_id', orgId).maybeSingle();
      falhou('salvar_vinculo', error);
      if (!data) throw new ErroExtensao('payload_invalido', 400); // variação de outra org (ou inexistente)
      const { error: e2 } = await admin.from('extensao_vinculos').upsert(
        { org_id: orgId, chave_tipo: p.chave.tipo, chave: p.chave.valor, variacao_id: p.variacaoId, criado_por: userId },
        { onConflict: 'org_id,chave_tipo,chave' },
      );
      falhou('salvar_vinculo', e2);
      return { ok: true };
    }
    case 'remover_vinculo': {
      const { error } = await admin.from('extensao_vinculos').delete()
        .eq('org_id', orgId).eq('chave_tipo', p.chave.tipo).eq('chave', p.chave.valor);
      falhou('remover_vinculo', error);
      return { ok: true };
    }
    case 'erro_leitura': {
      // Acima de 20/h por usuário o registro é descartado em silêncio (telemetria, não análise).
      if (await redisIncrComTTL(chaveLimiteErro(userId, new Date()), 3600) > LIMITE_ERROS_HORA) return { ok: true };
      const { error } = await admin.rpc('extensao_registrar_erro', {
        p_org_id: orgId, p_tipo: p.tipoPagina, p_versao: p.versao, p_motivo: p.motivo, p_ml_item_id: p.mlItemId,
      });
      falhou('extensao_registrar_erro', error);
      return { ok: true };
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    let body: unknown = null;
    try { body = await req.json(); } catch { /* validado após a autenticação */ }
    const acao = (body as { acao?: unknown } | null)?.acao;
    // Sessão primeiro: payload ruim não pode mascarar sessão expirada.
    const { userId, orgId } = await requireUserOrg(req, { access: acessoDaAcao(acao) });
    const admin = adminClient();
    if (!(await exigirModulo(admin, orgId, 'extensao'))) throw new ErroExtensao('modulo_desligado', 403);
    const pedido = validarPedido(body);
    if (!pedido) throw new ErroExtensao('payload_invalido', 400);
    return json(await executar(pedido, admin, orgId, userId));
  } catch (e) {
    const { status, corpo } = normalizarErro(e);
    if (status === 500) console.error(`extensao: ${(e as Error)?.message ?? e}`);
    return json(corpo, status);
  }
});
