import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio,
  AtualizacaoCanonica, ResultadoAtualizacao, StatusCanal, MetricasVendasCanal,
  EstoquePorSku,
} from './contrato.ts';
import { lerVendasML } from '../ml/vendas.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { criarItemML, garantirDescricaoML, buscarDescricaoML, resolverDescricaoUpdate } from '../ml/criar-item.ts';
import { precisaItemPlano, precisaGtinDePack } from '../ml/erro-ml.ts';
import { categoriaExigeFamilyName } from '../categoria/atributos.ts';
import { buscarItemML, atualizarItemML, atualizarItemPlanoML, atualizarStatusML } from '../ml/atualizar-item.ts';
import { motivoAnuncioNaoAtualizavel, subStatusMorto } from '../ml/anuncio-atualizavel.ts';
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

// ADR-0104: sinal (não erro do ML) de que o GET ao vivo encontrou a família como item User
// Products — o ML migra categorias sozinho, em anúncios já publicados. A orquestração adota os
// itens irmãos por SKU e roteia para a saga UP. Simétrico ao FORMATO_INCOMPATIVEL do CREATE.
function migradoParaUP(
  atual: { familyId: string | null; familyName: string | null; sellerId: string | null },
): ResultadoCanal<ResultadoAtualizacao> {
  return {
    ok: false,
    erro: {
      codigo: 'MIGRADO_PARA_UP',
      mensagemOperador: 'Anúncio no modelo User Products do Mercado Livre com mais de uma cor — '
        + 'a atualização é feita item a item (ADR-0088/0104).',
      retentavel: false,
      up: { familyId: atual.familyId, familyName: atual.familyName, sellerId: atual.sellerId },
    },
  };
}

// ADR-0105: o ML DISSOLVEU a família — fechou o item Legacy e criou N itens novos sob um family_id.
// O item morto não guarda family_id/family_name/parent_item_id: nada aponta para o sucessor. O que
// dá para levar daqui é o título (âncora da busca), a categoria (filtro), e o mapa sku→cor lido das
// variações do item morto — a ÚNICA fonte em que o ML escreveu SKU e cor lado a lado.
function dissolvidoParaUP(
  atual: { titulo: string | null; categoriaId: string | null; sellerId: string | null;
    variations: Array<{ seller_custom_field?: string | null; cor?: string | null }> },
  motivoFallback: string,
): ResultadoCanal<ResultadoAtualizacao> {
  const corPorSku: Record<string, string> = {};
  for (const v of atual.variations) {
    if (v.seller_custom_field && v.cor) corPorSku[v.seller_custom_field] = v.cor;
  }
  return {
    ok: false,
    erro: {
      codigo: 'MIGRADO_PARA_UP',
      mensagemOperador: 'Anúncio encerrado no Mercado Livre — verificando se foi migrado para o '
        + 'modelo User Products (ADR-0105).',
      retentavel: false,
      up: {
        familyId: null,
        familyName: null,
        sellerId: atual.sellerId,
        dissolvido: { titulo: atual.titulo, categoriaId: atual.categoriaId, corPorSku, motivoFallback },
      },
    },
  };
}

