import { describe, expect, it } from 'vitest';
import { calcularMinhaMargem } from '../compartilhado/margem';

// Prova que o alias @margem resolve para _shared/extensao/margem.ts (mesmo cálculo da edge).
describe('@margem na extensão', () => {
  it('Clássico R$ 213,19 → recebe 147,24', () => {
    const tipo = { comissao: { estado: 'ok' as const, valor: { percentual: 12, fixa: 0 } }, frete: { estado: 'ok' as const, valor: 25.45 } };
    const r = calcularMinhaMargem({
      preco: 213.19,
      aliquotaPct: { estado: 'ok', valor: 7 },
      custoPacote: { estado: 'ok', valor: 80 },
      classico: tipo,
      premium: tipo,
    });
    expect(r.classico).toMatchObject({ estado: 'ok', valor: { recebe: 147.24, lucro: 67.24 } });
  });
});
