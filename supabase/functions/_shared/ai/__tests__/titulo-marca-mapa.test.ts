import { describe, it, expect } from 'vitest';

import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

/**
 * ADR-0101 — o mapa razão social → marca corrige GRAFIA, não substitui ENTIDADE.
 *
 * Medido em produção (`scripts/censo-descartes/`): 125 de 304 famílias perdiam a marca, e em 52
 * delas havia perda líquida — a IA tinha extraído uma marca ancorada na fonte e o mapa a
 * sobrescrevia por uma razão social ausente da fonte, que `validarSlotsAncorados` então derrubava.
 * Resultado: título sem marca nenhuma.
 */

function fonte(over: Partial<DadosFonteTitulo> = {}): DadosFonteTitulo {
  return {
    nomePai: '',
    descricaoPai: '',
    tipoProdutoBusca: '',
    cores: [],
    fornecedor: null,
    ...over,
  };
}

function slots(over: Partial<TituloSlots> = {}): TituloSlots {
  return { ...SLOTS_VAZIOS, produto: 'Barbante', ...over };
}

/** Pipeline real, menos a montagem: é onde marca é injetada e depois validada. */
function marcaFinal(s: TituloSlots, f: DadosFonteTitulo): string {
  return validarSlotsAncorados(aplicarGuardsTitulo(normalizarSlots(s), f), f).marca;
}

describe('marca: o mapa dá a grafia, não troca a entidade (ADR-0101)', () => {
  it('PRESERVA a marca da IA quando a do mapa não está ancorada na fonte', () => {
    // Caso real 02186551: fornecedor ECOFIBRA, mas o produto é EUROROMA — e só EUROROMA está
    // na fonte. Antes deste fix o título saía sem marca alguma.
    const f = fonte({
      nomePai: 'EUROROMA 4/6 CORES 600G 610MT',
      descricaoPai: 'BARBANTE 4/6. O BARBANTE EUROROMA 4/6 (600G) É A ESCOLHA PERFEITA...',
      fornecedor: 'ECOFIBRA INDUSTRIA TEXTIL',
    });
    expect(marcaFinal(slots({ marca: 'EUROROMA' }), f)).toBe('EUROROMA');
  });

  it('PRESERVA quando o mapa erra o número gramatical (Bandeirante × BANDEIRANTES)', () => {
    // `jaContem` usa fronteira de palavra, então 'Bandeirante' não casa dentro de 'BANDEIRANTES'
    // — o mapa não fica ancorado e não pode vencer a marca real da fonte.
    const f = fonte({
      nomePai: 'BARBANTE ALGODAO CONES 4/8 CORES 465MT',
      descricaoPai: 'BARBANTE BANDEIRANTES 4/8. CONTÉM: ROLO COM 465 METROS.',
      fornecedor: 'FABRICA DE BARBANTE BANDEIRANT',
    });
    expect(marcaFinal(slots({ marca: 'Bandeirantes' }), f)).toBe('Bandeirantes');
  });

  it('o mapa AINDA corrige a grafia quando está ancorado na fonte', () => {
    // O propósito original do mapa (titulo-marcas.ts) segue intacto: a fonte escreve "CIRCULO",
    // o mapa devolve a forma acentuada "Círculo".
    const f = fonte({
      nomePai: 'LINHA CIRCULO 100M',
      descricaoPai: 'LINHA DA CIRCULO PARA CROCHÊ.',
      fornecedor: 'CIRCULO S.A.',
    });
    expect(marcaFinal(slots({ marca: 'circulo' }), f)).toBe('Círculo');
  });

  it('com a IA sem marca, o mapa continua injetando (e a fonte segue decidindo)', () => {
    const ancorada = fonte({
      nomePai: 'FITA BUFALO 25MM',
      descricaoPai: 'FITA DA BUFALO.',
      fornecedor: 'BUFALO',
    });
    expect(marcaFinal(slots({ marca: '' }), ancorada)).toBe('Búfalo');

    const semAncora = fonte({
      nomePai: 'FITA VELUDO 25MM',
      descricaoPai: 'FITA DE VELUDO.',
      fornecedor: 'BUFALO',
    });
    expect(marcaFinal(slots({ marca: '' }), semAncora)).toBe('');
  });

  it('marca da IA não ancorada continua caindo — o fix não afrouxa a ancoragem', () => {
    const f = fonte({
      nomePai: 'BARBANTE 4/6 600G',
      descricaoPai: 'BARBANTE DE ALGODÃO.',
      fornecedor: 'ECOFIBRA INDUSTRIA TEXTIL',
    });
    expect(marcaFinal(slots({ marca: 'Inventada' }), f)).toBe('');
  });

  it('nome de loja nunca vira marca, mesmo vindo da IA e presente na fonte', () => {
    const f = fonte({
      nomePai: 'FITA AVIL 25MM',
      descricaoPai: 'FITA DA AVIL.',
      fornecedor: 'AVIL',
    });
    expect(marcaFinal(slots({ marca: 'AVIL' }), f)).toBe('');
  });
});
