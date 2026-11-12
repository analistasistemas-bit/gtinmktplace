import { describe, expect, it } from 'vitest';
import { compararKit, somaAvulsa, type PrecoPeca } from '@/lib/kit-preco-avulso';

// Short Bermuda da Zaven: Preto em promoção (71,90 → 41,90), Azul sem promoção (69,90).
const pecas = [
  { codigo: 'P-M', cor: 'Preto', tamanho: 'M' },
  { codigo: 'A-M', cor: 'Azul', tamanho: 'M' },
  { codigo: 'B-M', cor: 'Branco', tamanho: 'M' },
  { codigo: 'P-G', cor: 'Preto', tamanho: 'G' },
  { codigo: 'A-G', cor: 'Azul', tamanho: 'G' },
];
const precos = new Map<string, PrecoPeca>([
  ['P-M', { normal: 71.9, promocao: 41.9, fimPromocao: '2026-11-20T03:00:00Z' }],
  ['A-M', { normal: 69.9, promocao: null, fimPromocao: null }],
  ['B-M', { normal: 59.9, promocao: 49.9, fimPromocao: '2026-11-15T03:00:00Z' }],
  ['P-G', { normal: 71.9, promocao: 41.9, fimPromocao: '2026-11-20T03:00:00Z' }],
  ['A-G', { normal: null, promocao: null, fimPromocao: null }],
]);

describe('somaAvulsa', () => {
  it('soma as peças da combinação com cores de preços diferentes; peça sem promoção entra pelo normal', () => {
    const s = somaAvulsa(pecas, precos, ['Preto', 'Azul'], 'M');
    expect(s).toEqual({ normal: 141.8, promocao: 111.8, temPromocao: true, fimPromocao: '2026-11-20T03:00:00Z', disponivel: true });
  });

  it('sem promoção em nenhuma peça: promoção = normal e temPromocao false', () => {
    const s = somaAvulsa(pecas, new Map([['A-M', { normal: 69.9, promocao: null, fimPromocao: null }], ['P-M', { normal: 71.9, promocao: null, fimPromocao: null }]]), ['Preto', 'Azul'], 'M');
    expect(s).toMatchObject({ normal: 141.8, promocao: 141.8, temPromocao: false, fimPromocao: null, disponivel: true });
  });

  it('fim da promoção: a data mais próxima entre as peças', () => {
    expect(somaAvulsa(pecas, precos, ['Preto', 'Branco'], 'M').fimPromocao).toBe('2026-11-15T03:00:00Z');
  });

  it('peça sem leitura (ou fora do mapa) deixa a soma indisponível', () => {
    expect(somaAvulsa(pecas, precos, ['Preto', 'Azul'], 'G').disponivel).toBe(false);
    expect(somaAvulsa(pecas, undefined, ['Preto', 'Azul'], 'M').disponivel).toBe(false);
  });
});

