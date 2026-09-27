import { describe, expect, it } from 'vitest';
import { montarInventario, type FontesInventario } from '../inventario.ts';

const fontes = (o: Partial<FontesInventario> = {}): FontesInventario => ({
  familias: [], anunciosExternos: [], itensUp: [], kitsVirtuais: [],
  catalogoVariacoes: [], catalogoItensUp: [], pxvAnteriores: [], vendidos: [],
  ...o,
});

describe('montarInventario', () => {
  it('une as 8 fontes, deduplica e ordena por code units', () => {
    const out = montarInventario(fontes({
      familias: ['MLB3'], anunciosExternos: ['MLB1'], vendidos: ['MLB1', 'MLB20'],
    }), new Set());
    expect(out).toEqual(['MLB1', 'MLB20', 'MLB3']);
  });

  it('só aceita MLB\\d+ — descarta null, vazio e outro formato', () => {
    const out = montarInventario(fontes({
      familias: ['MLB1', null as unknown as string, '', 'ML123', 'MLB1A', 'mlb2'],
    }), new Set());
    expect(out).toEqual(['MLB1']);
  });

  it('exclui os encerrados há mais de 30 dias', () => {
    const out = montarInventario(fontes({ familias: ['MLB1', 'MLB2'] }), new Set(['MLB2']));
    expect(out).toEqual(['MLB1']);
  });
});
