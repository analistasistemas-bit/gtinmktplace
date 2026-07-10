// Sentinelas de "isto NÃO é uma cor real de exibição":
//  - 'Outra' é o veredito do Vision quando não consegue classificar a cor da foto
//    (dúvida, iluminação ruim, produto multicolorido) — o operador valida na mão. Ver ai/vision.ts.
//  - '(sem cor identificada)' é o placeholder do copywriter para variação sem cor no nome.
// Nenhum dos dois pode vazar para o título (ADR-0044) nem para a lista de cores da descrição:
// o incidente do lote #31 ("OUTRA" no título e na descrição de um pote de lápis) foi tratar
// 'Outra' como cor legítima porque só o placeholder era barrado. Um predicado único mata a divergência.
export const COR_VISION_INDEFINIDA = 'Outra';
export const COR_NAO_IDENTIFICADA = '(sem cor identificada)';

export function ehCorIndefinida(cor: string | null | undefined): boolean {
  const c = cor?.trim();
  return !c || c === COR_VISION_INDEFINIDA || c === COR_NAO_IDENTIFICADA;
}
