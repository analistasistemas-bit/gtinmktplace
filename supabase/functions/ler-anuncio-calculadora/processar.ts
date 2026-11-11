// Miolo de ler-anuncio-calculadora (somente leitura): preço vivo, modalidade, categoria e status
// do anúncio ML de UMA variação, para o prefill da calculadora. Deps injetadas para o teste não
// bater na rede. Nenhuma escrita: só SELECT escopado por org e GET no ML.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { lerSalePriceML } from '../_shared/ml/sale-price.ts';

const ID_ML = /^MLB\d+$/;

export interface ItemML {
  price?: unknown;
  listing_type_id?: unknown;
  category_id?: unknown;
  status?: unknown;
}

export interface DepsAnuncioCalculadora {
  db: SupabaseClient;
  /** Token da conexão ML da org; null sem conexão. Só chamado depois do vínculo conferido. */
  obterToken: () => Promise<string | null>;
  lerItem: (token: string, itemId: string) => Promise<ItemML | null>;
  lerSalePrice: typeof lerSalePriceML;
  lerCategoriaNome: (categoriaId: string) => Promise<string | null>;
}

export interface AnuncioCalculadora {
  publicado: boolean;
  itemId: string | null;
  preco: number | null;
  precoOriginal: number | null;
  fontePreco: 'sale_price' | 'items' | null;
  salePriceFalhou: boolean;
  modalidade: 'classico' | 'premium' | null;
  categoriaId: string | null;
  categoriaNome: string | null;
  categoriaFonte: 'item' | 'cadastro' | null;
  statusAnuncio: string | null;
  motivo?: string;
}

export type RespostaAnuncioCalculadora = { status: 200; body: AnuncioCalculadora } | { status: 400 | 404 };

/** `GET /items/{id}` só com os 4 campos usados. Timeout 5 s; null em qualquer falha. */
export async function lerItem(token: string, itemId: string): Promise<ItemML | null> {
  try {
    const r = await fetch(
      `https://api.mercadolibre.com/items/${itemId}?attributes=price,listing_type_id,category_id,status`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) },
    );
    if (!r.ok) { console.warn(`lerItem ML ${r.status} (${itemId})`); return null; }
    const j = await r.json().catch(() => null);
    return j && typeof j === 'object' ? j as ItemML : null;
  } catch (e) {
    console.warn(`lerItem falhou (${itemId}):`, (e as Error).message);
    return null;
  }
}

/** Nome da categoria (`GET /categories/{id}`, endpoint público — dispensa token). null em falha. */
export async function lerCategoriaNome(categoriaId: string): Promise<string | null> {
  if (!ID_ML.test(categoriaId)) return null; // guard de SSRF: id interpolado na URL
  try {
    const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null) as { name?: unknown } | null;
    return typeof j?.name === 'string' ? j.name : null;
  } catch {
    return null;
  }
}

/** O item pertence ao produto `codigoPai` da org, em linha do canal ML (mesmas 3 fontes da RPC
 *  `variacoes_estoque_produto`)? O item_id vem do cliente — nunca confiar sem esta conferência. */
async function itemDaOrg(db: SupabaseClient, orgId: string, codigoPai: string, itemId: string): Promise<boolean> {
  const { data: fams } = await db.from('familias').select('id')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('ml_item_id', itemId).limit(1);
  if (fams?.length) return true;
  const { data: anuncios } = await db.from('anuncios_externos').select('id, item_externo_id')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('codigo_pai', codigoPai);
  if (!anuncios?.length) return false;
  if (anuncios.some((a) => a.item_externo_id === itemId)) return true;
  const { data: itens } = await db.from('anuncios_externos_itens').select('id')
    .eq('org_id', orgId).in('anuncio_externo_id', anuncios.map((a) => a.id)).eq('item_externo_id', itemId)
    .limit(1);
  return !!itens?.length;
}

/** `familias.categoria_ml_id` da família canônica (mais recente, não-kit) — mesma da RPC. */
async function categoriaCadastro(db: SupabaseClient, orgId: string, codigoPai: string): Promise<string | null> {
  const { data } = await db.from('familias').select('categoria_ml_id')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).is('kit_multiplicador', null)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  return typeof data?.categoria_ml_id === 'string' && data.categoria_ml_id ? data.categoria_ml_id : null;
}

const MODALIDADE: Record<string, 'classico' | 'premium'> = { gold_special: 'classico', gold_pro: 'premium' };

export async function lerAnuncioCalculadora(
  deps: DepsAnuncioCalculadora, orgId: string, body: { codigo_pai?: unknown; item_id?: unknown },
): Promise<RespostaAnuncioCalculadora> {
  const { codigo_pai: codigoPai, item_id: itemId } = body;
  if (typeof codigoPai !== 'string' || !codigoPai) return { status: 400 };
  if (itemId !== null && (typeof itemId !== 'string' || !ID_ML.test(itemId))) return { status: 400 };
  if (itemId !== null && !(await itemDaOrg(deps.db, orgId, codigoPai, itemId))) return { status: 404 };

  const catCadastro = await categoriaCadastro(deps.db, orgId, codigoPai);
  const base: AnuncioCalculadora = {
    publicado: itemId !== null, itemId, preco: null, precoOriginal: null, fontePreco: null,
    salePriceFalhou: false, modalidade: null, categoriaId: catCadastro, categoriaNome: null,
    categoriaFonte: catCadastro ? 'cadastro' : null, statusAnuncio: null,
  };
  const comNome = async (r: AnuncioCalculadora): Promise<RespostaAnuncioCalculadora> => ({
    status: 200,
    body: { ...r, categoriaNome: r.categoriaId ? await deps.lerCategoriaNome(r.categoriaId) : null },
  });

  if (itemId === null) return comNome(base);

  const token = await deps.obterToken();
  if (!token) return comNome({ ...base, motivo: 'sem_conexao' });

  const [item, sale] = await Promise.all([deps.lerItem(token, itemId), deps.lerSalePrice(token, itemId)]);
  if (!item) return comNome({ ...base, motivo: 'falha_leitura_item' });

  const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
  const categoriaItem = typeof item.category_id === 'string' && ID_ML.test(item.category_id) ? item.category_id : null;
  return comNome({
    ...base,
    preco: sale ? sale.preco : price,
    precoOriginal: sale ? sale.precoRegular : null,
    fontePreco: sale ? 'sale_price' : price !== null ? 'items' : null,
    salePriceFalhou: !sale,
    modalidade: typeof item.listing_type_id === 'string' ? MODALIDADE[item.listing_type_id] ?? null : null,
    ...(categoriaItem ? { categoriaId: categoriaItem, categoriaFonte: 'item' as const } : {}),
    statusAnuncio: typeof item.status === 'string' ? item.status : null,
  });
}
