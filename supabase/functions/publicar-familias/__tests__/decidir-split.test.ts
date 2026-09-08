import { describe, it, expect } from 'vitest';
import { decidirSplit } from '../decidir-split';

describe('decidirSplit', () => {
  it('uniforme, ≤100 cores, 1 partição → caminho normal (caracterização)', () => {
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, null], qtdParticoes: 1 })).toBe(false);
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, 1000], qtdParticoes: 0 })).toBe(false);
  });
  it('>100 cores → split (ADR-0048, comportamento atual)', () => {
    expect(decidirSplit({ qtdCores: 101, precosCentavos: Array(101).fill(1000), qtdParticoes: 0 })).toBe(true);
  });
  it('preços divergentes → split, mesmo com poucas cores (ADR-0078 F2, família Legacy)', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0 })).toBe(true);
  });
  it('produto já particionado (N anúncios no ar) → split sempre, mesmo uniforme', () => {
    expect(decidirSplit({ qtdCores: 5, precosCentavos: [1000, 1000, 1000, 1000, 1000], qtdParticoes: 2 })).toBe(true);
  });
});

// ADR-0160 — o split por faixa nasceu de uma restrição do modelo LEGACY: um anúncio, um preço.
// Sob User Products cada cor já é um item ML próprio com preço próprio, então dividir ali criaria
// N anúncios para resolver um problema que o modelo não tem — e mover variação publicada entre
// itens no ML custa deletar e recriar (perde vendas, perguntas, histórico).
describe('decidirSplit — família User Products (ADR-0160)', () => {
  it('preços divergentes em família UP → NÃO divide', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0, ehUP: true })).toBe(false);
  });

  it('uniforme em UP também não divide (nada mudou nesse caso)', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1000], qtdParticoes: 0, ehUP: true })).toBe(false);
  });

  // O cap de cores é limite do ML, não do modelo de preço: continua valendo sob UP.
  it('>100 cores divide mesmo em UP', () => {
    expect(decidirSplit({ qtdCores: 101, precosCentavos: Array(101).fill(1000), qtdParticoes: 0, ehUP: true })).toBe(true);
  });

  // Família já dividida em N partições segue com o split worker, que é quem conhece as partições
  // (ADR-0105 §7 — esse caso continua sendo beco sem saída se a categoria migrar).
  it('já particionada divide mesmo em UP', () => {
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, 1000], qtdParticoes: 2, ehUP: true })).toBe(true);
  });

  // Ausência do sinal = Legacy. Conservador de propósito: o comportamento anterior é o default.
  it('ehUP ausente se comporta como Legacy', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0 })).toBe(true);
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0, ehUP: false })).toBe(true);
  });
});

// ADR-0160 — "somente estoque" não envia preço nenhum (ADR-0078 F2 #3), então divergência de preço
// no banco não é motivo para dividir anúncio.
//
// Sem isto, a saída que o guard de preço uniforme ENSINA ("publique uma vez como somente estoque
// para o app adotar a migração") era inalcançável: uma família migrada pelo ML, ainda não adotada e
// já com preços divergentes, ia para o split antes de alguém olhar `somenteEstoque` — e o split
// worker não adota família migrada, manda refazer a publicação. O operador seguiria uma instrução
// que não funciona.
describe('decidirSplit — somente estoque (ADR-0160)', () => {
  it('divergência + somenteEstoque → NÃO divide', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0, somenteEstoque: true })).toBe(false);
  });

  it('sem somenteEstoque a divergência continua dividindo', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0, somenteEstoque: false })).toBe(true);
  });

  // Família já particionada segue no split worker mesmo em somente estoque: só ele conhece as N
  // partições e sabe repor estoque em cada uma.
  it('já particionada divide mesmo em somenteEstoque', () => {
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, 1000], qtdParticoes: 2, somenteEstoque: true })).toBe(true);
  });

  it('>100 cores divide mesmo em somenteEstoque', () => {
    expect(decidirSplit({ qtdCores: 101, precosCentavos: Array(101).fill(1000), qtdParticoes: 0, somenteEstoque: true })).toBe(true);
  });
});
