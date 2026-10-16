// ADR-0016 adendo 2026-10-16: o UPDATE herda o preço que está no ar AGORA. O snapshot
// `preco_publicado_ml` só é regravado quando o app publica — mudança feita direto no ML depois
// (ou UP em "somente estoque", que não regrava) ficaria invisível. Lê `/items/bulk` (ADR-0177).
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';

const API = 'https://api.mercadolibre.com';

export interface PrecoVivoItem {
  price: number | null;
  /** Legacy: preço por `variation.id` (string). UP: vazio — o item É a cor. */
  porVariacao: Map<string, number>;
}

type Linha = { code?: number; body?: { id?: string; price?: number | null; variations?: Array<{ id?: number | string; price?: number | null }> } };

export function parsePrecosVivos(json: unknown, ids: readonly string[]): Map<string, PrecoVivoItem> {
  const out = new Map<string, PrecoVivoItem>();
  const linhas = comoEnvelopeAntigo(json, ids);
  if (!Array.isArray(linhas)) return out;
  for (const l of linhas as Linha[]) {
    if (l?.code !== 200 || !l.body?.id) continue;
    const porVariacao = new Map<string, number>();
    for (const v of l.body.variations ?? []) {
      if (v?.id != null && v.price != null) porVariacao.set(String(v.id), Number(v.price));
    }
    out.set(String(l.body.id), { price: l.body.price != null ? Number(l.body.price) : null, porVariacao });
  }
  return out;
}

/** Blocos de 20 (limite do multiget). Bloco com HTTP de erro (ex.: 429) é pulado: os itens dele
 *  caem no snapshot sem descartar os blocos já lidos. */
export async function lerPrecosVivosML(
  token: string, ids: readonly string[], fetchLike: typeof fetch = fetch,
): Promise<Map<string, PrecoVivoItem>> {
  const out = new Map<string, PrecoVivoItem>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 20) {
    const bloco = unicos.slice(i, i + 20);
    const resp = await fetchLike(`${API}${caminhoMultiget(bloco, 'id,price,variations')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      console.error(`multiget de preços falhou (${resp.status}) — ${bloco.length} itens usam o snapshot`);
      continue;
    }
    for (const [id, p] of parsePrecosVivos(await resp.json(), bloco)) out.set(id, p);
  }
  return out;
}

/** Preço vivo de UMA variação. UP: price do item do SKU. Legacy: preço da própria variação no
 *  anúncio — variação fora do anúncio (sem ml_variation_id) não tem preço vivo. null = não lido. */
export function precoVivoDaVariacao(
  vivos: Map<string, PrecoVivoItem>,
  p: { itemUP?: string; itemLegacy?: string | null; mlVariationId: string | null },
): number | null {
  if (p.itemUP) return vivos.get(p.itemUP)?.price ?? null;
  if (!p.itemLegacy || p.mlVariationId == null) return null;
  // Sem fallback para item.price: em família dividida em faixas (ADR-0078) `itemLegacy` é só a
  // partição 0 — a variação de outra faixa não está aqui e herdaria o preço errado.
  return vivos.get(p.itemLegacy)?.porVariacao.get(String(p.mlVariationId)) ?? null;
}