function descontoIncompativel(): ResultadoCanal<RefAnuncio> {
  return {
    ok: false,
    erro: {
      codigo: 'DESCONTO_INCOMPATIVEL',
      mensagemOperador: 'User Products não aceita desconto apenas visual; desmarque a opção de desconto para publicar.',
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
    atualizarEstoque: true,
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
    if (a.desconto && categoriaExigeFamilyName(a.categoriaId)) {
      return descontoIncompativel();
    }
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
    // `comGtinPack`: só o retry do kit usa — reenvia as variações sem código próprio com o GTIN
    // da unidade-base (ADR-0151 D-5 revisada). Variação que JÁ tem GTIN não é tocada.
    const montar = (formato?: 'plano', comGtinPack?: boolean) => montarPayloadItem(
      familiaInput,
      comGtinPack
        ? variacoesInput.map((v) => ({ ...v, gtin: v.gtin ?? a.gtinPackFallback ?? null }))
        : variacoesInput,
      a.capaFotoId, a.capa2FotoId, a.capa3FotoId,
      a.listingTypeId, a.desconto, a.dimensoes, aceitaEmptyGtin, formato,
    );
    // ADR-0087: as duas tentativas (seed da categoria + retry reativo) ficam dentro de UM
    // único try/catch — se a 2ª falhar (novo erro do ML, ou `montarPayloadItem` lançando na
    // reconstrução por >1 variação, ADR-0084) o catch final sempre devolve ResultadoCanal,
    // nunca deixa uma exceção escapar do conector.
    // Uma tentativa num formato, com o retry de GTIN embutido (ADR-0151 D-5 revisada): a categoria
    // que exige GTIN de verdade só se revela na resposta do ML, então reagimos a ela em vez de
    // manter lista de categorias. Sem `gtinPackFallback` (todo produto que não é kit) nada muda.
    const tentar = async (formato?: 'plano') => {
      try {
        return await criarItemML(token, montar(formato));
      } catch (e) {
        if (!a.gtinPackFallback) throw e;
        if (!precisaGtinDePack((e as { status?: number }).status, (e as { mlCauses?: unknown }).mlCauses)) throw e;
        return await criarItemML(token, montar(formato, true));
      }
    };
    try {
      let r;
      try {
        r = await tentar();
      } catch (e) {
        if (!precisaItemPlano((e as { status?: number }).status, (e as { mlCauses?: unknown }).mlCauses)) throw e;
        if (a.desconto) return descontoIncompativel();
        // ADR-0088 branch (b): assinatura UP exata (369+374) numa categoria nova + >1 cor →
        // recusa como retorno normal (nunca reconstrói N variações num item plano — cada SKU
        // vira seu próprio item pela saga). Retry de 1 cor do ADR-0087 abaixo fica INTOCADO.
        if (a.variacoes.length > 1) return formatoIncompativel(a.categoriaId);
        r = await tentar('plano');
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
      // Anúncio morto (closed/inactive/deleted) recusa qualquer PUT — e o erro cru do ML
      // ("variations is not modifiable... Revise os atributos da categoria") aponta o operador
      // para o lugar errado. Falha alto com a causa certa, antes de gastar a escrita. Lote #45.
      const motivoMorto = motivoAnuncioNaoAtualizavel(atual);
      if (motivoMorto) {
        // ADR-0105: `status` terminal SEM sub_status de remoção é ambíguo — é também o estado em
        // que o ML deixa o item Legacy ao dissolver a família em User Products. Sinaliza tipado
        // (a orquestração procura a família sucessora); se não achar, ela lança `motivoMorto`
        // intacto. `deleted`/`forbidden` provam remoção e continuam falhando aqui, sem gastar
        // busca nenhuma na fila serial (parallelism=1, ADR-0034).
        if (!subStatusMorto(atual) && a.existentes.length > 0) {
          return dissolvidoParaUP(atual, motivoMorto);
        }
        // 400 = definitivo: retentar não ressuscita anúncio removido (o QStash pararia de tentar
        // só depois de 10 retries × 30s, atrasando o resto da fila serial à toa).
        const err = new Error(motivoMorto) as Error & { status?: number };
        err.status = 400;
        throw err;
      }
      // ADR-0084: item plano (categoria que exige family_name, ex. Zíperes) não tem sub-recurso
      // `variations` — o GET devolve []. montarVariacoesUpdate mapeando sobre lista vazia produz
      // um PUT `{variations: []}` que a ML aceita como no-op silencioso (confirmado empiricamente
      // 2026-07-20): sem erro, familia.status volta a 'publicado', mas nada muda no anúncio real.
      // Repõe direto no corpo raiz do item em vez de variations. O caminho de 1 cor SEM cor nova
      // fica aqui; multi-cor / cor nova é o modelo N-itens-por-família (ADR-0088), roteado pela
      // orquestração via MIGRADO_PARA_UP (ADR-0104) em vez de falhar.
      if (atual.variations.length === 0 && a.existentes.length > 0) {
        if (a.existentes.length !== 1 || a.novas.length > 0) {
          // ADR-0104: `variations: []` + family_name = item User Products. Ou o ML migrou esta
          // família (que foi publicada como Legacy) sozinho, ou é um item plano do ADR-0084 ao
          // qual a planilha soma uma cor. Nos dois casos o destino é o mesmo — a orquestração
          // adota os itens irmãos por SKU e entrega à saga UP. Sinal tipado, não exceção:
          // simétrico ao FORMATO_INCOMPATIVEL do CREATE (ADR-0088 §3).
          if (atual.familyName) return migradoParaUP(atual);
          // Sem family_name não sabemos o que é um item plano assim — falha alto, nunca adivinha.
          const err = new Error(
            'Item plano sem family_name com múltiplas cores ou cor nova — UPDATE não implementado '
            + 'para esse caso. Reponha manualmente no painel do Mercado Livre.',
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

  // E6b (ADR-0094): push de estoque por VALOR ABSOLUTO, sem passar pelo pipeline pesado
  // de UPDATE. `estoques` cobre só os SKUs que vivem NESTE item externo — quem resolve
  // isso é o worker, que conhece split (ADR-0048) e user products (ADR-0088).
  async atualizarEstoque(
    ctx: ContextoCanal,
    itemExternoId: string,
    estoques: EstoquePorSku[],
  ): Promise<ResultadoCanal<void>> {
    if (estoques.length === 0) return { ok: true };
    const token = await ctx.getToken();
    try {
      const atual = await buscarItemML(token, itemExternoId);

      // ADR-0105 §6: o push rápido fazia GET→PUT sem guard nenhum — num anúncio morto (ou numa
      // família que o ML dissolveu) escrevia num item `closed` e devolvia o erro cru do ML. Mesmo
      // guard do UPDATE, mesma causa certa. O re-vínculo automático NÃO mora aqui: uma passada de
      // UPDATE adota a família e daí em diante este caminho roteia pelos filhos UP.
      const motivoMorto = motivoAnuncioNaoAtualizavel(atual);
      if (motivoMorto) {
        return {
          ok: false,
          erro: { codigo: 'ESTOQUE', mensagemOperador: motivoMorto, retentavel: false, status: 400 },
        };
      }

      // Item plano (ADR-0084/0088): sem sub-recurso `variations`. Repõe na raiz do item.
      // Um item plano corresponde a exatamente 1 SKU; mais que isso é alvo mal resolvido.
      if (atual.variations.length === 0) {
        if (estoques.length !== 1) {
          return {
            ok: false,
            erro: {
              codigo: 'ESTOQUE',
              mensagemOperador:
                `Item plano ${itemExternoId} recebeu ${estoques.length} SKUs no push de estoque `
                + '(esperado exatamente 1). Isso indica alvo mal resolvido, não erro do Mercado Livre.',
              retentavel: false,
            },
          };
        }
        await atualizarItemPlanoML(token, itemExternoId, { available_quantity: estoques[0].estoque });
        return { ok: true };
      }

      // Item com variações: reenvia TODAS (o ML deleta as omitidas), só available_quantity.
      const desejados = estoques.map((e) => ({ codigo: e.sku, estoque: e.estoque }));
      const variations = montarVariacoesUpdate(atual.variations, desejados, undefined, null, null, undefined, true);
      await atualizarItemML(token, itemExternoId, variations);
      return { ok: true };
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
      const url = `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,status,sub_status,available_quantity,price,listing_type_id,tags`;
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
