import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import '../scripts/fixtures/dashboard-pdf';

describe('fixture visual do PDF do Dashboard', () => {
  it.each(['representativo', 'vazio'])('gera o cenário %s', (cenario) => {
    const caminho = `tmp/pdfs/dashboard-${cenario}.pdf`;
    expect(existsSync(caminho)).toBe(true);
    expect(statSync(caminho).size).toBeGreaterThan(0);
  });
});
