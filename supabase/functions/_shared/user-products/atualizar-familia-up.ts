// ADR-0088 Fase 2 — UPDATE de uma família User Products (N itens filhos, um por cor). Orquestra a
// mini-saga de composição (atualizar-composicao.ts): monta as portas reais (Supabase + API do ML),
// roda a saga e mapeia o desfecho para a persistência (familias/raiz). Chamado por
// update-familia-ml/processar.ts quando a família tem linhas em `anuncios_externos_itens`.
//
// UPDATE UP é 100% GET-ao-vivo (não usa o cache de formato, ADR §"UPDATE permanece 100% GET"):
// a detecção de UP é a existência das linhas filhas; o family_id/status vêm por GET.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ChannelConnector, ContextoCanal, FaixaAtacado } from '../canais/contrato.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { buscarItemPorSku, buscarItemUP, type FetchLike } from '../ml/buscar-item.ts';
import { criarItemML } from '../ml/criar-item.ts';
import { atualizarStatusML, atualizarItemPlanoML } from '../ml/atualizar-item.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { enfileirarVinculacaoCatalogo } from '../queue.ts';
import { decidirRetryTransitorio } from '../publicacao/retry.ts';
import {
  atualizarComposicao, type PortasComposicao, type FilhoComp, type ConfirmacaoComp, type ResultadoComposicao,
} from './atualizar-composicao.ts';

const ITENS = 'anuncios_externos_itens';
const RAIZ = 'anuncios_externos';

export interface VariacaoUP {
  codigo: string; cor: string | null; estoque: number;
  preco_publicacao: number | string | null; gtin: string | null;
  imagem_path: string | null; ml_picture_id: string | null;
  altura_cm?: number | string | null; largura_cm?: number | string | null;
  comprimento_cm?: number | string | null; peso_gramas?: number | string | null;
}

export interface RaizUP { id: string; titulo: string | null; criado_em?: string | null }

export interface AtualizarFamiliaUPArgs {
  admin: SupabaseClient;
  conn: ChannelConnector;
  ctx: ContextoCanal;
  conexao: ConexaoCanal;
  familia: {
    id: string; org_id: string; codigo_pai: string;
    categoria_ml_id: string | null; descricao_ml: string | null; atributos_ml?: unknown;
    capa_ml_picture_id: string | null; capa2_ml_picture_id: string | null; capa3_ml_picture_id: string | null;
    atacado?: unknown; atacado_status?: string | null;
  };
  raiz: RaizUP;
  variacoes: VariacaoUP[];
  somenteEstoque: boolean;
  /** Nº de tentativas do QStash (orçamento de retry do desfecho `incompleto`, Fix 4b). */
  tentativas: number;
  /** Injetável em teste; produção usa a saga real. */
  executarSaga?: (portas: PortasComposicao, entrada: Parameters<typeof atualizarComposicao>[1]) => Promise<ResultadoComposicao>;
  now?: () => string;
}

export type ResultadoAtualizarUP =
  | { estado: 'ok'; adicionadas: number }
  | { estado: 'retry'; mensagem: string }
  | { estado: 'erro'; mensagem: string };

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

