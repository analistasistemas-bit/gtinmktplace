/**
 * Fonte única de verdade dos tokens de motion (contrato docs/motion/contrato-motion-v5.md, §6).
 * `src/motion/motion.css` é GERADO a partir daqui por `scripts/gen-motion-css.ts` —
 * nunca editar valores em dois lugares (drift test em __tests__/tokens-drift.test.ts).
 */

export const durationMs = {
  instant: 100, // 80–120ms: toggles, checkbox
  micro: 150, // 120–180ms: hover, focus, active
  state: 190, // 160–220ms: mudança de estado
  enter: 260, // 220–300ms: entrada de componentes
  overlay: 300, // 240–340ms: modal, drawer
  page: 320, // 240–360ms: transição de página
} as const;

export const distance = {
  enterY: 8, // px — deslocamento máximo de entrada
  cardLift: 2, // px — elevação máxima de card clicável
  pressScale: 0.98, // scale de active/press em botões
} as const;

export const staggerMs = {
  item: 40, // entre itens (30–50ms), máx. 6–10 elementos
  initialDelay: 50,
} as const;

/** Libs de animação usam segundos; CSS usa ms. Nunca duplicar `260` e `0.26` à mão. */
export const seconds = (ms: number): number => ms / 1000;
