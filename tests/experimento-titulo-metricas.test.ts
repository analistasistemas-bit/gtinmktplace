import { describe, it, expect } from 'vitest';
import { colisoes, marcaAncorada, terminaEmAdjetivoVazio, unidadeCanonica } from '../scripts/experimento-titulo/metricas';

describe('terminaEmAdjetivoVazio', () => {
  it('detecta os reincidentes medidos em produção', () => {
    expect(terminaEmAdjetivoVazio('FITA CETIM 10MT | 100% POLIÉSTER | ELEGANTE')).toBe(true);
    expect(terminaEmAdjetivoVazio('RENDA BÚFALO 20MM 50M | ALTA DURABILIDADE')).toBe(true);
    expect(terminaEmAdjetivoVazio('LANTEJOULA 50MT 6MM | PVC DE ALTA QUALIDADE')).toBe(true);
  });

  it('NÃO acusa composição, que é dado ancorado', () => {
    expect(terminaEmAdjetivoVazio('FITA CETIM BUFALO N.1 100MT | 100% POLIÉSTER')).toBe(false);
  });

  it('NÃO acusa cor, que é discriminador legítimo', () => {
    expect(terminaEmAdjetivoVazio('CURSOR N.5 1000UND | BRANCO')).toBe(false);
  });

  it('funciona sem pipe (formato novo)', () => {
    expect(terminaEmAdjetivoVazio('Fita de Cetim Búfalo N.3 10m Resistente')).toBe(true);
    expect(terminaEmAdjetivoVazio('Fita de Cetim Búfalo N.3 10m 100% Poliéster')).toBe(false);
  });
});

describe('unidadeCanonica', () => {
  it('reprova MT, MTS, UND e GR', () => {
    expect(unidadeCanonica('FITA 100MT')).toBe(false);
    expect(unidadeCanonica('LANTEJOULA C/50MTS')).toBe(false);
    expect(unidadeCanonica('SACO 10UND')).toBe(false);
    expect(unidadeCanonica('NOVELO 500GR')).toBe(false);
  });

  it('aprova m, un, g minúsculos', () => {
    expect(unidadeCanonica('Fita de Cetim 100m')).toBe(true);
    expect(unidadeCanonica('Saco de Organza 10un')).toBe(true);
    expect(unidadeCanonica('Novelo 500g')).toBe(true);
  });
});

describe('marcaAncorada', () => {
  it('confirma a marca do mapa presente no título E na fonte', () => {
    expect(marcaAncorada('Fita de Cetim Búfalo N.3', 'FITA CETIM BUFALO N.3 CORES', 'BUFALO')).toBe(true);
  });

  it('acusa marca no título que NÃO está na fonte', () => {
    expect(marcaAncorada('Fita Detallia 25m', 'FITAS DE VELUDO 20MM CORES C/25MTS', 'DETALLIA FITAS TEXTEIS LTDA')).toBe(false);
  });

  it('acusa marca ausente do título mesmo estando na fonte', () => {
    expect(marcaAncorada('Fita de Cetim N.3 10m', 'FITA CETIM BUFALO N.3', 'BUFALO')).toBe(false);
  });

  it('devolve null quando o fornecedor está fora do mapa — não entra no denominador', () => {
    expect(marcaAncorada('Fita de Cetim 10m', 'FITA CETIM', 'FORNECEDOR NOVO')).toBeNull();
    expect(marcaAncorada('Fita de Cetim 10m', 'FITA CETIM', null)).toBeNull();
  });

  it('não confunde o substantivo do produto com marca', () => {
    // "Fita" está na fonte, mas não é marca. A medida tem de olhar SÓ a marca do mapa,
    // senão retorna true para quase todo título e o critério de aceite vira infalsificável.
    expect(marcaAncorada('Fita de Veludo 25m', 'FITAS DE VELUDO 20MM CORES C/25MTS', 'DETALLIA FITAS TEXTEIS LTDA')).toBe(false);
  });
});

describe('colisoes', () => {
  it('conta títulos idênticos entre produtos distintos', () => {
    expect(colisoes([
      { codigoPai: '1', titulo: 'Fita 10m' },
      { codigoPai: '2', titulo: 'Fita 10m' },
      { codigoPai: '3', titulo: 'Fita 100m' },
    ])).toBe(1);
  });

  it('não conta o mesmo produto reingerido', () => {
    expect(colisoes([
      { codigoPai: '1', titulo: 'Fita 10m' },
      { codigoPai: '1', titulo: 'Fita 10m' },
    ])).toBe(0);
  });
});
