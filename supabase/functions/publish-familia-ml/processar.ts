// Miolo testável do worker `publish-familia-ml` (extraído do Deno.serve). Publica UMA família
// no Mercado Livre (CREATE) e — ADR-0088 — roteia famílias multi-cor em categorias User Products
// (item plano) para a saga `publicarFamiliaUP`. O caminho de 1 cor e o multi-cor Legacy ficam
// EXATAMENTE como antes (retry de 1 cor do ADR-0087 intocado).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import type { ChannelConnector } from '../_shared/canais/contrato.ts';
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
import { atributosFaltantes, categoriaParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarAnuncioCanonico } from '../_shared/anuncios/montar-canonico.ts';
import { garantirPrecoUniforme } from '../_shared/preco/grupos.ts';
import { decidirErroCriarAnuncio, mensagemErroFotoRecuperavel, decidirRetryTransitorio } from '../_shared/publicacao/retry.ts';
import { enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import {
  lerFormatoPublicacao, confirmarFormatoPublicacao, formatoRepoSupabase, type FormatoRepo,
} from '../_shared/ml/formato-publicacao.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { publicarFamiliaUP, type PublicarFamiliaUPArgs, type ResultadoUP } from '../_shared/user-products/publicar-familia-up.ts';

export interface Job { familia_id: string; lote_id: string; listing_type_id?: string; }

export type ResultadoProcessar =
  | { tipo: 'familia_inexistente' }
  | { tipo: 'ja_publicado' }
  | { tipo: 'ok'; itemExternoId: string }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'retry'; mensagem: string };

export interface ProcessarDeps {
  admin: SupabaseClient;
  conn: ChannelConnector;
  /** Injetáveis em teste; produção usa os reais. */
  formatoRepo?: FormatoRepo;
  publicarUP?: (args: PublicarFamiliaUPArgs) => Promise<ResultadoUP>;
  finalizarLote?: (loteId: string) => Promise<void>;
}
export interface ProcessarOpts { tentativas: number }