describe('compararKit', () => {
  const linhas = [
    { rotulo: 'Preto e Azul', tamanho: 'M', soma: somaAvulsa(pecas, precos, ['Preto', 'Azul'], 'M') },
    { rotulo: 'Preto e Branco', tamanho: 'M', soma: somaAvulsa(pecas, precos, ['Preto', 'Branco'], 'M') },
  ];

  it('pior = menor soma em promoção, com o desconto do kit sobre as duas somas', () => {
    const c = compararKit(78.9, linhas);
    expect(c.pior?.rotulo).toBe('Preto e Branco');
    expect(c.pior?.soma.promocao).toBe(91.8);
    expect(c.descontoNormal).toBe(40); // 1 − 78,90/131,80
    expect(c.descontoPromocao).toBe(14); // 1 − 78,90/91,80
    expect(c.maisCaro).toBe(false);
  });

  it('aviso quando o kit ≥ soma em promoção em qualquer combinação', () => {
    const c = compararKit(91.8, linhas);
    expect(c.maisCaro).toBe(true);
    expect(c.referencia).toBe(91.8);
    expect(c.fimPromocao).toBe('2026-11-15T03:00:00Z');
  });

  it('sem promoção, compara com a soma no preço normal', () => {
    const semPromo = new Map([...precos].map(([k, v]) => [k, { ...v, promocao: null, fimPromocao: null }]));
    const l = [{ rotulo: 'Preto e Azul', tamanho: 'M', soma: somaAvulsa(pecas, semPromo, ['Preto', 'Azul'], 'M') }];
    expect(compararKit(141.79, l).maisCaro).toBe(false);
    expect(compararKit(141.8, l).maisCaro).toBe(true);
    expect(compararKit(141.8, l).fimPromocao).toBeNull();
  });

  it('sem preço digitado: mantém a pior combinação (referência visível), sem desconto nem aviso', () => {
    const c = compararKit(0, linhas);
    expect(c.pior?.rotulo).toBe('Preto e Branco');
    expect(c).toMatchObject({ descontoNormal: null, descontoPromocao: null, maisCaro: false, fimPromocao: null });
  });

  it('fim da promoção só da pior combinação (a citada no aviso)', () => {
    const m = new Map([
      ['A-M', { normal: 44.5, promocao: null, fimPromocao: null }],
      ['B-M', { normal: 44.5, promocao: null, fimPromocao: null }],
      ['P-M', { normal: 71.9, promocao: 50, fimPromocao: '2026-11-15T03:00:00Z' }],
    ]);
    const l = [
      { rotulo: 'Azul e Branco', tamanho: 'M', soma: somaAvulsa(pecas, m, ['Azul', 'Branco'], 'M') }, // 89, sem promoção
      { rotulo: 'Preto e Azul', tamanho: 'M', soma: somaAvulsa(pecas, m, ['Preto', 'Azul'], 'M') }, // 94,50 em promoção
    ];
    expect(compararKit(90, l)).toMatchObject({ maisCaro: true, referencia: 89, fimPromocao: null });
    // Aviso cita a pior (Azul e Branco, sem promoção): a data de outra combinação não entra no aviso.
    expect(compararKit(95, l)).toMatchObject({ maisCaro: true, referencia: 89, fimPromocao: null });
  });

  it('igualEmTodas: só com soma normal e em promoção iguais em todas e nenhuma indisponível', () => {
    const iguais = new Map([
      ['P-M', { normal: 70, promocao: 40, fimPromocao: null }],
      ['A-M', { normal: 70, promocao: 40, fimPromocao: null }],
      ['B-M', { normal: 70, promocao: 40, fimPromocao: null }],
    ]);
    const l = (m: Map<string, PrecoPeca>) => [
      { rotulo: 'Preto e Azul', tamanho: 'M', soma: somaAvulsa(pecas, m, ['Preto', 'Azul'], 'M') },
      { rotulo: 'Preto e Branco', tamanho: 'M', soma: somaAvulsa(pecas, m, ['Preto', 'Branco'], 'M') },
    ];
    expect(compararKit(60, l(iguais)).igualEmTodas).toBe(true);
    // Promoção empatada, normal diferente: não é igual em todas (a linha mostra os dois valores).
    const normalDif = new Map(iguais); normalDif.set('B-M', { normal: 60, promocao: 40, fimPromocao: null });
    expect(compararKit(60, l(normalDif)).igualEmTodas).toBe(false);
    // Linha indisponível: não afirma igualdade.
    expect(compararKit(60, [...l(iguais), { rotulo: 'Preto e Azul', tamanho: 'G', soma: somaAvulsa(pecas, precos, ['Preto', 'Azul'], 'G') }]).igualEmTodas).toBe(false);
    expect(compararKit(60, [l(iguais)[0]]).igualEmTodas).toBe(false); // uma linha só: nada a comparar
  });

  it('alguma soma indisponível: semComparacao, e as comparáveis continuam valendo', () => {
    const l = [...linhas, { rotulo: 'Preto e Azul', tamanho: 'G', soma: somaAvulsa(pecas, precos, ['Preto', 'Azul'], 'G') }];
    expect(compararKit(50, l)).toMatchObject({ semComparacao: true, maisCaro: false });
    expect(compararKit(500, l)).toMatchObject({ semComparacao: true, maisCaro: true });
    const so = compararKit(500, [l[2]]);
    expect(so).toMatchObject({ semComparacao: true, maisCaro: false, pior: null });
  });
});
