// Número com ponto de milhar ("10.000MT") virava "000m" no título: a regra só lia o fim do número.
import { describe, it, expect } from 'vitest';
import { extrairContagem, extrairMetragem } from '../titulo';
import { posProcessarTitulo, type DadosFonteTitulo } from '../titulo-pos';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const fonte = (nomePai: string, extra: Partial<DadosFonteTitulo> = {}): DadosFonteTitulo => ({
  nomePai, descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...extra,
});
const slots = (s: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...s });

describe('extração com ponto de milhar', () => {
  it.each([
    ['LINHA DE COST 10.000MT PRETO', '10.000m'],
    ['LINHA DE COST 5.000MT CORES', '5.000m'],
    ['LINHA 1.500 METROS', '1.500m'],
    ['FITA 13,71MT', '13,71m'],
    ['FITA CETIM N.1 CORES 100MT', '100m'],
  ])('%s → %s', (nome, metragem) => {
    expect(extrairMetragem(nome)).toBe(metragem);
  });

  it('contagem com milhar', () => {
    expect(extrairContagem('ALFINETE CAIXA 1.000UN')).toBe('1.000un');
  });
});

describe('título com metragem de milhar', () => {
  const nome = 'LINHA DE COST 10.000MT PRETO';

  it.each(['10.000m', '10000m', '10.000 Metros', ''])('IA escreveu medida "%s"', (medida) => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Linha de Costura', marca: 'Búfalo', medida, variacao: 'Preto' }),
      fonte(nome, { cores: ['Preto'], descricaoPai: 'Linha Búfalo 10.000MT' }),
    );
    expect(titulo).toContain('10.000m');
    expect(titulo).not.toMatch(/(^|\s)000m/);
    expect(titulo.match(/10\.?000m/g)).toHaveLength(1);
  });

  it('metragem repetida em outro slot sai inteira, sem sobrar "10."', () => {
    const titulo = posProcessarTitulo(
      slots({ produto: 'Linha de Costura 10.000MT', medida: '10.000m' }),
      fonte(nome),
    );
    expect(titulo).toBe('Linha de Costura 10.000m');
  });
});
