import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio,
  AtualizacaoCanonica, ResultadoAtualizacao, StatusCanal, MetricasVendasCanal,
} from './contrato.ts';
import { lerVendasML } from '../ml/vendas.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { criarItemML, garantirDescricaoML, buscarDescricaoML, resolverDescricaoUpdate } from '../ml/criar-item.ts';
import { precisaItemPlano } from '../ml/erro-ml.ts';
import { categoriaExigeFamilyName } from '../categoria/atributos.ts';
import { buscarItemML, atualizarItemML, atualizarItemPlanoML, atualizarStatusML } from '../ml/atualizar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../ml/atualizar.ts';
import { montarAtributosPacote } from '../ml/pacote.ts';
import { parseStatusML, type ItemMLStatus } from '../ml/status.ts';
import { subirFotoML } from '../ml/fotos.ts';
import { aplicarPxQ, type FaixaAtacado } from '../ml/atacado.ts';
import { mapearVariacoesExternas, mapearVariacoesPorSku, classificarErroCanal } from './mapeamento.ts';
import { caparEstoque } from '../split/capar-estoque.ts';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ADR-0088: sinal (não erro do ML) de que a categoria é User Products (item plano/family_name)
// e a família tem >1 cor — a orquestração roteia para a saga que cria N itens separados.
function formatoIncompativel(categoriaId: string | null): ResultadoCanal<RefAnuncio> {
  return {
    ok: false,
    erro: {
      codigo: 'FORMATO_INCOMPATIVEL',
      mensagemOperador: `Categoria ${categoriaId ?? ''} exige item plano (User Products) e a família tem mais de uma cor — a publicação multi-item é feita pela saga (ADR-0088).`,
      retentavel: false,
    },
  };
}

