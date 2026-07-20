import type { MLVariacaoAtual, VariacaoUpdate, VariacaoNovaPut } from './atualizar.ts';
import { humanizarErroML } from './erro-ml.ts';

export interface ItemMLAtual {
  id: string;
  variations: MLVariacaoAtual[];
  pictures: string[];
  // ADR-0084: só preenchidos em item plano (sem variations) — usados pra repor
  // estoque/preço direto no corpo raiz em vez de um PUT de variations.
  price: number | null;
  availableQuantity: number | null;
}

function erroML(status: number, json: unknown): Error {
  const e = new Error(humanizarErroML(status, json));
  (e as { status?: number }).status = status;
  return e;
}

// Extrai o value_name do atributo COLOR das attribute_combinations do ML (null se ausente).
export function corDaVariacaoML(attributeCombinations: unknown): string | null {
  if (!Array.isArray(attributeCombinations)) return null;
  for (const a of attributeCombinations) {
    if (a && typeof a === 'object' && (a as { id?: string }).id === 'COLOR') {
      const nome = (a as { value_name?: string | null }).value_name;
      return nome != null && nome !== '' ? nome : null;
    }
  }
  return null;
}

// Estado real do anúncio: ids + seller_custom_field + estoque de cada variação.
export async function buscarItemML(accessToken: string, itemId: string): Promise<ItemMLAtual> {
  const url = `https://api.mercadolibre.com/items/${itemId}?attributes=id,variations,pictures,price,available_quantity`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json();
  if (!resp.ok) throw erroML(resp.status, json);
  const variations = (json.variations ?? []).map((v: Record<string, unknown>) => ({
    id: v.id as string | number,
    seller_custom_field: (v.seller_custom_field as string | null) ?? null,
    available_quantity: (v.available_quantity as number) ?? 0,
    // IDs reais das fotos no item (o ML re-hospeda; diferem dos IDs de upload cacheados).
    picture_ids: ((v.picture_ids as string[] | undefined) ?? []).filter(Boolean),
    // Cor (COLOR) atual no ML — p/ só reenviar COLOR quando o nome muda (ADR-0062).
    cor: corDaVariacaoML(v.attribute_combinations),
    // Preço de venda vivo (para cor nova adotar em "somente estoque", ADR-0078 F1).
    price: (v.price as number | null | undefined) ?? null,
  }));
  const pictures = (json.pictures ?? [])
    .map((p: Record<string, unknown>) => p.id as string)
    .filter(Boolean);
  return {
    id: String(json.id),
    variations,
    pictures,
    price: (json.price as number | null | undefined) ?? null,
    availableQuantity: (json.available_quantity as number | null | undefined) ?? null,
  };
}

// ADR-0084: repõe estoque/preço de um item PLANO (categoria que exige family_name, sem
// sub-recurso variations) — PUT direto no corpo raiz do item, nunca em `variations`.
// `original_price` nunca é enviado: a ML rejeita esse campo pra categorias de item plano
// (mesma validação real que bloqueou no CREATE, ver ADR-0084).
export async function atualizarItemPlanoML(
  accessToken: string,
  itemId: string,
  patch: { price?: number; available_quantity: number },
): Promise<void> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroML(resp.status, json);
}

export interface ResultadoUpdate {
  variations: Array<{ id: string | number; seller_custom_field?: string | null }>;
}

// Atualiza variações existentes (com id, só estoque) e cria as novas (sem id).
// Opcionalmente reenvia atributos de item (ex.: BRAND) — só os passados; o ML mescla por id,
// preservando os demais atributos do anúncio.
// Retorna as variations do item (com ids) para casar as novas por seller_custom_field.
export async function atualizarItemML(
  accessToken: string,
  itemId: string,
  variations: Array<VariacaoUpdate | VariacaoNovaPut>,
  atributos?: Array<{ id: string; value_name?: string; value_id?: string }>,
  pictures?: string[],
): Promise<ResultadoUpdate> {
  const body: Record<string, unknown> = { variations };
  if (atributos && atributos.length > 0) body.attributes = atributos;
  // O ML exige que toda foto de variação esteja na lista de fotos do item. Ao criar
  // variação nova, reenvia o item.pictures = fotos atuais + as novas (por id).
  if (pictures && pictures.length > 0) body.pictures = pictures.map((id) => ({ id }));
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroML(resp.status, json);
  return { variations: (json as { variations?: ResultadoUpdate['variations'] }).variations ?? [] };
}

// Pausa/reativa o anúncio (ADR-0060). PUT parcial: só o campo status, preserva o resto.
export async function atualizarStatusML(accessToken: string, itemId: string, status: 'active' | 'paused'): Promise<void> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroML(resp.status, json);
}
