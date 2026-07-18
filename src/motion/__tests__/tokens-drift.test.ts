import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOTION_CSS_PATH, renderMotionCss } from '../../../scripts/gen-motion-css.ts';
import { durationMs, seconds } from '../tokens';

describe('fonte única de motion (TS → CSS)', () => {
  it('motion.css commitado é idêntico ao gerado da fonte TS', () => {
    // Divergiu? Rode: node scripts/gen-motion-css.ts e commite o resultado.
    expect(readFileSync(MOTION_CSS_PATH, 'utf8')).toBe(renderMotionCss());
  });

  it('seconds() converte ms sem duplicação manual', () => {
    expect(seconds(durationMs.enter)).toBe(0.26);
    expect(seconds(0)).toBe(0);
  });
});
