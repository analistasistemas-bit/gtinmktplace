// ADR-0200 (adendo 12/11): leitura defensiva da galeria vinda do banco (`variacoes.galeria_ml_fotos`) e do corpo da requisição.
import type { FotoPeca } from './galeria-pecas.ts';

/** jsonb → fotos. Ausente ou fora do formato = undefined (nada a reusar); item mal formado é descartado. */
export function fotosDaColuna(v: unknown): FotoPeca[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.flatMap((x) => {
    const { id, item } = (x ?? {}) as { id?: unknown; item?: unknown };
    return typeof id === 'string' && id !== '' && typeof item === 'string' && item !== '' ? [{ id, item }] : [];
  });
}

/** Corpo: `{ rótulo: [ids…] }`. Só rótulos com lista; ids que não são texto ou são vazios saem. */
export function parseGaleria(v: unknown): Record<string, string[]> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [rotulo, ids] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue;
    out[rotulo] = ids.filter((i): i is string => typeof i === 'string' && i !== '');
  }
  return out;
}