export async function atualizarFamiliaUP(args: AtualizarFamiliaUPArgs): Promise<ResultadoAtualizarUP> {
  const { admin, conn, ctx, conexao, familia, raiz, variacoes, somenteEstoque } = args;
  const executarSaga = args.executarSaga ?? atualizarComposicao;
  const now = args.now ?? (() => new Date().toISOString());
  const rootId = raiz.id;
  const familyName = raiz.titulo ?? '';
  // Fix 1: se a composição chegou a ligar mudando_composicao, qualquer exceção posterior (rede/
  // Supabase/etc.) precisa limpar a flag antes de propagar — senão o gate do caso 0 da agregação
  // esconde o erro pra sempre (família presa em `publicando`).
  let composicaoIniciada = false;

  const skusDesejados = variacoes.map((v) => v.codigo);
  const estoquePorSku: Record<string, number> = {};
  for (const v of variacoes) estoquePorSku[v.codigo] = v.estoque;
  const precoRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
  const precoFamilia = precoRaw != null ? Number(precoRaw) : null;

  // family_id esperado: das cores vivas (não-retiradas) já confirmadas — valida a cor nova.
  const { data: filhosRaw } = await admin.from(ITENS)
    .select('sku, status, retirado, item_externo_id, family_id').eq('anuncio_externo_id', rootId);
  const filhos = (filhosRaw ?? []) as Array<Record<string, unknown>>;
  const familyIdEsperado = (filhos.find((f) => !f.retirado && f.family_id != null)?.family_id as string | null) ?? null;
  const jaAtivos = new Set(filhos.filter((f) => !f.retirado && f.status === 'ativo' && f.item_externo_id).map((f) => f.sku as string));
  const adicionadas = skusDesejados.filter((sku) => !jaAtivos.has(sku)).length;

  // aceitaEmptyGtin: lido do schema da categoria (como o CREATE/publish faz) p/ a cor nova.
  let aceitaEmptyGtin: boolean | undefined;
  if (familia.categoria_ml_id) {
    try {
      const schema = await lerSchemaAtributos(await ctx.getToken(), familia.categoria_ml_id);
      if (schema.length) aceitaEmptyGtin = schema.some((s) => s.id === 'EMPTY_GTIN_REASON');
    } catch { /* fallback hard-coded do montarPayloadItem */ }
  }

  const criadoEm = raiz.criado_em ?? null;
  const desdeMs = criadoEm ? Date.parse(criadoEm) - 60 * 60 * 1000 : Date.now() - 24 * 60 * 60 * 1000;
  const fetchLike: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

  const BUCKET = 'imagens';
  const signed = async (path: string): Promise<string> => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 2);
    if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
    return data.signedUrl;
  };

  const varPorSku = new Map(variacoes.map((v) => [v.codigo, v]));
  const familiaInput = {
    titulo_ml: familyName, descricao_ml: familia.descricao_ml,
    categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml,
  };
  // criarPlano: mesma disciplina de foto do caminho Legacy `novas` — sobe a foto da cor nova
  // (idempotente via ml_picture_id), depois monta o payload plano com o family_name da partição.
  const criarPlano = async (sku: string): Promise<{ itemExternoId: string; permalink: string }> => {
    const v = varPorSku.get(sku)!;
    let picId = v.ml_picture_id;
    if (!picId && v.imagem_path) {
      picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
      await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', familia.id).eq('codigo', sku);
    }
    const dimensoes = {
      altura_cm: num(v.altura_cm), largura_cm: num(v.largura_cm),
      comprimento_cm: num(v.comprimento_cm), peso_gramas: num(v.peso_gramas),
    };
    const payload = montarPayloadItem(
      familiaInput as never,
      [{ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: num(v.preco_publicacao), gtin: v.gtin, ml_picture_id: picId }] as never,
      familia.capa_ml_picture_id, familia.capa2_ml_picture_id, familia.capa3_ml_picture_id,
      undefined, null, dimensoes, aceitaEmptyGtin, 'plano',
    );
    const r = await criarItemML(await ctx.getToken(), payload);
    return { itemExternoId: r.id, permalink: r.permalink };
  };

  const atualizarLinha = async (sku: string, patch: Record<string, unknown>) => {
    const { error } = await admin.from(ITENS).update(patch).eq('anuncio_externo_id', rootId).eq('sku', sku);
    if (error) throw new Error(`${ITENS} update (${sku}): ${error.message}`);
  };

  const portas: PortasComposicao = {
    async listar() {
      const { data, error } = await admin.from(ITENS)
        .select('sku, status, retirado, item_externo_id, family_id').eq('anuncio_externo_id', rootId);
      if (error) throw new Error(`${ITENS} select: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>): FilhoComp => ({
        sku: r.sku as string, status: r.status as FilhoComp['status'],
        retirado: (r.retirado as boolean) ?? false,
        itemExternoId: (r.item_externo_id as string | null) ?? null,
        familyId: (r.family_id as string | null) ?? null,
      }));
    },
    async iniciarComposicao(skusEsperados) {
      composicaoIniciada = true;
      const { error } = await admin.from(RAIZ)
        .update({ skus_esperados: skusEsperados, mudando_composicao: true }).eq('id', rootId);
      if (error) throw new Error(`${RAIZ} iniciarComposicao: ${error.message}`);
    },
    async limparComposicao() {
      const { error } = await admin.from(RAIZ).update({ mudando_composicao: false }).eq('id', rootId);
      if (error) throw new Error(`${RAIZ} limparComposicao: ${error.message}`);
    },
    async reservar(sku) {
      const { error } = await admin.from(ITENS).upsert(
        [{ anuncio_externo_id: rootId, org_id: familia.org_id, sku, status: 'pendente' }],
        { onConflict: 'anuncio_externo_id,sku', ignoreDuplicates: true },
      );
      if (error) throw new Error(`${ITENS} reservar (${sku}): ${error.message}`);
    },
    salvarStatus: (sku, status) => atualizarLinha(sku, { status }),
    salvarCriado: (sku, itemExternoId) => atualizarLinha(sku, { item_externo_id: itemExternoId, status: 'criado' }),
    salvarConfirmacao: (sku, dados) => atualizarLinha(sku, {
      family_id: dados.familyId, user_product_id: dados.userProductId ?? null, permalink: dados.permalink ?? null,
    }),
    marcarAtivo: (sku) => atualizarLinha(sku, { status: 'ativo', retirado: false }),
    marcarRetirado: (sku) => atualizarLinha(sku, { status: 'pausado', retirado: true }),
    buscarPorSku: (sku) => ctx.getToken().then((accessToken) =>
      buscarItemPorSku(fetchLike, {
        accessToken, sellerId: conexao.contaExternaId ?? '',
        categoriaId: familia.categoria_ml_id ?? '', familyName, desdeMs,
      }, sku)),
    criarPlano,
    async confirmar(itemExternoId): Promise<ConfirmacaoComp> {
      const item = await buscarItemUP(fetchLike, { accessToken: await ctx.getToken() }, itemExternoId);
      const sellerEsperado = conexao.contaExternaId ?? '';
      // GET falhou (404/erro/null) → transiente (ok:false, retentável).
      if (!item) return { ok: false, status: null };
      // GET SUCEDEU mas é o item ERRADO (outro vendedor) → estado remoto inesperado, TERMINAL (Fix 4a).
      if (item.sellerId != null && item.sellerId !== sellerEsperado) {
        return { ok: false, status: item.status, inesperado: true };
      }
      // family_id ainda não computado pelo ML (lag conhecido de UP) → transiente, retoma no retry.
      if (!item.familyId) return { ok: false, status: item.status };
      return { ok: true, status: item.status, familyId: item.familyId, userProductId: item.userProductId, permalink: item.permalink };
    },
    ativar: (itemExternoId) => ctx.getToken().then((t) => atualizarStatusML(t, itemExternoId, 'active')),
    pausar: (itemExternoId) => ctx.getToken().then((t) => atualizarStatusML(t, itemExternoId, 'paused')),
    repor: (itemExternoId, patch) => ctx.getToken().then((t) => atualizarItemPlanoML(t, itemExternoId, patch)),
  };

  // ── efeitos pós-composição (Fix 5) ──────────────────────────────────────────────────────────
  const efeitosPosComposicao = async (criadas: string[], houveMudanca: boolean): Promise<void> => {
    // Catálogo (ADR-0021/0088 F2): só quando entrou cor GENUINAMENTE nova. Readd preserva
    // catalog_product_id/catalog_listing_id (marcarRetirado não os limpa; carregarFilhosCatalogoUP
    // filtra retirado=false, reincluindo no readd) e o worker é idempotente — logo readd não precisa
    // de novo opt-in. Best-effort.
    if (criadas.length > 0) {
      try { await enfileirarVinculacaoCatalogo(familia.id); }
      catch (e) { console.error(`enfileirar catálogo UP (update) falhou (${familia.id}):`, e); }
    }
    if (!houveMudanca) return; // sem_mudanca (reposição pura) → nada de descrição/atacado.

    // Itens finais ativos (cada cor UP é um anúncio ML separado → efeitos POR item). Erro aqui é
    // best-effort (mesmo espírito dos demais passos desta função): loga e segue com lista vazia em
    // vez de derrubar a publicação já concluída da composição.
    const { data: finaisRaw, error: finaisErr } = await admin.from(ITENS)
      .select('sku, item_externo_id, retirado, status').eq('anuncio_externo_id', rootId);
    if (finaisErr) console.error(`efeitosPosComposicao: itens finais falhou (${rootId}):`, finaisErr.message);
    const finais = ((finaisRaw ?? []) as Array<Record<string, unknown>>)
      .filter((f) => !f.retirado && f.status === 'ativo' && f.item_externo_id)
      .map((f) => f.item_externo_id as string);

    // Descrição (recurso separado): a lista de cores mudou → re-sincroniza em cada item. Idempotente.
    if (conn.capabilities.descricaoSeparada && familia.descricao_ml) {
      for (const id of finais) {
        try { await conn.garantirDescricao(ctx, id, familia.descricao_ml); }
        catch (e) { console.error(`descrição UP (update) falhou (${id}):`, e); }
      }
    }

    // Atacado/PxQ: espelha a condição EXATA do Legacy (processar.ts) — reaplica com faixas
    // configuradas OU limpa (envia faixas vazias) quando já estava aplicado e as faixas somem;
    // atualiza atacado_status/atacado_erro (o caminho UP anterior nunca tocava esses campos).
    if (!somenteEstoque && conn.capabilities.atacado) {
      const faixas = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      const jaAplicado = familia.atacado_status === 'aplicado';
      const aplicandoFaixas = faixas.length > 0;
      if (aplicandoFaixas || jaAplicado) {
        if (aplicandoFaixas && precoFamilia == null) {
          const m = 'Atacado sem preço-base: sem preço novo nem preço vivo conhecido';
          await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', familia.id);
        } else {
          let ok = true;
          for (const id of finais) {
            try { await conn.aplicarAtacado(ctx, id, precoFamilia ?? 0, faixas); }
            catch (e) { ok = false; console.error(`atacado UP (update) falhou (${id}):`, e); }
          }
          await admin.from('familias')
            .update(ok ? { atacado_status: aplicandoFaixas ? 'aplicado' : null, atacado_erro: null }
              : { atacado_status: 'erro', atacado_erro: 'Falha ao aplicar atacado em uma ou mais cores' })
            .eq('id', familia.id);
        }
      }
    }
  };

  let resultado: ResultadoComposicao;
  try {
    resultado = await executarSaga(portas, {
      skusDesejados, estoquePorSku, precoFamilia, somenteEstoque, familyIdEsperado,
    });
  } catch (e) {
    // Fix 1: exceção não tratada com a composição já iniciada — limpa a flag (best-effort, nunca
    // falha por causa disso) ANTES de re-propagar. Deliberadamente NÃO marca filhos `erro`: um erro
    // transitório é retentável (o worker aplica o orçamento) e marcar `erro` bloquearia o próprio
    // retry que resolveria (Fix 2 recusa reativar filho terminal). Re-lança para o worker decidir.
    if (composicaoIniciada) {
      // Best-effort real: Supabase resolve com {error} em vez de rejeitar a Promise em muitas
      // falhas — checar e logar o error é o que torna essa tentativa de limpeza observável (revisão
      // v3). Não há como GARANTIR a limpeza sem um outbox/transação; isso pelo menos não a esconde.
      const { error: errLimpar } = await admin.from(RAIZ).update({ mudando_composicao: false }).eq('id', rootId)
        .then((r: { error: { message: string } | null }) => r, (err: unknown) => ({ error: { message: String(err) } }));
      if (errLimpar) console.error(`limpar mudando_composicao (catch) falhou (${rootId}):`, errLimpar.message);
    }
    throw e;
  }

  if (resultado.tipo === 'sem_mudanca' || resultado.tipo === 'concluido') {
    const criadas = resultado.tipo === 'concluido' ? resultado.criadas : [];
    // Fix 5: efeitos que o UPDATE Legacy já faz — best-effort, não derrubam o desfecho ok.
    await efeitosPosComposicao(criadas, resultado.tipo === 'concluido');
    await admin.from('familias').update({ status: 'publicado', publicado_em: now() }).eq('id', familia.id);
    return { estado: 'ok', adicionadas };
  }
  if (resultado.tipo === 'incompleto') {
    // Fix 4b: transiente por confirmação-por-GET não fechada. Enquanto houver orçamento de retry,
    // persiste (flag fica ligada, família 'publicando') e a próxima execução retoma. Esgotado o
    // orçamento, converte para erro terminal VISÍVEL (senão retentaria pra sempre um 404/deletado)
    // — e limpa a flag, senão o gate do caso 0 esconderia o erro pra sempre.
    if (decidirRetryTransitorio({ retentavel: true }, args.tentativas) === 'retentar') {
      return { estado: 'retry', mensagem: 'Mudança de composição em andamento — retomando.' };
    }
    const { error: errLimpar } = await admin.from(RAIZ).update({ mudando_composicao: false }).eq('id', rootId)
      .then((r: { error: { message: string } | null }) => r, (err: unknown) => ({ error: { message: String(err) } }));
    if (errLimpar) console.error(`limpar mudando_composicao (incompleto esgotado) falhou (${rootId}):`, errLimpar.message);
    const m = 'UPDATE não convergiu: a confirmação por GET não fechou após várias tentativas (item deletado, outro vendedor ou 404 persistente). Intervenção manual necessária.';
    await admin.from('familias').update({ status: 'erro', erro_mensagem: m }).eq('id', familia.id);
    return { estado: 'erro', mensagem: m };
  }
  // erro terminal (family_id divergente, busca ambígua, item errado, filho em estado terminal).
  const msg = resultado.codigo === 'familia_up_desagrupada'
    ? 'UPDATE bloqueado: o Mercado Livre agrupou a cor nova numa família diferente (family_id divergente). Intervenção manual necessária.'
    : resultado.codigo === 'busca_ambigua'
      ? 'UPDATE bloqueado: busca por SKU ambígua/truncada ao adotar item existente. Intervenção manual necessária.'
      : resultado.codigo === 'estado_remoto_inesperado'
        ? 'UPDATE bloqueado: estado remoto inesperado ao confirmar um item (deletado/404/outro vendedor). Intervenção manual necessária.'
        : `UPDATE bloqueado: a cor ${resultado.sku} está em estado '${resultado.status}', que exige intervenção manual (erro/compensação pendente/remoção pendente/pausada administrativamente) antes de adicionar/repor. Resolva essa cor no ML e tente de novo.`;
  await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', familia.id);
  return { estado: 'erro', mensagem: msg };
}
