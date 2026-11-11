import { supabase } from './supabase';

/** Resposta da edge `ler-anuncio-calculadora` (somente leitura) — prefill da calculadora. */
export interface AnuncioCalculadora {
  publicado: boolean;
  itemId: string | null;
  /** Preço que o comprador paga agora (sale_price, inclui promoção); fallback `price` do /items. */
  preco: number | null;
  /** Preço "de" quando em promoção. */
  precoOriginal: number | null;
  fontePreco: 'sale_price' | 'items' | null;
  salePriceFalhou: boolean;
  modalidade: 'classico' | 'premium' | null;
  categoriaId: string | null;
  categoriaNome: string | null;
  categoriaFonte: 'item' | 'cadastro' | null;
  /** `status` do item no ML (`active`, `paused`, `closed`…). */
  statusAnuncio: string | null;
  /** `sem_conexao` | `falha_leitura_item` quando o preço vivo não pôde ser lido. */
  motivo?: string;
}

/** `itemId` = `VariacaoComSaldo.mlItemId`; a edge confere o vínculo com a org. HTTP ≠ 2xx → lança. */
export async function fetchAnuncioCalculadora(codigoPai: string, itemId: string | null): Promise<AnuncioCalculadora> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ler-anuncio-calculadora`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_pai: codigoPai, item_id: itemId }),
  });
  if (!r.ok) throw new Error(`ler-anuncio-calculadora: HTTP ${r.status}`);
  return await r.json() as AnuncioCalculadora;
}
