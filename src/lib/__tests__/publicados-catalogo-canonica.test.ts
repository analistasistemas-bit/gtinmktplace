import { describe, expect, it } from 'vitest';
import { dedupePublicados, type PublicadoItem } from '../publicados';

const base = (over: Partial<PublicadoItem> = {}): PublicadoItem => ({
  familiaId: 'f1', codigoPai: 'P1', gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: 'M1', mlPermalink: null, publicadoEm: null, ...over,
});

// A edge `retentar-catalogo` age na família publicada mais nova; o ↻ segue o mesmo critério —
// senão aparecia por causa de um lote antigo e o clique voltava 409.
describe('dedupePublicados — catalogRetentavel pela família publicada mais nova', () => {
  it('antiga retentável, nova não → sem ↻', () => {
    const [linha] = dedupePublicados([
      base({ familiaId: 'antiga', publicadoEm: '2026-01-01', catalogRetentavel: true }),
      base({ familiaId: 'nova', publicadoEm: '2026-06-01', catalogRetentavel: false }),
    ]);
    expect(linha.familiaId).toBe('antiga'); // representante continua a publicação original
    expect(linha.catalogRetentavel).toBe(false);
  });

  it('nova retentável → ↻', () => {
    const [linha] = dedupePublicados([
      base({ familiaId: 'antiga', publicadoEm: '2026-01-01', catalogRetentavel: false }),
      base({ familiaId: 'nova', publicadoEm: '2026-06-01', catalogRetentavel: true }),
    ]);
    expect(linha.catalogRetentavel).toBe(true);
  });
});
