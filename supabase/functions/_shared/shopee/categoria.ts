import { shopeeGet, type RespostaShopee } from './cliente.ts';
import type { CredsAssinatura } from './assinatura.ts';

/**
 * Consulta de categorias/atributos da Shopee (seleção é MANUAL na Fatia 1;
 * canonicalização por IA é a Fatia 4). Thin wrappers sobre o cliente.
 */
const PATH_GET_CATEGORY = '/api/v2/product/get_category';
const PATH_GET_ATTRIBUTE_TREE = '/api/v2/product/get_attribute_tree';

export function buscarCategorias(
  host: string,
  creds: CredsAssinatura,
  accessToken: string,
  shopId: string,
): Promise<RespostaShopee> {
  return shopeeGet(host, PATH_GET_CATEGORY, {
    creds,
    accessToken,
    shopId,
    query: { language: 'pt-br' },
  });
}

export function buscarAtributos(
  host: string,
  creds: CredsAssinatura,
  accessToken: string,
  shopId: string,
  categoryId: number,
): Promise<RespostaShopee> {
  return shopeeGet(host, PATH_GET_ATTRIBUTE_TREE, {
    creds,
    accessToken,
    shopId,
    query: { category_id: categoryId, language: 'pt-br' },
  });
}
