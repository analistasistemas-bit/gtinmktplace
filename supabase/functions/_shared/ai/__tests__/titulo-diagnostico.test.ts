import { describe, it, expect } from 'vitest';
import { diagnosticarTitulo, posProcessarTitulo } from '../titulo-pos';
import { SLOTS_VAZIOS } from '../titulo-slots';

const FONTE = {
  nomePai: 'LINHA BUFALO 10000M PRETO',
  descricaoPai: 'Cone com 10000 metros, 100% poliéster.',
  tipoProdutoBusca: '',
  cores: ['Preto'],
  fornecedor: null,
};

describe('diagnosticarTitulo (ADR-0116)', () => {
  it('devolve exatamente o mesmo título que posProcessarTitulo — é diagnóstico, não controle', () => {
    const slots = { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m', material: '100% Poliéster' };
    expect(diagnosticarTitulo(slots, FONTE).titulo).toBe(posProcessarTitulo(slots, FONTE));
  });

  it('marca não ancorada na fonte → descarte na etapa de ancoragem', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m', marca: 'Inventada' },
      FONTE,
    );
    const d = descartes.find((x) => x.slot === 'marca');
    expect(d).toMatchObject({ etapa: 'ancoragem', de: 'Inventada', para: '' });
  });

  it('sinônimo ausente da fonte → descarte, com o valor original preservado no registro', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m', sinonimo: 'Cordão' },
      FONTE,
    );
    expect(descartes.find((x) => x.slot === 'sinonimo')).toMatchObject({
      etapa: 'ancoragem', de: 'Cordão', para: '',
    });
  });

  it('adjetivo vazio some e o registro diz de onde saiu', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m', aplicacao: 'Resistente' },
      FONTE,
    );
    expect(descartes.find((x) => x.slot === 'aplicacao' && x.para === '')).toBeDefined();
  });

  it('slot derrubado pelo corte de 60 chars aparece com etapa "corte"', () => {
    const { titulo, descartes } = diagnosticarTitulo({
      ...SLOTS_VAZIOS,
      produto: 'Tecido Oxford Estampado Decorativo',
      medida: '10m',
      material: '100% Poliéster',
      compatibilidade: 'Para Maquinas Domesticas e Industriais',
      aplicacao: 'Para Toalhas de Mesa e Trilhos',
    }, { ...FONTE, cores: [], nomePai: 'TECIDO OXFORD 10M', descricaoPai: 'Para toalhas de mesa e trilhos, para maquinas domesticas e industriais, 100% poliester.' });

    expect(titulo.length).toBeLessThanOrEqual(60);
    const cortados = descartes.filter((d) => d.etapa === 'corte');
    expect(cortados.length).toBeGreaterThan(0);
    // O corte remove o slot inteiro; nunca reescreve.
    expect(cortados.every((d) => d.para === '')).toBe(true);
  });

  it('reescrita é distinguível de descarte: "para" preenchido vs ""', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000 METROS' },
      FONTE,
    );
    const medida = descartes.find((x) => x.slot === 'medida');
    expect(medida?.para).not.toBe('');
    expect(medida?.de).toBe('10000 METROS');
  });

  it('nada a descartar → lista vazia, que é diferente de "não processado"', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m' },
      { ...FONTE, cores: [] },
    );
    expect(descartes).toEqual([]);
  });

  it('todo descarte nomeia slot e etapa — o registro é inútil sem os dois', () => {
    const { descartes } = diagnosticarTitulo(
      { ...SLOTS_VAZIOS, produto: 'Linha', medida: '10000m', marca: 'Inventada', sinonimo: 'Cordão' },
      FONTE,
    );
    expect(descartes.length).toBeGreaterThan(0);
    for (const d of descartes) {
      expect(d.slot).toBeTruthy();
      expect(['normalizacao', 'guards', 'ancoragem', 'corte']).toContain(d.etapa);
    }
  });
});
