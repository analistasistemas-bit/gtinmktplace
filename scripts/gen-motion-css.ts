/**
 * Gera `src/motion/motion.css` a partir da fonte única TS (src/motion/tokens.ts + easings.ts).
 * Rodar: `node scripts/gen-motion-css.ts` (Node ≥ 23.6, type stripping nativo — sem dependência).
 * O drift test (src/motion/__tests__/tokens-drift.test.ts) falha se o arquivo commitado divergir.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';
import { durationMs, distance } from '../src/motion/tokens.ts';
import { easingCss } from '../src/motion/easings.ts';

export const MOTION_CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/motion/motion.css'
);

export function renderMotionCss(): string {
  return [
    '/* GERADO por scripts/gen-motion-css.ts — NÃO editar à mão. */',
    '/* Fonte única: src/motion/tokens.ts + src/motion/easings.ts (contrato §6.7). */',
    ':root {',
    ...Object.entries(durationMs).map(([k, v]) => `  --motion-duration-${k}: ${v}ms;`),
    `  --motion-distance-enter-y: ${distance.enterY}px;`,
    `  --motion-distance-card-lift: ${distance.cardLift}px;`,
    `  --motion-press-scale: ${distance.pressScale};`,
    ...Object.entries(easingCss).map(([k, v]) => `  --motion-ease-${k}: ${v};`),
    '}',
    '',
  ].join('\n');
}

// Executado diretamente (não importado pelo drift test) → escreve o arquivo.
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  writeFileSync(MOTION_CSS_PATH, renderMotionCss());
  console.log(`gerado: ${MOTION_CSS_PATH}`);
}
