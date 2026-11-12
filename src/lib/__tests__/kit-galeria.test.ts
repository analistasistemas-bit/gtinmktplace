import { describe, it, expect } from 'vitest';
import { idsDaGaleria, alternarFoto, type GaleriaProposta } from '../kit-galeria';

const prop = (ids: string[], extra: Partial<GaleriaProposta> = {}): GaleriaProposta => ({
  fotos: ids.map((id) => ({ id, item: 'MLB1', url: `u/${id}`, cor: 'Preto' })), avisos: [], indisponivel: false, ...extra,
});

describe('idsDaGaleria (o que o pedido leva)', () => {
  it('padrão: intercalado ligado, todas as fotos da proposta na ordem', () => {
    expect(idsDaGaleria(prop(['P2', 'C3', 'P4']), undefined)).toEqual(['P2', 'C3', 'P4']);
  });
  it('operador removeu uma foto: ela sai e a ordem das outras se mantém', () => {
    expect(idsDaGaleria(prop(['P2', 'C3', 'P4']), { ligada: true, removidas: ['C3'] })).toEqual(['P2', 'P4']);
  });
  it('"Só a foto do kit" desliga a galeria inteira', () => {
    expect(idsDaGaleria(prop(['P2', 'C3']), { ligada: false, removidas: [] })).toEqual([]);
  });
  it('proposta indisponível, ausente ou vazia não leva nada', () => {
    expect(idsDaGaleria(prop(['P2'], { indisponivel: true }), undefined)).toEqual([]);
    expect(idsDaGaleria(undefined, undefined)).toEqual([]);
    expect(idsDaGaleria(prop([]), undefined)).toEqual([]);
  });
  it('removida que não está mais na proposta é ignorada', () => {
    expect(idsDaGaleria(prop(['P2']), { ligada: true, removidas: ['ZZ'] })).toEqual(['P2']);
  });
});

describe('alternarFoto', () => {
  it('remove e restaura a mesma foto', () => {
    const a = alternarFoto(undefined, 'C3');
    expect(a).toEqual({ ligada: true, removidas: ['C3'] });
    expect(alternarFoto(a, 'C3')).toEqual({ ligada: true, removidas: [] });
  });
  it('mantém o estado de ligada/desligada', () => {
    expect(alternarFoto({ ligada: false, removidas: [] }, 'P2').ligada).toBe(false);
  });
});
