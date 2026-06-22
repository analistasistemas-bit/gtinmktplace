import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio,
  AtualizacaoCanonica, ResultadoAtualizacao, StatusCanal, MetricasVendasCanal,
} from './contrato.ts';
import { lerVendasML } from '../ml/vendas.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { criarItemML, garantirDescricaoML, buscarDescricaoML, resolverDescricaoUpdate } from '../ml/criar-item.ts';
import { buscarItemML, atualizarItemML } from '../ml/atualizar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../ml/atualizar.ts';
import { montarAtributosPacote } from '../ml/pacote.ts';
import { parseStatusML, type ItemMLStatus } from '../ml/status.ts';
import { subirFotoML } from '../ml/fotos.ts';
import { mapearVariacoesExternas, mapearVariacoesPorSku, classificarErroCanal } from './mapeamento.ts';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const mercadoLivreConnector: ChannelConnector = {
  id: 'mercado_livre',
  capabilities: {
    variacoes: true,
    descricaoSeparada: true,
    catalogo: true,
    desconto: true,
    dimensoesPacote: true,
  },

  async subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string> {
    const token = await ctx.getToken();
    return subirFotoML(token, sourceUrl);
  },

  async criarAnuncio(ctx: ContextoCanal, a: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>> {
    const token = await ctx.getToken();
    // E4: descobre pelo schema se a categoria expõe EMPTY_GTIN_REASON (generaliza p/ vertical nova).
    // Falha de leitura → undefined → montarPayloadItem cai no helper hard-coded dos aviamentos.
    let aceitaEmptyGtin: boolean | undefined;
    try {
      const schema = await lerSchemaAtributos(token, a.categoriaId ?? '');
      if (schema.length) aceitaEmptyGtin = schema.some((s) => s.id === 'EMPTY_GTIN_REASON');
    } catch { /* fallback hard-coded */ }
    const payload = montarPayloadItem(
      { titulo_ml: a.titulo, descricao_ml: a.descricao, categoria_ml_id: a.categoriaId, atributos_ml: a.atributos },
      a.variacoes.map((v) => ({
        codigo: v.sku, cor: v.cor, estoque: v.estoque,
        preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
      })),
      a.capaFotoId, a.capa2FotoId, a.capa3FotoId,
      a.listingTypeId, a.desconto, a.dimensoes, aceitaEmptyGtin,
    );
    try {
      const r = await criarItemML(token, payload);
      return {
        ok: true,
        valor: {
          itemExternoId: r.id,
          permalink: r.permalink,
          variacoesExternas: mapearVariacoesExternas(r.variations, a.variacoes),
        },
      };
    } catch (e) {
      return { ok: false, erro: classificarErroCanal(e) };
    }
  },

  async garantirDescricao(ctx: ContextoCanal, itemExternoId: string, descricao: string): Promise<void> {
    const token = await ctx.getToken();
    await garantirDescricaoML(token, itemExternoId, descricao);
  },

  async atualizarAnuncio(ctx: ContextoCanal, a: AtualizacaoCanonica): Promise<ResultadoCanal<ResultadoAtualizacao>> {
    const token = await ctx.getToken();
    try {
      // GET estado real → reenviar TODAS as variações (o ML deleta as omitidas).
      const atual = await buscarItemML(token, a.itemExternoId);
      const desejados = a.existentes.map((e) => ({ codigo: e.sku, estoque: e.estoque }));
      // Fotos comuns (capa2/capa3) são da família inteira → aplicam a TODAS as variações
      // existentes; inseridas logo após a líder de cada cor (capa3 sempre após capa2).
      const comuns = [a.capa2FotoId, a.capa3FotoId].filter((x): x is string => !!x);
      const picsPorCodigo: Record<string, string[]> = {};
      if (comuns.length > 0) {
        for (const av of atual.variations) {
          const codigo = av.seller_custom_field ?? '';
          const atuaisPics = av.picture_ids ?? [];
          picsPorCodigo[codigo] = [...new Set(
            [atuaisPics[0], ...comuns, ...atuaisPics.slice(1)].filter((x): x is string => !!x),
          )];
        }
      }
      const existentes = montarVariacoesUpdate(
        atual.variations, desejados,
        comuns.length > 0 ? picsPorCodigo : undefined,
        a.desconto ?? undefined, a.precoFamilia,
      );
      const novasPut = a.novas.map((v) => montarVariacaoNova(
        { codigo: v.sku, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId },
        a.capaFotoId, a.capa2FotoId, a.capa3FotoId, a.categoriaId,
        a.desconto ? { pct: a.desconto.pct } : null,
      ));
      // BRAND (do fornecedor) + dimensões/peso (SELLER_PACKAGE_*); só os passados — o ML mescla.
      const atributosItem = [
        ...(a.marca ? [{ id: 'BRAND', value_name: a.marca }] : []),
        ...(a.dimensoes ? montarAtributosPacote(a.dimensoes) : []),
      ];
      // Ao criar variação nova, a foto dela precisa estar também em item.pictures.
      const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
      const precisaPictures = novasPut.length > 0 || comuns.length > 0;
      const pictures = precisaPictures
        ? [...new Set([...atual.pictures, ...comuns, ...novasPicIds])]
        : undefined;
      const resultado = await atualizarItemML(token, a.itemExternoId, [...existentes, ...novasPut], atributosItem, pictures);
      // O PUT nem sempre ecoa seller_custom_field nas variações criadas; o GET ecoa de forma
      // confiável — então relemos o item para casar as novas quando há cores novas.
      let varsParaCasar = resultado.variations;
      if (a.novas.length > 0) {
        const refetch = await buscarItemML(token, a.itemExternoId);
        varsParaCasar = refetch.variations;
      }
      return { ok: true, valor: { variacoesExternas: mapearVariacoesPorSku(varsParaCasar) } };
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
      const url = `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,status,sub_status,available_quantity,price`;
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
