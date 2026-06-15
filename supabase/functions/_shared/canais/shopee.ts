import type {
  ChannelConnector, ContextoCanal, AnuncioCanonico, ResultadoCanal, RefAnuncio,
  AtualizacaoCanonica, ResultadoAtualizacao, StatusCanal,
} from './contrato.ts';
import type { CredsAssinatura } from '../shopee/assinatura.ts';
import { montarPayloadAddItem } from '../shopee/item.ts';
import { shopeePost, shopeeGet } from '../shopee/cliente.ts';
import { subirFotoShopee } from '../shopee/fotos.ts';
import { classificarErroShopee, type CorpoErroShopee } from '../shopee/mapeamento.ts';
import { parseStatusShopee, type ItemShopeeStatus } from '../shopee/status.ts';

const PATH_ADD_ITEM = '/api/v2/product/add_item';
const PATH_GET_ITEM_BASE_INFO = '/api/v2/product/get_item_base_info';

function host(): string {
  return Deno.env.get('SHOPEE_HOST')!;
}

function creds(): CredsAssinatura {
  return {
    partnerId: Deno.env.get('SHOPEE_PARTNER_ID')!,
    partnerKey: Deno.env.get('SHOPEE_PARTNER_KEY')!,
  };
}

function exigirShopId(ctx: ContextoCanal): string {
  if (!ctx.shopId) throw new Error('Conector Shopee exige ctx.shopId (canal shop-scoped)');
  return ctx.shopId;
}

interface RespostaAddItem extends CorpoErroShopee {
  response?: { item_id?: number; item_status?: string };
}

interface RespostaItemBaseInfo extends CorpoErroShopee {
  response?: { item_list?: ItemShopeeStatus[] };
}

export const shopeeConnector: ChannelConnector = {
  id: 'shopee',
  capabilities: {
    variacoes: true,
    descricaoSeparada: false,
    catalogo: false,
    desconto: true,
    dimensoesPacote: true,
  },

  async subirFoto(ctx: ContextoCanal, sourceUrl: string): Promise<string> {
    const token = await ctx.getToken();
    const shopId = exigirShopId(ctx);
    return subirFotoShopee(host(), creds(), token, shopId, sourceUrl);
  },

  async criarAnuncio(ctx: ContextoCanal, a: AnuncioCanonico): Promise<ResultadoCanal<RefAnuncio>> {
    try {
      const token = await ctx.getToken();
      const shopId = exigirShopId(ctx);
      const payload = montarPayloadAddItem(a, shopId);
      const { status, body } = await shopeePost<RespostaAddItem>(host(), PATH_ADD_ITEM, {
        creds: creds(), accessToken: token, shopId, body: payload,
      });
      if (body?.error || !body?.response?.item_id) {
        return { ok: false, erro: classificarErroShopee(body, status) };
      }
      const itemId = String(body.response.item_id);
      // Fatia 1: 1 variação simples → a variação canônica mapeia ao próprio item.
      const variacoesExternas: Record<string, string> = {};
      const v = a.variacoes[0];
      if (v) variacoesExternas[v.sku] = itemId;
      return { ok: true, valor: { itemExternoId: itemId, variacoesExternas } };
    } catch (e) {
      return { ok: false, erro: classificarErroShopee({ message: (e as Error).message }) };
    }
  },

  // Shopee embute a descrição no add_item (capability descricaoSeparada:false).
  // Métodos obrigatórios da interface implementados como no-ops explícitos.
  async garantirDescricao(): Promise<void> {
    return;
  },

  async atualizarAnuncio(): Promise<ResultadoCanal<ResultadoAtualizacao>> {
    // TODO Fatia 3: repor estoque/preço e cores novas (update_item / update_model).
    return {
      ok: false,
      erro: {
        codigo: 'NAO_SUPORTADO',
        mensagemOperador: 'atualizarAnuncio Shopee não suportado na Fatia 1 (TODO Fatia 3)',
        retentavel: false,
      },
    };
  },

  // Descrição embutida no item → nada a sincronizar ao vivo (no-op explícito).
  async sincronizarDescricao(): Promise<string | null> {
    return null;
  },

  async lerStatus(ctx: ContextoCanal, itemExternoIds: string[]): Promise<Record<string, StatusCanal>> {
    const token = await ctx.getToken();
    const shopId = exigirShopId(ctx);
    const out: Record<string, StatusCanal> = {};
    if (itemExternoIds.length === 0) return out;
    const { body } = await shopeeGet<RespostaItemBaseInfo>(host(), PATH_GET_ITEM_BASE_INFO, {
      creds: creds(), accessToken: token, shopId,
      query: { item_id_list: itemExternoIds.join(',') },
    });
    const porId = new Map<string, ItemShopeeStatus>();
    for (const item of body?.response?.item_list ?? []) {
      if (item.item_id != null) porId.set(String(item.item_id), item);
    }
    for (const id of itemExternoIds) {
      out[id] = parseStatusShopee(porId.get(id) ?? null);
    }
    return out;
  },
};
