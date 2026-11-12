// ADR-0204: proposta de galeria do kit vinculado = fotos 2 a 7 do anúncio PUBLICADO da base, lidas do ML. Só leitura.
// A edge `fotos-base-kit` (prévia) e o `criar-kit-vinculado` (recalcula no servidor) usam esta mesma regra.
import { galeriaDasPecas, lerLimiteFotos } from './galeria-leitura.ts';

export const MAX_FOTOS_BASE_KIT = 6;

/** Item da base no ML: `familias.ml_item_id` (a rota UP também o grava). Base não publicada → null. */
export function itemIdDaBase(familia: { ml_item_id?: string | null }): string | null {
  return familia.ml_item_id || null;
}

export async function propostaGaleriaBase(
  p: { token: string; itemIdBase: string | null; categoriaKitId: string | null }, f: typeof fetch = fetch,
): Promise<{ fotos: { id: string; item: string; url: string }[]; avisos: string[]; indisponivel: boolean; limite: number | null }> {
  if (!p.itemIdBase || !p.categoriaKitId) return { fotos: [], avisos: [], indisponivel: false, limite: null };
  const limite = await lerLimiteFotos(p.categoriaKitId, f);
  if (limite === null) return { fotos: [], avisos: ['Limite de fotos da categoria ilegível; kit sem galeria.'], indisponivel: false, limite };
  // Uma "peça" só (a base): montarGaleriaKit pula a foto 1 e respeita limite-1 vagas.
  const g = await galeriaDasPecas(p.token, [{ cor: 'Base', itemId: p.itemIdBase }], limite, f);
  return {
    fotos: g.fotos.slice(0, MAX_FOTOS_BASE_KIT).map((x) => ({ id: x.id, item: x.item, url: g.urls[x.id] ?? '' })),
    avisos: g.avisos, indisponivel: g.indisponivel, limite,
  };
}
