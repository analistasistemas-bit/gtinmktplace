// Extensão PubliAI (ADR-0189 D-17/D-18/D-19): única entrada de servidor da extensão.
// Sessão Supabase do usuário → org; token ML da org só no servidor e só em leituras.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarListingPrice } from '../_shared/ml/listing-prices.ts';
import { buscarFreteVendedorComProveniencia } from '../_shared/ml/frete.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { buscarPerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { extrairNossaOferta } from '../_shared/pulse/parse.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { montarCatalogo, parsePrecoParaGanhar, perfisPrioritarios, vencedorDoCatalogo, type RespostaCatalogo } from '../_shared/extensao/catalogo.ts';
import { redisGet, redisIncrComTTL, redisSet } from '../_shared/redis/client.ts';
import { analisarAnuncio, type DepsAnuncio } from '../_shared/extensao/analisar-anuncio.ts';
import type { ComissaoML, Disponivel } from '../_shared/extensao/tipos.ts';
import { ErroExtensao, normalizarErro } from '../_shared/extensao/erros.ts';
import {
  chaveComissao, chaveLimite, comissaoDaListingPrice, chaveLimiteErro, deduplicarPorCodigo, escaparLike, formasGtin, itemBusca, type LinhaVariacao,
  basesDeKit, chaveFrete, dimensoesDoKitVivo, type Pedido, QTD_NAO_CONFIRMADA, uppDasBases, SELECT_VARIACAO, dataDoProduto, unidadesDoProduto, validarPedido, variacoesDasLinhas, vendedorDoPerfil, chaveCatalogo,
} from './roteamento.ts';

const TTL_CACHE_S = 6 * 3600;
const LIMITE_ANALISES_MIN = 30;
const LIMITE_ERROS_HORA = 20;
const SEM_CONEXAO = { estado: 'indisponivel', motivo: 'Conecte o Mercado Livre à organização' } as const;
const TTL_CATALOGO_S = 60;
// ponytail: teto vale também para perfis já em cache; contar só os que faltam exige mexer em perfil-vendedor (_shared).
const MAX_PERFIS_CATALOGO = 20;
const ML_API = 'https://api.mercadolibre.com';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Cache é otimização: erro de Redis nunca derruba a análise; só valor `ok` é gravado. */
async function emCache<T>(chave: string, guardar: (v: T) => boolean, calcular: () => Promise<T>, ttl = TTL_CACHE_S): Promise<T> {
  try {
    const hit = await redisGet(chave);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* segue sem cache */ }
  const v = await calcular();
  if (guardar(v)) { try { await redisSet(chave, JSON.stringify(v), ttl); } catch { /* idem */ } }
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
    const linhas = (data ?? []) as LinhaVariacao[];
    // Kit vinculado: as unidades dependem do UNITS_PER_PACK da família-base (D-8).
    const bases = basesDeKit(linhas);
    if (bases.length === 0) return variacoesDasLinhas(linhas);
    const { data: fam, error: e2 } = await admin.from('familias').select('codigo_pai, atributos_ml')
      .eq('org_id', orgId).in('codigo_pai', bases);
    falhou(`${onde}:base`, e2);
    return variacoesDasLinhas(linhas, uppDasBases((fam ?? []) as { codigo_pai: string; atributos_ml: unknown }[]));
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
      admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', org).eq('catalog_product_id', cpid)
        .order('atualizado_em', { ascending: false }).limit(50),
      'porCatalogo',
    ),
    porGtin: (org, gtin) => variacoes(
      admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', org).in('gtin', formasGtin(gtin))
        .order('atualizado_em', { ascending: false }).limit(50),
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
      const [t, c] = await Promise.all([tokenML(), conexao]);
      if (!t || c?.contaExternaId == null) return SEM_CONEXAO;
      return emCache<Disponivel<ComissaoML>>(chaveComissao(String(c.contaExternaId), categoriaId, tipo, preco), (v) => v.estado === 'ok', async () => {
        return comissaoDaListingPrice(await buscarListingPrice(t, preco, categoriaId, tipo), preco);
      });
    },
    frete: async (preco, categoriaId, dim) => {
      const [t, c] = await Promise.all([tokenML(), conexao]);
      if (!t || !c?.contaExternaId) return SEM_CONEXAO;
      return emCache<Disponivel<number>>(chaveFrete(String(c.contaExternaId), orgId, categoriaId, preco, dim), (v) => v.estado === 'ok', async () => {
        const f = await buscarFreteVendedorComProveniencia(t, String(c.contaExternaId), preco, categoriaId, dim);
        if (f.proveniencia === 'official') return { estado: 'ok', valor: f.valor };
        if (f.proveniencia === 'partial') return { estado: 'ok', valor: f.valor, aviso: 'estimado (pacote padrão)' };
        return { estado: 'indisponivel', motivo: f.motivo ?? 'frete indisponível' };
      });
    },
    unidadesPorPacote: async (cpid) => {
      // Fora de catálogo a quantidade não é confirmável no servidor (D-8): o painel pede ao operador.
      if (!cpid) return { estado: 'indisponivel', motivo: QTD_NAO_CONFIRMADA };
      const t = await tokenML().catch(() => null);
      if (!t) return { estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' };
      // v3: a v2 gravou "ok 1" para produto sem o atributo (presunção); não é relida.
      return emCache<Disponivel<number>>(`ext:upp:v3:${cpid}`, (v) => v.estado === 'ok', async () =>
        unidadesDoProduto(await mlGet(`https://api.mercadolibre.com/products/${cpid}`, t)));
    },
    dimensoesDoPacote: (org, codigoPai, fator) => dimensoesDoKitVivo(admin, org, codigoPai, fator),
    catalogoCriadoEm: async (cpid) => {
      const t = await tokenML().catch(() => null);
      if (!t) return null;
      // Data do produto não muda: cacheia só a lida; null (falha) tenta na próxima análise.
      return emCache<string | null>(`ext:catcriado:v1:${cpid}`, (v) => v !== null, async () =>
        dataDoProduto(await mlGet(`https://api.mercadolibre.com/products/${cpid}`, t)));
    },
    vendedor: async (sellerId) => {
      const id = Number(sellerId);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const t = await tokenML().catch(() => null);
      if (!t) return null;
      // Cache de 24 h por vendedor dentro de buscarPerfilVendedor (compartilhado com Pulse/Viabilidade).
      const perfil = await buscarPerfilVendedor(t, id);
      return perfil ? vendedorDoPerfil(perfil) : null;
    },
  };
}

