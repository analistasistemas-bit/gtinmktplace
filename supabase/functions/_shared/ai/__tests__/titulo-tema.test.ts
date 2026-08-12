import { describe, it, expect } from 'vitest';
import { posProcessarTitulo } from '../titulo-pos';
import { SLOTS_VAZIOS } from '../titulo-slots';

const OXFORD = {
  nomePai: 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium',
  descricaoPai: 'Tecido Oxford Liso de 10 metros Contínuo estampas de Natal com qualidade Premium, Largura de 1,50 metros, composição: 100% Poliester, Gramatura: 145g/m²',
  tipoProdutoBusca: 'tecido oxford',
  cores: ['Verde Musgo', 'Vermelho'],
  fornecedor: null,
};

describe('tema comemorativo no título (ADR-0115)', () => {
  it('a IA descartou o tema → o guard crava em `produto`, que é incortável', () => {
    // Slots reais devolvidos pelo gpt-4.1-mini em 12/08/2026 com a instrução já no prompt.
    const titulo = posProcessarTitulo({
      ...SLOTS_VAZIOS,
      produto: 'Tecido Oxford Liso',
      medida: '10m x 1,50m',
      material: '100% Poliéster',
    }, OXFORD);
    expect(titulo).toContain('Natal');
    expect(titulo.length).toBeLessThanOrEqual(60);
  });

  it('a fonte fala de estampa → o tema entra como "Estampa Natal", não "Natal" solto', () => {
    const titulo = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Tecido Oxford', medida: '10m' },
      OXFORD,
    );
    expect(titulo).toContain('Estampa Natal');
  });

  it('produto temático sem estampa na fonte → só o tema, sem inventar o atributo "Estampa"', () => {
    const titulo = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Bola Decorativa', medida: '8cm' },
      { ...OXFORD, nomePai: 'BOLA DECORATIVA DE NATAL 8CM', descricaoPai: 'Bola de natal para árvore.', tipoProdutoBusca: '' },
    );
    expect(titulo).toContain('Natal');
    expect(titulo).not.toContain('Estampa');
  });

  it('a IA já trouxe o tema → não duplica', () => {
    const titulo = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Tecido Oxford Estampa Natal', medida: '10m' },
      OXFORD,
    );
    expect(titulo.match(/Natal/g)).toHaveLength(1);
  });

  it('fonte sem tema nenhum → título intocado', () => {
    const titulo = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha de Costura', medida: '10000m' },
      { nomePai: 'LINHA DE COSTURA 10000M', descricaoPai: 'Cone com 10000 metros.', tipoProdutoBusca: '', cores: [], fornecedor: null },
    );
    expect(titulo).toBe('Linha de Costura 10000m');
  });

  it('"natalino" não dispara por dentro de outra palavra, mas dispara sozinho', () => {
    const base = { descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null };
    const comTema = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Enfeite', medida: '5cm' },
      { ...base, nomePai: 'ENFEITE NATALINO 5CM' },
    );
    expect(comTema).toContain('Natal');
  });

  it('produto longo demais → abandona o tema em vez de tornar o título inviável', () => {
    const produtoLongo = 'Tecido Oxford Estampado Decorativo Premium Especial';
    const titulo = posProcessarTitulo(
      { ...SLOTS_VAZIOS, produto: produtoLongo, medida: '10m' },
      { ...OXFORD, tipoProdutoBusca: '' },
    );
    // Sem a trava, produto + " Estampa Natal" passaria de 60 junto da medida e a família morreria.
    expect(titulo).not.toContain('Natal');
    expect(titulo.length).toBeLessThanOrEqual(60);
  });
});
