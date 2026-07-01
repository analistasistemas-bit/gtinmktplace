import { describe, it, expect } from 'vitest';
import { categoriaParaTipo, tipoParaCategoria, montarAtributosML, montarAtributosBase, atributosFaltantes, ehDuplaFace, categoriaAceitaEmptyGtinReason, extrairUnitsPerPack, preencherUnitsPerPack } from '../atributos';
import type { AtributoSchema } from '../schema';

describe('categoriaParaTipo (IDs reais validados na API ML)', () => {
  it('mapeia os tipos conhecidos para categorias-folha', () => {
    expect(categoriaParaTipo('linha')).toBe('MLB270273');
    expect(categoriaParaTipo('fita')).toBe('MLB255054');
    expect(categoriaParaTipo('botao')).toBe('MLB270272');
    expect(categoriaParaTipo('cola')).toBe('MLB277319'); // Bastões de Cola
  });
  it('tipo "outro" não tem categoria (operador resolve)', () => {
    expect(categoriaParaTipo('outro')).toBe(null);
  });
});

describe('tipoParaCategoria (lookup reverso p/ categoria vinda do preditor)', () => {
  it('recupera o tipo das categorias-folha conhecidas', () => {
    expect(tipoParaCategoria('MLB270273')).toBe('linha');
    expect(tipoParaCategoria('MLB255054')).toBe('fita');
    expect(tipoParaCategoria('MLB270272')).toBe('botao');
    expect(tipoParaCategoria('MLB277319')).toBe('cola');
  });
  it('categoria desconhecida ou nula → "outro"', () => {
    expect(tipoParaCategoria('MLB105305')).toBe('outro');
    expect(tipoParaCategoria(null)).toBe('outro');
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

  it('cola: BRAND + MODEL do nome (igual à linha)', () => {
    const a = montarAtributosML('cola', 'COLA EM BASTAO 7MM FINA 1KG', 'AVIL');
    expect(a).toEqual([
      { id: 'BRAND', value_name: 'AVIL' },
      { id: 'MODEL', value_name: 'COLA EM BASTAO 7MM FINA 1KG' },
    ]);
  });

  it('cola: categoria aceita EMPTY_GTIN_REASON (validado na API ML)', () => {
    expect(categoriaAceitaEmptyGtinReason('MLB277319')).toBe(true);
  });

  it('outro: sem atributos (sem categoria)', () => {
    expect(montarAtributosML('outro', 'qualquer')).toEqual([]);
  });

  it('fita: IS_DOUBLE_FACE = Não (242084) por padrão (face simples)', () => {
    const a = montarAtributosML('fita', 'FITA CETIM PROGRESSO N.3');
    expect(a).toContainEqual({ id: 'IS_DOUBLE_FACE', value_id: '242084' });
  });

  it('fita: IS_DOUBLE_FACE = Sim (242085) quando o detalhe indica dupla face', () => {
    const a = montarAtributosML('fita', 'FITA CETIM N.3', 'Avil', 'Fita de cetim dupla face, brilho nos dois lados.');
    expect(a).toContainEqual({ id: 'IS_DOUBLE_FACE', value_id: '242085' });
  });

  it('linha/botao: NÃO recebem IS_DOUBLE_FACE (atributo só da categoria fita)', () => {
    expect(montarAtributosML('linha', 'LINHA X', 'Avil', 'dupla face')).not.toContainEqual(
      expect.objectContaining({ id: 'IS_DOUBLE_FACE' }),
    );
    expect(montarAtributosML('botao', 'BOTAO', 'Avil', 'dupla face')).not.toContainEqual(
      expect.objectContaining({ id: 'IS_DOUBLE_FACE' }),
    );
  });

  it('usa o fornecedor como BRAND quando informado', () => {
    const a = montarAtributosML('linha', 'LINHA X', 'LINHAS SETTA LTDA');
    expect(a).toContainEqual({ id: 'BRAND', value_name: 'LINHAS SETTA LTDA' });
  });

  it('fallback "Avil" quando a marca é vazia ou só espaços', () => {
    expect(montarAtributosML('fita', 'FITA CETIM', '   ')).toContainEqual({ id: 'BRAND', value_name: 'Avil' });
    expect(montarAtributosML('botao', 'BOTAO', '')).toContainEqual({ id: 'BRAND', value_name: 'Avil' });
  });
});

describe('ehDuplaFace (detecção no texto da planilha)', () => {
  it('reconhece "dupla face", "face dupla", "dupla-face", "duas faces", "dois lados"', () => {
    expect(ehDuplaFace('Fita dupla face')).toBe(true);
    expect(ehDuplaFace('acabamento face dupla premium')).toBe(true);
    expect(ehDuplaFace('Fita dupla-face')).toBe(true);
    expect(ehDuplaFace('estampa em duas faces')).toBe(true);
    expect(ehDuplaFace('brilho nos dois lados')).toBe(true);
    expect(ehDuplaFace('FITA DUPLA FACE')).toBe(true); // case/acento-insensível
  });
  it('face simples / texto vazio → false', () => {
    expect(ehDuplaFace('Fita de cetim comum')).toBe(false);
    expect(ehDuplaFace('')).toBe(false);
    expect(ehDuplaFace(undefined)).toBe(false);
  });
});

describe('atributosFaltantes (validação pré-publicação)', () => {
  it('linha completa → nada falta', () => {
    const a = montarAtributosML('linha', 'LINHA X');
    expect(atributosFaltantes('linha', a)).toEqual([]);
  });
  it('cola completa → nada falta', () => {
    const a = montarAtributosML('cola', 'COLA EM BASTAO 7MM');
    expect(atributosFaltantes('cola', a)).toEqual([]);
  });
  it('detecta obrigatório ausente', () => {
    expect(atributosFaltantes('fita', [{ id: 'BRAND', value_name: 'Avil' }])).toEqual(['RIBBON_TYPE']);
  });
  it('tipo outro → reporta categoria indefinida', () => {
    expect(atributosFaltantes('outro', [])).toEqual(['CATEGORIA']);
  });
});

describe('extrairUnitsPerPack (quantidade no nome/descrição)', () => {
  it('extrai de "100UND" colado (convenção do título)', () => {
    expect(extrairUnitsPerPack('ALFINETE DE SEGURANÇA N.O 100UND | 100% FERRO')).toBe(100);
  });
  it('extrai de variações com espaço e acento/case', () => {
    expect(extrairUnitsPerPack('Botão 12 unidades')).toBe(12);
    expect(extrairUnitsPerPack('LINHA 24 UN')).toBe(24);
    expect(extrairUnitsPerPack('elástico 50 peças')).toBe(50);
    expect(extrairUnitsPerPack('kit 6 pçs')).toBe(6);
  });
  it('não confunde "100% FERRO" com quantidade', () => {
    expect(extrairUnitsPerPack('100% FERRO')).toBe(null);
  });
  it('ignora medidas (mm/cm/g/metros)', () => {
    expect(extrairUnitsPerPack('FITA 10 mm x 50 metros')).toBe(null);
  });
  it('cai na descrição quando o nome não traz quantidade', () => {
    expect(extrairUnitsPerPack('ALFINETE DE SEGURANÇA', 'pacote com 100 unidades')).toBe(100);
  });
  it('sem quantidade clara → null', () => {
    expect(extrairUnitsPerPack('AGULHA DE COSTURA')).toBe(null);
  });
});

describe('preencherUnitsPerPack (gate por schema)', () => {
  const schemaComUnits: AtributoSchema[] = [
    { id: 'UNITS_PER_PACK', nome: 'Unidades por kit', required: true, conditionalRequired: false, valueType: 'number', valores: [], allowedUnits: [], tags: [] },
  ];
  it('preenche value_name numérico quando a categoria expõe o atributo', () => {
    const out = preencherUnitsPerPack(schemaComUnits, [], 'ALFINETE 100UND');
    expect(out).toEqual([{ id: 'UNITS_PER_PACK', value_name: '100' }]);
  });
  it('não age se a categoria não expõe UNITS_PER_PACK', () => {
    const out = preencherUnitsPerPack([], [{ id: 'BRAND', value_name: 'Avil' }], 'ALFINETE 100UND');
    expect(out).toEqual([{ id: 'BRAND', value_name: 'Avil' }]);
  });
  it('não sobrescreve valor já presente', () => {
    const base = [{ id: 'UNITS_PER_PACK', value_name: '50' }];
    expect(preencherUnitsPerPack(schemaComUnits, base, 'ALFINETE 100UND')).toEqual(base);
  });
  it('sem quantidade no texto → deixa faltante (não inventa)', () => {
    expect(preencherUnitsPerPack(schemaComUnits, [], 'AGULHA DE COSTURA')).toEqual([]);
  });
});

describe('montarAtributosBase (MANUFACTURER = fornecedor)', () => {
  const attr = (id: string): AtributoSchema =>
    ({ id, nome: id, required: true, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [] });

  it('preenche Fabricante (MANUFACTURER) espelhando a marca quando o schema o expõe', () => {
    const out = montarAtributosBase([attr('BRAND'), attr('MANUFACTURER'), attr('MODEL')], 'Tecido Oxford', 'TRINITY');
    expect(out).toEqual([
      { id: 'BRAND', value_name: 'TRINITY' },
      { id: 'MANUFACTURER', value_name: 'TRINITY' },
      { id: 'MODEL', value_name: 'Tecido Oxford' },
    ]);
  });

  it('não inclui MANUFACTURER quando a categoria não o expõe', () => {
    const out = montarAtributosBase([attr('BRAND'), attr('MODEL')], 'Linha', 'Avil');
    expect(out.some((a) => a.id === 'MANUFACTURER')).toBe(false);
  });
});