// Reavalia o status do lote quando o worker some da fila (sucesso ou erro definitivo).
// Sem famílias 'publicando' → 'concluido', ou 'revisao' se ainda restam publicáveis ('pronto').
export async function talvezFinalizarLote(admin: SupabaseClient, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

export async function processarFamiliaML(deps: ProcessarDeps, job: Job, opts: ProcessarOpts): Promise<ResultadoProcessar> {
  const { admin, conn } = deps;
  const formatoRepo = deps.formatoRepo ?? formatoRepoSupabase(admin);
  const publicarUP = deps.publicarUP ?? publicarFamiliaUP;
  const finalizarLote = deps.finalizarLote ?? ((loteId: string) => talvezFinalizarLote(admin, loteId));
  const { tentativas } = opts;

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return { tipo: 'familia_inexistente' };

  const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
  const ctx = {
    getToken: () => conexao
      ? getValidAccessTokenConexao(conexao)
      : Promise.reject(new Error('Organização sem conexão com o Mercado Livre')),
  };

  if (familia.ml_item_id) {
    // Já publicado: garante só a descrição (recurso separado pode ter faltado antes).
    if (familia.descricao_ml) {
      try {
        await conn.garantirDescricao(ctx, familia.ml_item_id, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição (retry) falhou para ${familia.ml_item_id}:`, e);
      }
    }
    // Atacado (PxQ): garante a aplicação se há faixas e ainda não aplicado (retry/idempotência).
    try {
      const faixasJa = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (faixasJa.length > 0 && familia.atacado_status !== 'aplicado') {
        const { data: vs } = await admin.from('variacoes')
          .select('preco_publicacao').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
        const baseRaw = vs?.find((v) => v.preco_publicacao != null)?.preco_publicacao;
        const base = baseRaw != null ? Number(baseRaw) : null;
        if (base != null) {
          try {
            await conn.aplicarAtacado(ctx, familia.ml_item_id, base, faixasJa);
            await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado (retry) falhou para ${familia.ml_item_id}:`, m);
            await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
          }
        } else {
          console.warn('atacado (retry): sem preco_publicacao nas variacoes para familia', job.familia_id);
        }
      }
    } catch (e) {
      console.error('atacado (bloco retry) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
    }
    return { tipo: 'ja_publicado' };
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    // ADR-0078 F2 (invariante #1): este worker publica preço único. Divergência aqui = bug de
    // roteamento (deveria ter ido ao split) → LOUD, nada é enviado ao ML. Roda SEMPRE — inclusive
    // no caminho UP (o gate financeiro nunca pode ser pulado pelo atalho de cache).
    garantirPrecoUniforme(variacoes, 'CREATE');

    // Gate de atributos obrigatórios. Aviamento conhecido (override) → validador por-tipo (atual);
    // categoria prevista/manual → lista genérica persistida (E3/E4, schema da API); sem categoria → bloqueia.
    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = categoriaParaTipo(tipoAviamento) != null
      ? atributosFaltantes(tipoAviamento, familia.atributos_ml ?? [])
      : (familia.categoria_ml_id ? ((familia.atributos_faltantes as string[] | null) ?? []) : ['CATEGORIA']);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const anuncio = await montarAnuncioCanonico(admin, conn, ctx, familia, variacoes, job.listing_type_id);

    // ── ADR-0088: roteamento multi-cor User Products ────────────────────────────────────────
    // Só multi-cor (>1 variação) com categoria conhecida e conexão resolvida entra em jogo — o
    // caso de 1 cor e o multi-cor Legacy seguem pelo caminho de sempre (retry ADR-0087 intocado).
    const categoria = anuncio.categoriaId;
    const podeUP = anuncio.variacoes.length > 1 && !!categoria && !!conexao;

    // Dispara a saga UP e mapeia o desfecho. publicarFamiliaUP já persiste familias/variacoes/raiz
    // e marca 'publicado' só quando TODAS as cores ficam ativas; aqui só finaliza o lote + resposta.
    const rotaSagaUP = async (): Promise<ResultadoProcessar> => {
      // aceitaEmptyGtin: mesma leitura de schema do conector (o fallback hard-coded dos aviamentos
      // pode devolver false p/ uma categoria UP recém-detectada → EMPTY_GTIN_REASON omitido → POST falha).
      let aceitaEmptyGtin: boolean | undefined;
      try {
        const schema = await lerSchemaAtributos(await ctx.getToken(), categoria!);
        if (schema.length) aceitaEmptyGtin = schema.some((s) => s.id === 'EMPTY_GTIN_REASON');
      } catch { /* fallback hard-coded do montarPayloadItem */ }
      const r = await publicarUP({ admin, conn, ctx, conexao: conexao!, familia, anuncio, categoriaId: categoria!, aceitaEmptyGtin });
      await finalizarLote(job.lote_id);
      if (r.estado === 'ativo') return { tipo: 'ok', itemExternoId: r.itemExternoId };
      return { tipo: 'erro', mensagem: r.mensagem };
    };

    // Cache hit `user_products`: pula a tentativa `variations` de vez (zero POST desperdiçado, §3).
    if (podeUP && (await lerFormatoPublicacao(formatoRepo, conexao!.id, categoria!)) === 'user_products') {
      return await rotaSagaUP();
    }

    const res = await conn.criarAnuncio(ctx, anuncio);
    if (!res.ok) {
      const e = res.erro!;
      // ADR-0088: o ML rejeitou o payload `variations` numa categoria UP multi-cor. Decisão:
      // CONFIRMAR o cache SEMPRE que FORMATO_INCOMPATIVEL vier. O conector só emite esse código em
      // dois pontos — categoria já no Set estático do ADR-0084, ou assinatura reativa 369+374 —, e
      // ambos são sinais legítimos de UP. Confirmar sempre é mais simples e nunca gera dado errado:
      // o pior caso (categoria do Set) é semear um cache já correto e poupar 1 POST futuro.
      if (e.codigo === 'FORMATO_INCOMPATIVEL' && podeUP) {
        await confirmarFormatoPublicacao(formatoRepo, conexao!.id, categoria!, 'user_products');
        return await rotaSagaUP();
      }
      if (e.codigo === 'DESCONTO_INCOMPATIVEL') {
        if (conexao && categoria) {
          await confirmarFormatoPublicacao(formatoRepo, conexao.id, categoria, 'user_products');
        }
        const msg = e.mensagemOperador;
        await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
        await finalizarLote(job.lote_id);
        return { tipo: 'erro', mensagem: msg };
      }
      // item.pictures.unavailable: a foto recém-subida ainda propaga no ML (~2,5 min, medido no
      // lote #31). NÃO re-subimos nem limpamos o picture_id; reusamos o mesmo id e retentamos via
      // QStash. Só marca 'erro' visível quando esgotam os retries.
      if (decidirErroCriarAnuncio(e, tentativas) === 'retentar') {
        return { tipo: 'retry', mensagem: e.mensagemOperador };
      }
      const msg = e.codigo === 'FOTO' ? mensagemErroFotoRecuperavel(e.mensagemOperador) : e.mensagemOperador;
      await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
      await finalizarLote(job.lote_id);
      return { tipo: 'erro', mensagem: msg };
    }
    const ref = res.valor!;

    const { error: upErr } = await admin.from('familias').update({
      ml_item_id: ref.itemExternoId,
      ml_permalink: ref.permalink,
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);
    if (upErr) {
      console.error(`CRÍTICO: item ${ref.itemExternoId} criado no ML mas falhou ao persistir: ${upErr.message}`);
    }

    if (familia.descricao_ml) {
      try {
        await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição falhou para ${ref.itemExternoId}:`, e);
      }
    }

    const precoEnviadoPorSku = new Map(anuncio.variacoes.map((v) => [v.sku, v.preco]));
    for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
      const precoSku = precoEnviadoPorSku.get(codigo);
      const patch: { ml_variation_id: string; preco_publicado_ml?: number } = { ml_variation_id: variationId };
      if (precoSku != null) patch.preco_publicado_ml = Number(precoSku);
      await admin.from('variacoes').update(patch)
        .eq('familia_id', job.familia_id).eq('codigo', codigo);
    }

    try {
      const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (faixasAtacado.length > 0) {
        const baseRaw = anuncio.variacoes.find((v) => v.preco != null)?.preco;
        const base = baseRaw != null ? Number(baseRaw) : null;
        if (base != null) {
          try {
            await conn.aplicarAtacado(ctx, ref.itemExternoId, base, faixasAtacado);
            await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado falhou para ${ref.itemExternoId}:`, m);
            await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
          }
        }
      }
    } catch (e) {
      console.error('atacado (bloco criacao) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
    }

    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo falhou para ${ref.itemExternoId}:`, e);
    }

    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      org_id: familia.org_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: ref.itemExternoId,
      ml_permalink: ref.permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);

    await finalizarLote(job.lote_id);
    return { tipo: 'ok', itemExternoId: ref.itemExternoId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    // Transitório enquanto houver tentativa do QStash: relança (mantém 'publicando'); ao esgotar
    // vira definitivo. Mesma decisão dos workers irmãos.
    if (decidirRetryTransitorio(err, tentativas) === 'retentar') {
      return { tipo: 'retry', mensagem: msg };
    }
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: retentavelFoto ? mensagemErroFotoRecuperavel(msg) : msg,
    }).eq('id', job.familia_id);
    await finalizarLote(job.lote_id);
    return { tipo: 'erro', mensagem: msg };
  }
}
