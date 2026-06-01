import { describe, it, expect } from 'vitest';
import { categoriaParaTipo, montarAtributosML, atributosFaltantes } from '../atributos';

describe('categoriaParaTipo (IDs reais validados na API ML)', () => {
  it('mapeia os 3 tipos conhecidos para categorias-folha', () => {
    expect(categoriaParaTipo('linha')).toBe('MLB270273');
    expect(categoriaParaTipo('fita')).toBe('MLB255054');
    expect(categoriaParaTipo('botao')).toBe('MLB270272');
  });
  it('tipo "outro" não tem categoria (operador resolve)', () => {
    expect(categoriaParaTipo('outro')).toBe(null);
  });
});

describe('montarAtributosML', () => {
  it('linha: BRAND fixo + MODEL do nome', () => {
    const a = montarAtributosML('linha', 'LINHA P/COST.XIK 120 2000J CORES');
    expect(a).toEqual([
      { id: 'BRAND', value_name: 'Avil' },
      { id: 'MODEL', value_name: 'LINHA P/COST.XIK 120 2000J CORES' },
    ]);
  });

  it('fita: BRAND + RIBBON_TYPE inferido do nome (cetim)', () => {
    const a = montarAtributosML('fita', 'FITA CETIM PROGRESSO N.3 CORES 10MT');
    expect(a).toContainEqual({ id: 'BRAND', value_name: 'Avil' });
    expect(a).toContainEqual({ id: 'RIBBON_TYPE', value_id: '22691458' }); // Cetim
  });

  it('fita: RIBBON_TYPE default "Fita" quando o tipo não é reconhecido', () => {
    const a = montarAtributosML('fita', 'FITA DECORATIVA XYZ');
    expect(a).toContainEqual({ id: 'RIBBON_TYPE', value_id: '22691456' }); // Fita
  });

  it('fita: reconhece gorgorão/organza/veludo/renda/viés/estampada', () => {
    expect(montarAtributosML('fita', 'Fita Gorgorão')).toContainEqual({ id: 'RIBBON_TYPE', value_id: '22691455' });
    expect(montarAtributosML('fita', 'Fita Organza')).toContainEqual({ id: 'RIBBON_TYPE', value_id: '22691457' });
    expect(montarAtributosML('fita', 'Fita Veludo')).toContainEqual({ id: 'RIBBON_TYPE', value_id: '22691459' });
    expect(montarAtributosML('fita', 'Viés 18mm')).toContainEqual({ id: 'RIBBON_TYPE', value_id: '5038983' });
  });

  it('botao: BRAND + MATERIAL (default Acrílico, Madeira quando no nome)', () => {
    expect(montarAtributosML('botao', 'Botão de Pressão')).toContainEqual({ id: 'MATERIAL', value_id: '1258137' }); // Acrílico
    expect(montarAtributosML('botao', 'Botão de Madeira')).toContainEqual({ id: 'MATERIAL', value_id: '2431881' }); // Madeira
  });

  it('outro: sem atributos (sem categoria)', () => {
    expect(montarAtributosML('outro', 'qualquer')).toEqual([]);
  });
});

describe('atributosFaltantes (validação pré-publicação)', () => {
  it('linha completa → nada falta', () => {
    const a = montarAtributosML('linha', 'LINHA X');
    expect(atributosFaltantes('linha', a)).toEqual([]);
  });
  it('detecta obrigatório ausente', () => {
    expect(atributosFaltantes('fita', [{ id: 'BRAND', value_name: 'Avil' }])).toEqual(['RIBBON_TYPE']);
  });
  it('tipo outro → reporta categoria indefinida', () => {
    expect(atributosFaltantes('outro', [])).toEqual(['CATEGORIA']);
  });
});