async function buscarSku(admin: SupabaseClient, orgId: string, termo: string) {
  const like = `%${escaparLike(termo)}%`;
  const base = () => admin.from('variacoes').select(SELECT_VARIACAO).eq('org_id', orgId)
    .order('atualizado_em', { ascending: false }).limit(50);
  // Consultas separadas: o termo nunca entra numa expressão `.or()` do PostgREST.
  const consultas = [base().ilike('codigo', like), base().ilike('nome', like)];
  if (/^\d{8,14}$/.test(termo)) consultas.push(base().in('gtin', formasGtin(termo)));
  const linhas: LinhaVariacao[] = [];
  for (const { data, error } of await Promise.all(consultas)) {
    falhou('buscar_sku', error);
    linhas.push(...((data ?? []) as LinhaVariacao[]));
  }
  const itens = deduplicarPorCodigo(linhas)
    .sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : -1)).slice(0, 10).map(itemBusca);
  return { itens };
}

/** Painel do catálogo (D-12, Task 23): ofertas + vencedor informado pelo ML + perfis + nossa participação. */
async function catalogo(admin: SupabaseClient, orgId: string, cpid: string, itemDaPagina: string | null): Promise<Disponivel<RespostaCatalogo>> {
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return SEM_CONEXAO;
  const token = await getValidAccessTokenConexao(conexao);
  const conta = String(conexao.contaExternaId);
  return emCache<Disponivel<RespostaCatalogo>>(chaveCatalogo(orgId, conta, cpid, itemDaPagina), (v) => v.estado === 'ok', async () => {
    const [produto, itens] = await Promise.all([
      mlGet(`${ML_API}/products/${cpid}`, token),
      mlGet(`${ML_API}/products/${cpid}/items?limit=100`, token),
    ]);
    // Falha de leitura das ofertas não vira "ninguém vende" (mesma trava do Pulse).
    if (itens === null) return { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' };
    const resultados = ((itens as { results?: unknown[] }).results ?? []) as { seller_id?: unknown; price?: unknown }[];
    const ids = perfisPrioritarios(resultados, vencedorDoCatalogo(produto, itens, itemDaPagina), Number(conta), MAX_PERFIS_CATALOGO);
    const nossa = extrairNossaOferta(itens, Number(conta));
    const [perfis, ptw] = await Promise.all([
      pool(5, ids, async (id) => [id, await buscarPerfilVendedor(token, id).then((p) => (p ? vendedorDoPerfil(p) : null)).catch(() => null)] as const),
      // Disputa da buy box do nosso anúncio (não a referência de /suggestions, ADR-0119 Errata 3).
      nossa ? mlGet(`${ML_API}/items/${nossa.item_id}/price_to_win?version=v2`, token).then(parsePrecoParaGanhar).catch(() => null) : null,
    ]);
    return {
      estado: 'ok',
      valor: montarCatalogo({ produto, itens, contaOrg: conta, perfis: new Map(perfis), ptw, coletadoEm: new Date().toISOString(), itemDaPagina }),
    };
  }, TTL_CATALOGO_S);
}

type Contexto = Awaited<ReturnType<typeof requireUserOrg>>;
type PedidoVinculo = Extract<Pedido, { acao: 'salvar_vinculo' | 'remover_vinculo' }>;

/** Escrita de vínculo. Em sessão de suporte: só escopo `full`, e toda tentativa vai para
 *  `support_audit_events` (ação, chave + variação, resultado) — ADR-0092. */
async function escreverVinculo(p: PedidoVinculo, admin: SupabaseClient, ctx: Contexto): Promise<unknown> {
  const { orgId, userId } = ctx;
  const alvo = (variacaoId: string | null) => ({
    type: `extensao_vinculo:${p.acao === 'salvar_vinculo' ? 'salvar' : 'remover'}`,
    id: `${p.chave.tipo}:${p.chave.valor}${variacaoId ? `:${variacaoId}` : ''}`,
  });
  let variacaoId = p.acao === 'salvar_vinculo' ? p.variacaoId : null;
  if (ctx.support && ctx.support.scope !== 'full') {
    await auditarOperacaoSuporte(admin, ctx, alvo(variacaoId), 'denied');
    throw new ErroExtensao('interno', 403); // mesmo 403 de antes (suporte só leitura tentando escrever)
  }
  try {
    if (p.acao === 'salvar_vinculo') {
      const { data, error } = await admin.from('variacoes').select('id').eq('id', p.variacaoId).eq('org_id', orgId).maybeSingle();
      falhou('salvar_vinculo', error);
      if (!data) throw new ErroExtensao('payload_invalido', 400); // variação de outra org (ou inexistente)
      const { error: e2 } = await admin.from('extensao_vinculos').upsert(
        { org_id: orgId, chave_tipo: p.chave.tipo, chave: p.chave.valor, variacao_id: p.variacaoId, criado_por: userId },
        { onConflict: 'org_id,chave_tipo,chave' },
      );
      falhou('salvar_vinculo', e2);
    } else {
      const { data, error } = await admin.from('extensao_vinculos').delete()
        .eq('org_id', orgId).eq('chave_tipo', p.chave.tipo).eq('chave', p.chave.valor).select('variacao_id');
      falhou('remover_vinculo', error);
      variacaoId = (data as { variacao_id: string }[] | null)?.[0]?.variacao_id ?? null;
    }
  } catch (e) {
    await auditarOperacaoSuporte(admin, ctx, alvo(variacaoId), 'failed')
      .catch((a) => console.error(`extensao: ${(a as Error).message}`)); // o erro da escrita é o que importa
    throw e;
  }
  await auditarOperacaoSuporte(admin, ctx, alvo(variacaoId), 'succeeded');
  return { ok: true };
}

async function executar(p: Pedido, admin: SupabaseClient, ctx: Contexto): Promise<unknown> {
  const { orgId, userId } = ctx;
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
    case 'salvar_vinculo':
    case 'remover_vinculo':
      return escreverVinculo(p, admin, ctx);
    case 'catalogo': {
      // Uma análise por chamada (inclusive cache), mesmo limite de 30/min (D-18).
      if (await redisIncrComTTL(chaveLimite(userId, new Date()), 120) > LIMITE_ANALISES_MIN) throw new ErroExtensao('limite', 429);
      const r = await catalogo(admin, orgId, p.catalogProductId, p.itemDaPagina);
      const { error } = await admin.rpc('extensao_registrar_uso', { p_org_id: orgId, p_user_id: userId, p_tipo: 'catalogo' });
      if (error) console.warn(`extensao_registrar_uso: ${error.message}`);
      return r;
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
    // Sessão primeiro: payload ruim não pode mascarar sessão expirada. Sempre `read` aqui: o escopo de
    // escrita do suporte é checado em escreverVinculo, onde a negação pode ser auditada.
    const ctx = await requireUserOrg(req);
    const { orgId } = ctx;
    const admin = adminClient();
    if (!(await exigirModulo(admin, orgId, 'extensao'))) throw new ErroExtensao('modulo_desligado', 403);
    const pedido = validarPedido(body);
    if (!pedido) throw new ErroExtensao('payload_invalido', 400);
    return json(await executar(pedido, admin, ctx));
  } catch (e) {
    const { status, corpo } = normalizarErro(e);
    if (status === 500) console.error(`extensao: ${(e as Error)?.message ?? e}`);
    return json(corpo, status);
  }
});
