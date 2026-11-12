// ADR-0200 (adendo 12/11): galeria das peças no CREATE do item do kit (worker `kit-transferencia`, `prepararItem`).
// Sem 2º POST: se o ML recusar uma foto, a lista da variação é zerada e o 4xx sobe; o reagendamento normal da saga
// recria o item só com a foto do kit (4xx = nada foi criado, a idempotência da saga não muda).
import type { FotoPeca } from './galeria-pecas.ts';

/** Acrescenta os ids da galeria depois das fotos que o payload já tem, sem repetir. Não altera o original. */
export function comGaleria<T extends { pictures?: Array<{ id: string }> }>(payload: T, galeria: FotoPeca[]): T {
  if (galeria.length === 0) return payload;
  const atuais = payload.pictures ?? [];
  const vistos = new Set(atuais.map((p) => p.id));
  const novas = galeria.filter((f) => !vistos.has(f.id) && vistos.add(f.id)).map((f) => ({ id: f.id }));
  return { ...payload, pictures: [...atuais, ...novas] };
}

/**
 * Antes do POST: só vai o que o ML ainda confirma (item de origem limpo e foto ainda nele). Nunca lança nem trava a
 * criação: sem confirmação o item sai só com a foto do kit.
 */
export async function prepararGaleria(
  galeria: FotoPeca[], revalidar: (f: FotoPeca[]) => Promise<{ fotos: FotoPeca[]; motivo: string | null }>,
): Promise<{ fotos: FotoPeca[]; aviso: string | null }> {
  if (galeria.length === 0) return { fotos: [], aviso: null };
  try {
    const r = await revalidar(galeria);
    return { fotos: r.fotos, aviso: r.motivo ? `Galeria das peças reduzida: ${r.motivo}.` : null };
  } catch (e) {
    return { fotos: [], aviso: `Galeria das peças não conferida (${e instanceof Error ? e.message : String(e)}); só a foto do kit.` };
  }
}

/**
 * 400 do ML com recusa DEFINITIVA de foto: causa `item.pictures.*` (max, invalid…) ou `picture_not_found` em qualquer forma.
 * `item.pictures.unavailable` sozinha é transitória (a foto do kit ainda propaga): não desliga a galeria.
 */
export function erroDeFoto(status: number, corpo: unknown): boolean {
  if (status !== 400) return false;
  const causas = (corpo as { cause?: unknown } | null)?.cause;
  if (!Array.isArray(causas)) return false;
  return causas.some((c) => {
    const code = (c as { code?: unknown })?.code;
    if (typeof code !== 'string') return false;
    if (code.includes('picture_not_found')) return true;
    return code.startsWith('item.pictures.') && !code.endsWith('.unavailable');
  });
}

/**
 * CREATE recusado com galeria no payload. Se a causa é foto: zera a lista da variação e avisa (chave idempotente fica
 * com quem chama). Devolve true quando era recusa de foto; o chamador relança o 4xx de qualquer forma. Falha ao zerar ou
 * avisar nunca esconde o erro original.
 */
export async function tratarRecusaDeFoto(
  e: { status: number; corpo: unknown; galeriaUsada: boolean },
  portas: { zerar(): Promise<void>; avisar(texto: string): Promise<void> },
): Promise<boolean> {
  if (!e.galeriaUsada || !erroDeFoto(e.status, e.corpo)) return false;
  await portas.zerar().catch((err) => console.warn('kit_galeria_zerar_falhou', String(err)));
  await portas.avisar('O Mercado Livre recusou uma foto da galeria das peças ao criar o anúncio do kit. '
    + 'A galeria foi desligada para esse anúncio e a criação será repetida só com a foto do kit.')
    .catch((err) => console.warn('kit_galeria_avisar_falhou', String(err)));
  return true;
}
