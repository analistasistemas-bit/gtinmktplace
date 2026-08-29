import { describe, expect, it } from 'vitest';
import { montarDreSonar, precosDerivadosDre, type EntradaDreSonar } from '../dre-sonar';
import type { Tarifa } from '../tarifa';

// ADR-0148: a DRE calcula com UMA cotação real, no preço do anúncio, e RECUSA quando o número não
// é oficial. Nunca zero, nunca traço mudo, nunca número com asterisco.

const tarifa = (over: Partial<Tarifa> = {}): Tarifa => ({
  classico: { comissao: 12.59, percentual: 14, fixa: 0, imposto: 0, recebe: 68.86 },
  premium: { comissao: 16.18, percentual: 18, fixa: 0, imposto: 0, recebe: 65.27 },
  frete: 8.45,
  proveniencia: 'official',
  ...over,
});

const entrada = (over: Partial<EntradaDreSonar> = {}): EntradaDreSonar => ({
  precoAnuncio: 89.9,
  custoProduto: 42,
  origem: 'nacional',
  aliquotas: { nacional: 8, importado: 16 },
  // Lata de 800 g: 18×13×13 cm, 950 g. Sem isto o ML cota o pacote padrão e a proveniência
  // nunca chega a `official` (ADR-0148 D-28) — ver o bloco da D-16 no fim do arquivo.
  dimensoes: { alturaCm: 18, larguraCm: 13, comprimentoCm: 13, pesoKg: 0.95 },
  tarifa: tarifa(),
  ...over,
});

describe('montarDreSonar', () => {
  it('calcula com cotação oficial e decompõe receita, comissão, frete, imposto e custo', () => {
    const d = montarDreSonar(entrada());
    expect(d.estado).toBe('calculada');
    if (d.estado !== 'calculada') return;
    expect(d.receita).toBe(89.9);
    expect(d.comissao).toBe(12.59);
    expect(d.frete).toBe(8.45);
    expect(d.imposto).toBeCloseTo(7.19, 2); // 89,90 × 8%
    expect(d.custoProduto).toBe(42);
    expect(d.lucro).toBeCloseTo(19.67, 2);
    expect(d.margemPct).toBeCloseTo(21.88, 1);
  });

  it('origem importada usa a alíquota de importado', () => {
    const d = montarDreSonar(entrada({ origem: 'importado' }));
    if (d.estado !== 'calculada') return;
    expect(d.imposto).toBeCloseTo(14.38, 2); // 89,90 × 16%
  });

  // Critério de aceite 6: imposto nunca defaulta em silêncio (ADR-0055 / ADR-0148 D-6).
  it('origem não informada NÃO calcula — imposto não se presume', () => {
    const d = montarDreSonar(entrada({ origem: null }));
    expect(d.estado).toBe('indisponivel');
    if (d.estado !== 'indisponivel') return;
    expect(d.motivo).toMatch(/origem/i);
  });

  // Critérios 3 e 4: fora de `official`, recusa.
  it.each([
    ['partial', 'o frete foi calculado com um pacote padrão'],
    ['estimated', 'o Mercado Livre não respondeu o frete'],
  ] as const)('proveniência %s recusa e repete o motivo do ML', (proveniencia, motivo) => {
    const d = montarDreSonar(entrada({ tarifa: tarifa({ proveniencia, motivo_proveniencia: motivo }) }));
    expect(d.estado).toBe('indisponivel');
    if (d.estado !== 'indisponivel') return;
    expect(d.motivo).toContain(motivo);
  });

  it('tarifa sem campo de proveniência falha fechado — nunca vira oficial por omissão', () => {
    const semCampo = tarifa();
    delete semCampo.proveniencia;
    const d = montarDreSonar(entrada({ tarifa: semCampo }));
    expect(d.estado).toBe('indisponivel');
  });

  it('cotação ausente (o ML não respondeu) recusa', () => {
    const d = montarDreSonar(entrada({ tarifa: null }));
    expect(d.estado).toBe('indisponivel');
  });

  // Critério 2: frete zero legítimo não impede a DRE.
  it('frete zero porque o comprador paga: calcula normalmente', () => {
    const d = montarDreSonar(entrada({ tarifa: tarifa({ frete: 0 }) }));
    expect(d.estado).toBe('calculada');
    if (d.estado !== 'calculada') return;
    expect(d.frete).toBe(0);
    expect(d.lucro).toBeCloseTo(28.12, 2);
  });

  it('custo não informado recusa — sem custo não há lucro a afirmar', () => {
    const d = montarDreSonar(entrada({ custoProduto: null }));
    expect(d.estado).toBe('indisponivel');
    if (d.estado !== 'indisponivel') return;
    expect(d.motivo).toMatch(/custo/i);
  });

  // Critério 5: o que ficou de fora é declarado, não omitido.
  it('declara que custos fixos, variáveis e rebate estão fora do número', () => {
    const d = montarDreSonar(entrada());
    if (d.estado !== 'calculada') return;
    expect(d.forasDoCalculo).toEqual(
      expect.arrayContaining([expect.stringMatching(/fixos/i), expect.stringMatching(/vari/i), expect.stringMatching(/rebate/i)]),
    );
  });

  it('lucro negativo é resultado válido, não recusa', () => {
    const d = montarDreSonar(entrada({ custoProduto: 80 }));
    expect(d.estado).toBe('calculada');
    if (d.estado !== 'calculada') return;
    expect(d.lucro).toBeLessThan(0);
  });
});

