// Corte da cena para o arquivo final (R9.1): 1200×1540 ao centro, nunca esticar; corte acima de 15% bloqueia; a capa
// usa preenchimento branco no lugar. Puro e sem imports: o worker confere a cena e o front (Task 12) recorta com isto.

export const LARGURA_FINAL = 1200
export const ALTURA_FINAL = 1540
export const CORTE_MAXIMO = 0.15

/** `perda` = fração da dimensão cortada. `corte`: retângulo de origem (px da cena) a escalar para 1200×1540. */
export type PlanoCorte =
  | { modo: 'corte'; x: number; y: number; largura: number; altura: number; perda: number }
  | { modo: 'preenchimento'; perda: number }
  | { modo: 'bloqueado'; perda: number }

export function planejarCorte(w: number, h: number, capa: boolean): PlanoCorte {
  if (!(w > 0 && h > 0)) return { modo: 'bloqueado', perda: 1 }
  const alvo = LARGURA_FINAL / ALTURA_FINAL
  const largura = Math.min(w, Math.round(h * alvo))
  const altura = Math.min(h, Math.round(w / alvo))
  const perda = Math.max(1 - largura / w, 1 - altura / h)
  if (perda > CORTE_MAXIMO) return { modo: capa ? 'preenchimento' : 'bloqueado', perda }
  return { modo: 'corte', x: Math.round((w - largura) / 2), y: Math.round((h - altura) / 2), largura, altura, perda }
}

/** A cena serve para a missão? Capa (1) sempre cabe com preenchimento branco; as demais só com corte ≤15%. */
export function cenaUtil(missao: number, w: number, h: number): boolean {
  return planejarCorte(w, h, missao === 1).modo !== 'bloqueado'
}
