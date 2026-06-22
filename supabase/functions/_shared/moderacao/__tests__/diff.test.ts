import { describe, it, expect } from 'vitest';
import { diffModerados } from '../diff';

describe('diffModerados', () => {
  it('item moderado sem registro aberto → novo', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [],
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['MLB1']);
    expect(r.resolvidos).toEqual([]);
  });
  it('registro aberto que não está mais moderado → resolvido', () => {
    const r = diffModerados([], [{ ml_item_id: 'MLB1' }]);
    expect(r.resolvidos).toEqual(['MLB1']);
    expect(r.novos).toEqual([]);
  });
  it('item moderado que já tem registro aberto → nada', () => {
    const r = diffModerados(
      [{ ml_item_id: 'MLB1', status: 'moderado', motivo: 'forbidden' }],
      [{ ml_item_id: 'MLB1' }],
    );
    expect(r.novos).toEqual([]);
    expect(r.resolvidos).toEqual([]);
  });
  it('mix: um novo, um resolvido, um inalterado', () => {
    const r = diffModerados(
      [
        { ml_item_id: 'NOVO', status: 'moderado', motivo: 'forbidden' },
        { ml_item_id: 'IGUAL', status: 'moderado', motivo: 'forbidden' },
      ],
      [{ ml_item_id: 'IGUAL' }, { ml_item_id: 'SAIU' }],
    );
    expect(r.novos.map((n) => n.ml_item_id)).toEqual(['NOVO']);
    expect(r.resolvidos).toEqual(['SAIU']);
  });
});
