import type { ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio } from './contrato.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { criarItemML, garantirDescricaoML } from '../ml/criar-item.ts';
import { subirFotoML } from '../ml/fotos.ts';
import { mapearVariacoesExternas, classificarErroCanal } from './mapeamento.ts';

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
    const payload = montarPayloadItem(
      { titulo_ml: a.titulo, descricao_ml: a.descricao, categoria_ml_id: a.categoriaId, atributos_ml: a.atributos },
      a.variacoes.map((v) => ({
        codigo: v.sku, cor: v.cor, estoque: v.estoque,
        preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
      })),
      a.capaFotoId, a.capa2FotoId, a.capa3FotoId,
      a.listingTypeId, a.desconto, a.dimensoes,
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
};
