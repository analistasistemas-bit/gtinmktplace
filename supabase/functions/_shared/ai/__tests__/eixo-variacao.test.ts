import { describe, it, expect } from 'vitest';
import { extrairSufixoVariacao, resolverEixoVariacao } from '../eixo-variacao';

const PAI = 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium';
const DESC = 'Tecido Oxford Liso de 10 metros Contínuo estampas de Natal com qualidade Premium.';
const est = (n: string) => ({ nome: `${PAI} ${n}` });

describe('extrairSufixoVariacao', () => {
  it('devolve o sufixo na grafia original', () => {
    expect(extrairSufixoVariacao(`${PAI} Est.6`, PAI)).toBe('Est.6');
  });

  it('tolera acento e caixa diferentes entre variação e pai — compara normalizado, devolve original', () => {
    expect(extrairSufixoVariacao('LINHA BÚFALO 100M Cor Azul', 'linha bufalo 100m')).toBe('Cor Azul');
  });

  it('espaçamento irregular não impede o casamento', () => {
    expect(extrairSufixoVariacao(`${PAI}   Est.9`, `  ${PAI} `)).toBe('Est.9');
  });

  it('nome idêntico ao pai → null (não há sufixo discriminante)', () => {
    expect(extrairSufixoVariacao(PAI, PAI)).toBeNull();
  });

  it('nome que não começa pelo pai → null', () => {
    expect(extrairSufixoVariacao('Outro Produto Est.6', PAI)).toBeNull();
  });

  it('pai vazio ou nome ausente → null', () => {
    expect(extrairSufixoVariacao(`${PAI} Est.6`, '')).toBeNull();
    expect(extrairSufixoVariacao(null, PAI)).toBeNull();
  });
});

describe('resolverEixoVariacao', () => {
  it('sufixo numerado + "estampa" na fonte → ESTAMPAS DISPONÍVEIS com valor canônico', () => {
    const eixo = resolverEixoVariacao([est('Est.6'), est('Est.31')], PAI, DESC);
    expect(eixo).toEqual({ rotulo: 'ESTAMPAS DISPONÍVEIS', valores: ['Estampa 6', 'Estampa 31'] });
  });

  it('aceita as quatro grafias da planilha para a mesma estampa', () => {
    const pai = 'Tecido Estampado';
    const eixo = resolverEixoVariacao(
      [{ nome: `${pai} Est.1` }, { nome: `${pai} Est-2` }, { nome: `${pai} EST 3` }, { nome: `${pai} Est4` }],
      pai,
      'tecido estampado',
    );
    expect(eixo?.valores).toEqual(['Estampa 1', 'Estampa 2', 'Estampa 3', 'Estampa 4']);
  });

  it('ordena numericamente — 6 antes de 18, que a ordem alfabética inverteria', () => {
    const eixo = resolverEixoVariacao([est('Est.18'), est('Est.6'), est('Est.33')], PAI, DESC);
    expect(eixo?.valores).toEqual(['Estampa 6', 'Estampa 18', 'Estampa 33']);
  });

  it('sem a palavra "estampa" na fonte → rótulo genérico e sufixo literal, sem reescrever', () => {
    const pai = 'Camiseta Básica';
    const eixo = resolverEixoVariacao([{ nome: `${pai} Tam.P` }, { nome: `${pai} Tam.G` }], pai, 'camiseta');
    expect(eixo?.rotulo).toBe('VARIAÇÕES DISPONÍVEIS');
    expect(eixo?.valores).toEqual(['Tam.G', 'Tam.P']);
  });

  it('UMA variação sem sufixo invalida o eixo inteiro — lista parcial descreveria errado o anúncio', () => {
    expect(resolverEixoVariacao([est('Est.6'), { nome: PAI }], PAI, DESC)).toBeNull();
  });

  it('variação sem nome → null (cai no caminho de cor)', () => {
    expect(resolverEixoVariacao([est('Est.6'), { nome: null }], PAI, DESC)).toBeNull();
  });

  it('família mono-variação → null (território do ADR-0044, cor única vai ao título)', () => {
    expect(resolverEixoVariacao([est('Est.6')], PAI, DESC)).toBeNull();
  });

  it('sufixos repetidos que colapsam em um só valor → null, não discriminam nada', () => {
    expect(resolverEixoVariacao([est('Est.6'), est('Est-6')], PAI, DESC)).toBeNull();
  });
});
