import { describe, it, expect } from 'vitest';
import {
  skusConfirmadosNoMl, promoverConfirmados, esperaEsgotada, temSkuAguardando,
  TETO_ESPERA_MS, type MarcadorSyncMl,
} from '../estoque-sync-ml';

/** Caso real (03/09/2026): produto User Products, uma cor por anúncio. */
const UP = [
  { codigo: '18760903', estoque: 40, mlItemId: 'MLB4959860751' },
  { codigo: '24232513', estoque: 40, mlItemId: 'MLB4959919633' },
  { codigo: '27470653', estoque: 40, mlItemId: 'MLB4959860913' },
];

/** Legacy: as três cores dividem o mesmo anúncio e o ML devolve a SOMA do item. */
const LEGACY = [
  { codigo: 'A', estoque: 40, mlItemId: 'MLB1' },
  { codigo: 'B', estoque: 10, mlItemId: 'MLB1' },
  { codigo: 'C', estoque: 0, mlItemId: 'MLB1' },
];

describe('skusConfirmadosNoMl — User Products (1 anúncio por cor)', () => {
  it('confirma só a cor cujo anúncio já devolve o saldo do app', () => {
    const vivo = new Map<string, number | null>([
      ['MLB4959860751', 40],   // chegou
      ['MLB4959919633', 0],    // ainda não
      ['MLB4959860913', 40],   // chegou
    ]);
    expect(skusConfirmadosNoMl(['18760903', '24232513', '27470653'], UP, vivo).sort())
      .toEqual(['18760903', '27470653']);
  });

  it('anúncio sem estoque lido (null) NUNCA confirma — não dizemos "✓ no ML" sem ler o ML', () => {
    const vivo = new Map<string, number | null>([['MLB4959860751', null]]);
    expect(skusConfirmadosNoMl(['18760903'], UP, vivo)).toEqual([]);
  });

  it('anúncio ausente da leitura também não confirma', () => {
    expect(skusConfirmadosNoMl(['18760903'], UP, new Map())).toEqual([]);
  });

  it('cor que não está aguardando não entra no resultado', () => {
    const vivo = new Map<string, number | null>([['MLB4959919633', 40]]);
    expect(skusConfirmadosNoMl(['18760903'], UP, vivo)).toEqual([]);
  });
});

describe('skusConfirmadosNoMl — Legacy (um anúncio, N cores)', () => {
  it('compara a SOMA do item, que é o número que o ML expõe', () => {
    const vivo = new Map<string, number | null>([['MLB1', 50]]);   // 40 + 10 + 0
    expect(skusConfirmadosNoMl(['A'], LEGACY, vivo)).toEqual(['A']);
  });

  it('soma diferente não confirma nenhuma das cores do item', () => {
    const vivo = new Map<string, number | null>([['MLB1', 10]]);
    expect(skusConfirmadosNoMl(['A', 'B'], LEGACY, vivo)).toEqual([]);
  });

  it('variação sem anúncio (mlItemId null) não entra na soma nem confirma', () => {
    const comOrfa = [...LEGACY, { codigo: 'D', estoque: 999, mlItemId: null }];
    const vivo = new Map<string, number | null>([['MLB1', 50]]);
    expect(skusConfirmadosNoMl(['A', 'D'], comOrfa, vivo)).toEqual(['A']);
  });
});

describe('promoverConfirmados', () => {
  const base: MarcadorSyncMl = {
    porSku: { A: 'aguardando', B: 'aguardando' },
    desde: '2026-09-03T23:19:00.000Z',
  };

  it('promove só o confirmado', () => {
    expect(promoverConfirmados(base, ['A']).porSku).toEqual({ A: 'ok', B: 'aguardando' });
  });

  // O card compara por referência para não reagendar timers a cada render.
  it('devolve o MESMO objeto quando nada muda', () => {
    expect(promoverConfirmados(base, [])).toBe(base);
    expect(promoverConfirmados(base, ['inexistente'])).toBe(base);
    const jaOk = promoverConfirmados(base, ['A']);
    expect(promoverConfirmados(jaOk, ['A'])).toBe(jaOk);
  });
});

describe('esperaEsgotada e temSkuAguardando', () => {
  const marcador: MarcadorSyncMl = { porSku: { A: 'aguardando' }, desde: '2026-09-03T23:00:00.000Z' };

  it('dentro do teto, a badge continua', () => {
    expect(esperaEsgotada(marcador, new Date('2026-09-03T23:05:00.000Z'))).toBe(false);
  });

  // Em Legacy uma divergência antiga em OUTRA cor faria a soma nunca fechar: sem teto a badge
  // ficaria acesa para sempre, dizendo "atualizando" quando nada está sendo atualizado.
  it('passado o teto, esgota', () => {
    const depois = new Date(Date.parse(marcador.desde) + TETO_ESPERA_MS + 1);
    expect(esperaEsgotada(marcador, depois)).toBe(true);
  });

  it('temSkuAguardando liga o poll só enquanto há push em voo', () => {
    expect(temSkuAguardando(marcador)).toBe(true);
    expect(temSkuAguardando({ ...marcador, porSku: { A: 'ok' } })).toBe(false);
    expect(temSkuAguardando(undefined)).toBe(false);
  });
});
