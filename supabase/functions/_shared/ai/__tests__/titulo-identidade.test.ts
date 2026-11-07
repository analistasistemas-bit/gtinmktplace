import { describe, it, expect } from 'vitest';
import { posProcessarTitulo, type DadosFonteTitulo } from '../titulo-pos';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';
import { SYSTEM, systemPara } from '../copywriter-prompt';

const fonte = (nomePai: string, extra: Partial<DadosFonteTitulo> = {}): DadosFonteTitulo => ({
  nomePai, descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...extra,
});
const slots = (s: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...s });

// ADR-0197: títulos aprovados pelo Diego em 07/11/2026 para o lote de cosméticos.
describe('títulos de aceitação', () => {
  it.each([
    [
      'Tanox Pop Cabelos Exuberantes 1kg - Creme para pentear e hidratar 2 em 1',
      { produto: 'Creme para Pentear 2 em 1', modelo: 'Tanox Pop Cabelos Exuberantes', medida: '1kg' },
      'Creme para Pentear 2 em 1 Tanox Pop Cabelos Exuberantes 1kg',
    ],
    [
      'Creme 2 em 1 para pentear e hidratar BRILHO UVA 1kg',
      { produto: 'Creme para Pentear 2 em 1', modelo: 'Brilho Uva', medida: '1kg' },
      'Creme para Pentear 2 em 1 Brilho Uva 1kg',
    ],
    [
      'Creme 2 em 1 para pentear e hidratar NUTRIÇÃO MORANGO 1kg',
      { produto: 'Creme para Pentear 2 em 1', modelo: 'Nutrição Morango', medida: '1kg' },
      'Creme para Pentear 2 em 1 Nutrição Morango 1kg',
    ],
    [
      'Máscara Hidrata Muito Mais Hair Fly',
      { produto: 'Máscara Capilar', marca: 'Hair Fly', modelo: 'Hidrata Muito Mais' },
      'Máscara Capilar Hair Fly Hidrata Muito Mais',
    ],
    [
      'Reparador de Pontas Umidibrilho Óleo de Argan 30ml',
      { produto: 'Reparador de Pontas', modelo: 'Umidibrilho Óleo de Argan', medida: '30ml' },
      'Reparador de Pontas Umidibrilho Óleo de Argan 30ml',
    ],
  ])('%s', (nome, s, titulo) => {
    expect(posProcessarTitulo(slots(s), fonte(nome))).toBe(titulo);
  });
});

describe('corte: nome comercial vale mais que marca', () => {
  it('estourando 60, a marca sai antes de modelo', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Creme para Pentear 2 em 1', marca: 'Hair Fly', modelo: 'Tanox Pop Cabelos Exuberantes', medida: '1kg' }),
      fonte('Tanox Pop Cabelos Exuberantes Hair Fly 1kg Creme para Pentear 2 em 1'),
    );
    expect(titulo).toBe('Creme para Pentear 2 em 1 Tanox Pop Cabelos Exuberantes 1kg');
  });
});

describe('produto longo: encurta antes de cortar identidade', () => {
  it('Tanox: "para Pentear e Hidratar" encurta e marca sai, modelo fica', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Creme para Pentear e Hidratar 2 em 1', marca: 'Tanox', modelo: 'Pop Cabelos Exuberantes', medida: '1kg' }),
      fonte('Tanox Pop Cabelos Exuberantes 1kg - Creme para pentear e hidratar 2 em 1'),
    );
    expect(titulo).toBe('Creme para Pentear 2 em 1 Tanox Pop Cabelos Exuberantes 1kg');
  });

  it('título que cabe mantém o produto inteiro', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Creme para Pentear e Hidratar', modelo: 'Brilho Uva', medida: '1kg' }),
      fonte('Creme para pentear e hidratar BRILHO UVA 1kg'),
    );
    expect(titulo).toBe('Creme para Pentear e Hidratar Brilho Uva 1kg');
  });
});

describe('variacao sem cor real', () => {
  const nome = 'Creme 2 em 1 para pentear e hidratar NUTRIÇÃO MORANGO 1kg';

  it('cor que o nome não declara sai do título', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Creme para Pentear 2 em 1', medida: '1kg', variacao: 'Vermelho' }),
      fonte(nome, { descricaoPai: 'INGREDIENTES: CORANTE VERMELHO 33' }),
    );
    expect(titulo).toBe('Creme para Pentear 2 em 1 1kg');
  });

  it('calibre continua: não é cor (CRITICAL-2)', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Agulha de Crochê', variacao: '3,5mm' }),
      fonte('AGULHA DE CROCHE 3,5MM'),
    );
    expect(titulo).toContain('3,5mm');
  });

  it('cor declarada no nome continua', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Alfinete', variacao: 'Dourado' }),
      fonte('ALFINETE N.0 DOURADO'),
    );
    expect(titulo).toContain('Dourado');
  });
});

describe('prompt', () => {
  it('ensina nome comercial em modelo e preserva 2 em 1', () => {
    expect(SYSTEM).toContain('NOME COMERCIAL');
    expect(SYSTEM).toContain('"2 em 1" fica em "produto"');
  });

  // Exemplos com `variacao=""` e seta fizeram o gpt-4.1-mini travar em 3 de 6 chamadas (07/11).
  // Exemplo aqui fica no formato do bloco EXEMPLOS: 0 de 40. Medir no modelo real antes de mudar.
  it('exemplos do bloco seguem o formato que não trava o modelo', () => {
    const bloco = SYSTEM.slice(SYSTEM.indexOf('NOME COMERCIAL'), SYSTEM.indexOf('EXEMPLOS\n\nFonte: Barbante'));
    expect(bloco).toContain('CORRETO:');
    expect(bloco).not.toContain('variacao=""');
    expect(bloco).not.toContain('→');
  });

  it('grade não recebe o bloco de nome comercial', () => {
    const grade = systemPara({ nome: 'x', descricao_detalhado: '', unidade: null, variacoes: [{ codigo: '1', cor: 'Azul', preco: 1, tamanho: 'M' }, { codigo: '2', cor: 'Azul', preco: 1, tamanho: 'G' }] });
    expect(grade).toContain('Fonte: Barbante');
    expect(grade).not.toContain('NOME COMERCIAL');
  });
});
