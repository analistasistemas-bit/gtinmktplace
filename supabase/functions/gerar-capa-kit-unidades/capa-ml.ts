// Base sem foto no storage (produto vindo de lote UPDATE sem fotos, ou de anúncio já publicado): a origem da capa com
// N unidades passa a ser a foto 1 do anúncio vivo da base no ML — a mesma que a tela Estoque mostra. Mesma regra de
// moderação da foto do storage: se a base ou uma cópia de catálogo estiver moderada, não gera.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { moderadosDoBulk } from '../criar-kit-variacao/processar.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';

// Só o CDN de fotos do ML (a URL vem da API do ML; nunca do cliente). Fixa o host: o download não vira SSRF.
const URL_FOTO_ML = /^https:\/\/http2\.mlstatic\.com\/D_[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
export const ehUrlFotoMl = (u: unknown): u is string => typeof u === 'string' && URL_FOTO_ML.test(u);

/** Foto 1 do item da base, lida do `/items` multiget (`id,status,sub_status,pictures`) de `ids` (base + cópias).
 *  `null` = algum item moderado ou sem foto válida. Lança se algum item não foi lido (quem chama recusa). */
export function capaMlDoBulk(itemBase: string, ids: string[], entradas: unknown): string | null {
  if (moderadosDoBulk(ids, entradas).size > 0) return null;
  const corpo = (entradas as Array<{ body?: { id?: string; pictures?: Array<{ secure_url?: unknown }> } }>)
    .find((e) => e?.body?.id === itemBase)?.body;
  const url = corpo?.pictures?.[0]?.secure_url;
  return ehUrlFotoMl(url) ? url : null;
}

/** Foto 1 do anúncio da base no ML, conferindo a moderação da base e das cópias (filhos UP / catálogo) do mesmo PAI. */
export async function capaMlDaBase(
  admin: SupabaseClient, orgId: string, tokenML: () => Promise<string>, itemBase: string, codigoPai: string,
): Promise<string | null> {
  const { data: filhos, error } = await admin.from('anuncios_externos_itens')
    .select('item_externo_id, catalog_listing_id, anuncios_externos!inner(codigo_pai)')
    .eq('org_id', orgId).eq('anuncios_externos.codigo_pai', codigoPai);
  if (error) throw new Error(`itens da base: ${error.message}`);
  const ids = [...new Set([itemBase, ...(filhos ?? []).flatMap((f: Record<string, unknown>) =>
    [f.item_externo_id, f.catalog_listing_id].filter((x): x is string => typeof x === 'string' && !!x))])];
  const token = await tokenML();
  const entradas: unknown[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const resp = await fetch(`https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,status,sub_status,pictures')}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`ML /items/bulk ${resp.status}`);
    const env = comoEnvelopeAntigo(await resp.json(), bloco);
    if (!Array.isArray(env)) throw new Error('ML /items/bulk: resposta inesperada');
    entradas.push(...env);
  }
  return capaMlDoBulk(itemBase, ids, entradas);
}

const MAX_BYTES_FOTO = 10 * 1024 * 1024;

/** Baixa a foto do CDN do ML (host fixo, sem redirect, só imagem, até 10 MB). */
export async function baixarFotoMl(url: string): Promise<Blob> {
  if (!ehUrlFotoMl(url)) throw new Error('foto de origem fora do CDN do ML');
  const resp = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`foto do ML ${resp.status}`);
  if (!(resp.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('foto do ML não é imagem');
  const blob = await resp.blob();
  if (blob.size === 0 || blob.size > MAX_BYTES_FOTO) throw new Error('foto do ML com tamanho inválido');
  return blob;
}
