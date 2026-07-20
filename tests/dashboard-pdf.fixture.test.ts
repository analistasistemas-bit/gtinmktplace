import { existsSync, statSync } from 'node:fs';
import type { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

import * as fixtures from '../scripts/fixtures/dashboard-pdf';

const documentos = (
  fixtures as { documentos?: Record<'representativo' | 'vazio', jsPDF> }
).documentos;

describe('fixture visual do PDF do Dashboard', () => {
  it.each(['representativo', 'vazio'])('gera o cenário %s', (cenario) => {
    const caminho = `tmp/pdfs/dashboard-${cenario}.pdf`;
    expect(existsSync(caminho)).toBe(true);
    expect(statSync(caminho).size).toBeGreaterThan(0);
  });

  it('prova duas páginas nos cenários cheio e vazio', () => {
    expect(documentos).toBeDefined();
    expect(documentos?.representativo.getNumberOfPages()).toBe(2);
    expect(documentos?.vazio.getNumberOfPages()).toBe(2);
  });

  it('exercita seis liberações no cenário representativo', () => {
    const pdf = documentos?.representativo.output();
    for (const data of ['18/08', '25/08', '01/09', '08/09', '15/09', '22/09']) {
      expect(pdf).toContain(data);
    }
    expect(pdf?.replace(/\u00a0/g, ' ')).toContain('R$ 319,55');
  });
});