export const mercadoLivreConnector: ChannelConnector = {
  id: 'mercado_livre',
  capabilities: {
    variacoes: true,
    descricaoSeparada: true,
    catalogo: true,
    desconto: true,
    atacado: true,
    dimensoesPacote: true,
  },

  async subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string> {
    const token = await ctx.getToken();
    return subirFotoML(token, sourceUrl);
  },

  async criarAnuncio(ctx: ContextoCanal, a: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>> {
    // ADR-0088 branch (a): categoria já conhecida estaticamente como UP (item plano) + >1 cor.
    // Recusa ANTES de qualquer rede — precisa vir antes de getToken/lerSchemaAtributos: nessa
    // categoria montar() lançaria síncrono (ml/publicar.ts) e um POST seria desperdiçado. O caso
    // de 1 cor NÃO entra aqui — segue pelo caminho normal (item plano direto, ADR-0084/0087).
    if (a.variacoes.length > 1 && categoriaExigeFamilyName(a.categoriaId)) {
      return formatoIncompativel(a.categoriaId);
    }
    const token = await ctx.getToken();
    // E4: descobre pelo schema se a categoria expõe EMPTY_GTIN_REASON (generaliza p/ vertical nova).
    // Falha de leitura → undefined → montarPayloadItem cai no helper hard-coded dos aviamentos.
    let aceitaEmptyGtin: boolean | undefined;
    try {
      const schema = await lerSchemaAtributos(token, a.categoriaId ?? '');
      if (schema.length) aceitaEmptyGtin = schema.some((s) => s.id === 'EMPTY_GTIN_REASON');
    } catch { /* fallback hard-coded */ }
    // Cap de estoque (ADR-0048): o ML rejeita anúncio cuja soma de available_quantity passa de
    // 99.999. No-op quando a soma cabe; senão capa as cores de maior estoque (estoque real intacto
    // no banco). Aplicado sobre o conjunto que vai ao ML — aqui, todas as variações do anúncio.
    const capCriar = caparEstoque(a.variacoes.map((v) => ({ sku: v.sku, estoque: v.estoque })));
    const familiaInput = { titulo_ml: a.titulo, descricao_ml: a.descricao, categoria_ml_id: a.categoriaId, atributos_ml: a.atributos };
    const variacoesInput = a.variacoes.map((v) => ({
      codigo: v.sku, cor: v.cor, estoque: capCriar.get(v.sku) ?? v.estoque,
      preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
    }));
    const montar = (formato?: 'plano') => montarPayloadItem(
      familiaInput, variacoesInput, a.capaFotoId, a.capa2FotoId, a.capa3FotoId,
      a.listingTypeId, a.desconto, a.dimensoes, aceitaEmptyGtin, formato,
    );
    // ADR-0087: as duas tentativas (seed da categoria + retry reativo) ficam dentro de UM
    // único try/catch — se a 2ª falhar (novo erro do ML, ou `montarPayloadItem` lançando na
    // reconstrução por >1 variação, ADR-0084) o catch final sempre devolve ResultadoCanal,
    // nunca deixa uma exceção escapar do conector.
    try {
      let r;
      try {
        r = await criarItemML(token, montar());
      } catch (e) {
        if (!precisaItemPlano((e as { status?: number }).status, (e as { mlCauses?: unknown }).mlCauses)) throw e;
        // ADR-0088 branch (b): assinatura UP exata (369+374) numa categoria nova + >1 cor →
        // recusa como retorno normal (nunca reconstrói N variações num item plano — cada SKU
        // vira seu próprio item pela saga). Retry de 1 cor do ADR-0087 abaixo fica INTOCADO.
        if (a.variacoes.length > 1) return formatoIncompativel(a.categoriaId);
        r = await criarItemML(token, montar('plano'));
      }
      // ADR-0084: item plano (categoria que exige family_name) não tem sub-recurso `variations`
      // — o próprio item É a variação única. Sem isso, variacoesExternas ficaria vazio e
      // variacoes.ml_variation_id nunca seria gravado pro SKU.
      const variacoesExternas = (r.variations.length === 0 && a.variacoes.length === 1)
        ? { [a.variacoes[0].sku]: r.id }
        : mapearVariacoesExternas(r.variations, a.variacoes);
      return {
        ok: true,
        valor: { itemExternoId: r.id, permalink: r.permalink, variacoesExternas },
      };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },

  async garantirDescricao(ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void> {
    const token = await ctx.getToken();
    await garantirDescricaoML(token, itemExternoId, descricao);
  },

  async aplicarAtacado(ctx: ContextoCanal, itemExternoId: string, precoBase: number, faixas: FaixaAtacado[]): Promise<void> {
    const token = await ctx.getToken();
    await aplicarPxQ(token, itemExternoId, precoBase, faixas);
  },

  async atualizarAnuncio(ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>> {
    const token = await ctx.getToken();
    try {
      // GET estado real → reenviar TODAS as variações (o ML deleta as omitidas).
      const atual = await buscarItemML(token, a.itemExternoId);
      // ADR-0084: item plano (categoria que exige family_name, ex. Zíperes) não tem sub-recurso
      // `variations` — o GET devolve []. montarVariacoesUpdate mapeando sobre lista vazia produz
      // um PUT `{variations: []}` que a ML aceita como no-op silencioso (confirmado empiricamente
      // 2026-07-20): sem erro, familia.status volta a 'publicado', mas nada muda no anúncio real.
      // Repõe direto no corpo raiz do item em vez de variations. Mesmo escopo do CREATE: só 1
      // variação por família nessa categoria — cor nova/múltiplas variações falha alto (o modelo
      // N-itens-por-família compartilhando family_name é redesenho maior, fora de escopo).
      if (atual.variations.length === 0 && a.existentes.length > 0) {
        if (a.existentes.length !== 1 || a.novas.length > 0) {
          const err = new Error(
            'Item plano (ADR-0084) com múltiplas cores ou cor nova — UPDATE não implementado para '
            + 'esse caso. Reponha manualmente no painel do Mercado Livre.',
          ) as Error & { status?: number };
          err.status = 400;
          throw err;
        }
        const [existente] = a.existentes;
        const estoqueDesejado = caparEstoque([{ sku: existente.sku, estoque: existente.estoque }]).get(existente.sku)
          ?? existente.estoque;
        const precoDesejado = a.somenteEstoque
          ? undefined
          : (a.desconto?.precoPorCodigo[existente.sku] ?? a.precoFamilia ?? undefined);
        // original_price nunca é enviado: a ML rejeita esse campo em item plano (mesma
        // validação real que bloqueou no CREATE, ADR-0084) — desconto não é suportado aqui.
        await atualizarItemPlanoML(token, a.itemExternoId, {
          available_quantity: estoqueDesejado,
          ...(precoDesejado != null ? { price: precoDesejado } : {}),
        });
        return {
          ok: true,
          valor: {
            variacoesExternas: { [existente.sku]: a.itemExternoId },
            precoVivo: atual.price,
          },
        };
      }
      // Cap de estoque (ADR-0048): teto sobre o conjunto enviado (existentes + novas) p/ a soma
      // do anúncio não passar de 99.999. No-op quando cabe. Estoque real intacto no banco.
      const capUpd = caparEstoque([...a.existentes, ...a.novas].map((v) => ({ sku: v.sku, estoque: v.estoque })));
      const desejados = a.existentes.map((e) => ({ codigo: e.sku, estoque: capUpd.get(e.sku) ?? e.estoque }));
      // Renomear cor de variação já publicada (ADR-0062): sku → cor desejada no banco.
      const corDesejadaPorCodigo: Record<string, string | null> = {};
      for (const e of a.existentes) corDesejadaPorCodigo[e.sku] = e.cor;
      // Fotos comuns (capa2/capa3) só entram ao CRIAR variação nova — a nova as referencia e o
      // ML exige que estejam em item.pictures. Em update SEM cor nova (reposição de estoque /
      // correção de nome), as variações existentes JÁ têm suas fotos no anúncio; reenviar
      // duplicaria, porque o id de upload cacheado difere do id re-hospedado pelo ML e o dedupe
      // por id nunca casa (bug lote #24/#25 — fotos CAPA2/CAPA3 acumulando). ADR-0062.
      const criandoNovas = a.novas.length > 0;
      // Preço vivo do anúncio (ADR-0078 F1): preço uniforme na F1 → price da 1ª variação viva.
      // Em "somente estoque" NÃO empurra preço por nenhum ramo; a cor nova entra neste preço.
      const precoVivo = atual.variations.find((v) => v.price != null)?.price ?? null;
      const existentes = montarVariacoesUpdate(
        atual.variations, desejados,
        undefined,
        a.somenteEstoque ? null : (a.desconto ?? undefined), a.somenteEstoque ? null : a.precoFamilia,
        corDesejadaPorCodigo, a.somenteEstoque,
      );
      const novasPut = a.novas.map((v) => montarVariacaoNova(
        { codigo: v.sku, cor: v.cor, estoque: capUpd.get(v.sku) ?? v.estoque, preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId },
        a.capaFotoId, a.capa2FotoId, a.capa3FotoId, a.categoriaId,
        a.somenteEstoque ? null : (a.desconto ? { pct: a.desconto.pct } : null),
        a.somenteEstoque ? precoVivo : undefined,
      ));
      // BRAND (do fornecedor) + dimensões/peso (SELLER_PACKAGE_*); só os passados — o ML mescla.
      const atributosItem = [
        ...(a.marca ? [{ id: 'BRAND', value_name: a.marca }] : []),
        ...(a.dimensoes ? montarAtributosPacote(a.dimensoes) : []),
      ];
      // Só reenvia item.pictures ao criar variação nova (a foto dela precisa estar no item).
      const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
      const pictures = criandoNovas
        ? [...new Set([...atual.pictures, ...novasPicIds])]
        : undefined;
      const resultado = await atualizarItemML(token, a.itemExternoId, [...existentes, ...novasPut], atributosItem, pictures);
      // O PUT nem sempre ecoa seller_custom_field nas variações criadas; o GET ecoa de forma
      // confiável — então relemos o item para casar as novas quando há cores novas.
      let varsParaCasar = resultado.variations;
      if (a.novas.length > 0) {
        const refetch = await buscarItemML(token, a.itemExternoId);
        varsParaCasar = refetch.variations;
      }
      return { ok: true, valor: { variacoesExternas: mapearVariacoesPorSku(varsParaCasar), precoVivo } };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },

  async sincronizarDescricao(ctx: ContextoCanal, itemExternoId: string, descricaoAtual: string, cores: string[]): Promise<string | null> {
    const token = await ctx.getToken();
    // Compara a descrição desejada (cores atualizadas + sanitizada) contra a ao vivo no ML
    // (GET grátis) e só dá push se diferir. Reposição pura de estoque → iguais → não reenvia.
    const live = await buscarDescricaoML(token, itemExternoId);
    const r = resolverDescricaoUpdate(descricaoAtual, cores, live);
    if (!r?.precisaPush) return null;
    await garantirDescricaoML(token, itemExternoId, r.novaDescricao);
    return r.novaDescricao !== descricaoAtual ? r.novaDescricao : null;
  },

  async lerStatus(ctx: ContextoCanal, ids: string[]): Promise<Record<string, StatusCanal>> {
    const token = await ctx.getToken();
    // Chunks em paralelo (latência O(1) em vez de O(n/20) serial).
    const respostas = await Promise.all(chunk(ids, 20).map(async (bloco) => {
      const url = `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,status,sub_status,available_quantity,price,listing_type_id`;
      try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) { console.warn(`lerStatus ML ${resp.status} (bloco)`); return []; }
        const arr = await resp.json(); // [{ code, body }]
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.warn('lerStatus ML falhou (bloco):', (e as Error).message);
        return [];
      }
    }));
    const porId = new Map<string, ItemMLStatus | null>();
    for (const entry of respostas.flat()) {
      const body = entry?.body;
      const id = body?.id;
      if (entry?.code === 200 && id) porId.set(id, body as ItemMLStatus);
      else if (id) porId.set(id, null);
    }
    const out: Record<string, StatusCanal> = {};
    for (const id of ids) out[id] = parseStatusML(porId.get(id) ?? null);
    return out;
  },

  async atualizarStatus(ctx: ContextoCanal, itemExternoId: string, status: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>> {
    const token = await ctx.getToken();
    try {
      await atualizarStatusML(token, itemExternoId, status === 'ativo' ? 'active' : 'paused');
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },

  async lerMetricasVendas(
    ctx: ContextoCanal,
    intervalo: { desde: string; ate: string },
    ids: string[],
    mapaGtin: Record<string, string> = {},
  ): Promise<MetricasVendasCanal> {
    const token = await ctx.getToken();
    return lerVendasML(token, intervalo, ids, mapaGtin);
  },
};