// ADR-0149 D-3: preço-alvo e ponto de equilíbrio saem da cotação da ÂNCORA, porque não há como
// cotar um preço antes de conhecê-lo. São projeção, e a tela os marca como tal.
describe('precosDerivadosDre', () => {
  it('devolve ponto de equilíbrio e preço-alvo a partir da cotação da âncora', () => {
    const p = precosDerivadosDre(entrada(), 25);
    expect(p.pontoEquilibrio).not.toBeNull();
    expect(p.precoAlvo).not.toBeNull();
    // Equilíbrio zera o lucro: fica abaixo do preço atual, que dá lucro.
    expect(p.pontoEquilibrio!).toBeLessThan(89.9);
    // Meta de 25% é mais cara que o preço atual, que rende ~21,9%.
    expect(p.precoAlvo!).toBeGreaterThan(89.9);
  });

  it('sem margem-alvo informada não há preço-alvo — não se presume uma meta', () => {
    expect(precosDerivadosDre(entrada(), null).precoAlvo).toBeNull();
  });

  it('sem cotação oficial não há preço derivado nenhum', () => {
    const p = precosDerivadosDre(entrada({ tarifa: null }), 25);
    expect(p.pontoEquilibrio).toBeNull();
    expect(p.precoAlvo).toBeNull();
  });

  it('sem dimensões não há preço derivado — mesmo guard da DRE', () => {
    const p = precosDerivadosDre(entrada({ dimensoes: null }), 25);
    expect(p.pontoEquilibrio).toBeNull();
    expect(p.precoAlvo).toBeNull();
  });
});

// D-16 (Diego, 2026-08-28; aberta desde a ADR-0141): a seção 6 é dona de peso físico, peso
// volumétrico e peso taxável. Sem dimensões o ML cota o pacote padrão de 16×11×6 cm / 300 g, a
// proveniência vira `partial` e a DRE recusa SEMPRE — a seção nascia morta no Sonar.
describe('montarDreSonar — dimensões e peso (D-16)', () => {
  it('dimensões não informadas recusam, e o motivo NÃO culpa o Mercado Livre', () => {
    // A tarifa aqui é a que o ML devolveria sem dimensões: pacote padrão, logo `partial`.
    const d = montarDreSonar(entrada({
      dimensoes: null,
      tarifa: tarifa({ proveniencia: 'partial', motivo_proveniencia: 'o frete foi calculado com um pacote padrão' }),
    }));
    expect(d.estado).toBe('indisponivel');
    if (d.estado !== 'indisponivel') return;
    // O campo em branco é do operador: a frase tem que PEDIR a ação a ele, não relatar uma falha
    // do ML — mandá-lo esperar uma cotação seria mandá-lo esperar nada.
    expect(d.motivo).toMatch(/^informe .*(dimens|peso)/i);
    expect(d.motivo).not.toMatch(/não respondeu|não devolveu/i);
  });

  it('com dimensões, devolve peso físico, volumétrico e taxável', () => {
    const d = montarDreSonar(entrada());
    expect(d.estado).toBe('calculada');
    if (d.estado !== 'calculada') return;
    expect(d.peso.pesoCubadoKg).toBeCloseTo(0.507, 3); // 18 × 13 × 13 ÷ 6000
    expect(d.peso.pesoUtilizadoKg).toBeCloseTo(0.95, 3); // o físico vence
  });

  it('caixa grande e leve: o volumétrico vence e vira o peso taxável', () => {
    const d = montarDreSonar(entrada({
      dimensoes: { alturaCm: 40, larguraCm: 40, comprimentoCm: 40, pesoKg: 1 },
    }));
    if (d.estado !== 'calculada') return;
    expect(d.peso.pesoCubadoKg).toBeCloseTo(10.667, 3); // 64000 ÷ 6000
    expect(d.peso.pesoUtilizadoKg).toBeCloseTo(10.667, 3);
  });

  // Os 18 anúncios com 0,10 cm em produção ensinaram que dimensão inválida chega de verdade.
  // `calcularPesoUtilizado` lança RangeError; a seção 6 não pode derrubar a árvore do React.
  it.each([
    ['altura zero', { alturaCm: 0, larguraCm: 13, comprimentoCm: 13, pesoKg: 0.95 }],
    ['peso zero', { alturaCm: 18, larguraCm: 13, comprimentoCm: 13, pesoKg: 0 }],
    ['largura negativa', { alturaCm: 18, larguraCm: -1, comprimentoCm: 13, pesoKg: 0.95 }],
  ])('dimensão inválida (%s) recusa em vez de estourar', (_nome, dimensoes) => {
    const d = montarDreSonar(entrada({ dimensoes }));
    expect(d.estado).toBe('indisponivel');
    if (d.estado !== 'indisponivel') return;
    expect(d.motivo).toMatch(/dimens|peso/i);
  });

  it('quem paga o frete sai da cotação, não de regra nossa', () => {
    const pago = montarDreSonar(entrada());
    if (pago.estado !== 'calculada') return;
    expect(pago.vendedorPagaFrete).toBe(true);

    const gratis = montarDreSonar(entrada({ tarifa: tarifa({ frete: 0 }) }));
    if (gratis.estado !== 'calculada') return;
    expect(gratis.vendedorPagaFrete).toBe(false);
  });
});
