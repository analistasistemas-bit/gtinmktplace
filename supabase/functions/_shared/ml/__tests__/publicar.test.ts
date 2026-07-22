import { describe, it, expect } from 'vitest';
import { montarPayloadItem, ordenarVariacoesPrincipal } from '../publicar';

const familia = {
  titulo_ml: 'Linha XIK 120 Várias Cores',
  descricao_ml: 'Descrição...',
  categoria_ml_id: 'MLB270273',
  atributos_ml: [{ id: 'BRAND', value_name: 'Avil' }, { id: 'MODEL', value_name: 'XIK 120' }],
};
const variacoes = [
  { codigo: '00000101', cor: 'Azul', estoque: 5, preco_publicacao: 9.9, gtin: '7891234567890', ml_picture_id: 'PIC1' },
  { codigo: '00000102', cor: 'Verde', estoque: 0, preco_publicacao: 9.9, gtin: null, ml_picture_id: 'PIC2' },
];
const capaPictureId = 'CAPA1';

describe('montarPayloadItem', () => {
  it('inclui título, categoria e atributos do pai', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.title).toBe('Linha XIK 120 Várias Cores');
    expect(p.category_id).toBe('MLB270273');
    expect(p.attributes).toEqual(expect.arrayContaining([{ id: 'BRAND', value_name: 'Avil' }]));
  });
  it('listing_type_id default é Clássico (gold_special)', () => {
    expect(montarPayloadItem(familia, variacoes, capaPictureId).listing_type_id).toBe('gold_special');
  });
  it('usa o listing_type_id informado (ex.: Premium gold_pro)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId, null, null, 'gold_pro');
    expect(p.listing_type_id).toBe('gold_pro');
  });
  it('cria uma variação por cor com cor, estoque, preço e picture_ids', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations).toHaveLength(2);
    const azul = p.variations[0];
    expect(azul.available_quantity).toBe(5);
    expect(azul.price).toBe(9.9);
    expect(azul.picture_ids).toContain('PIC1');
    expect(azul.attribute_combinations).toEqual(
      expect.arrayContaining([{ id: 'COLOR', value_name: 'Azul' }]),
    );
  });
  it('a capa entra como 1ª foto de cada variação (vira a principal com variações)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[0].picture_ids[0]).toBe('CAPA1');
    expect(p.variations[0].picture_ids).toContain('PIC1');
    expect(p.variations[1].picture_ids[0]).toBe('CAPA1');
  });
  it('sem capa, a variação usa só a própria foto', () => {
    const p = montarPayloadItem(familia, variacoes, null);
    expect(p.variations[0].picture_ids).toEqual(['PIC1']);
  });
  it('pictures do item incluem capa + foto de cada cor', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    const ids = p.pictures.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['CAPA1', 'PIC1', 'PIC2']));
  });
  it('cor com GTIN EAN válido envia atributo GTIN com value_name', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'GTIN', value_name: '7891234567890' }]);
  });
  it('cor sem GTIN em categoria que aceita (linha) envia EMPTY_GTIN_REASON "sem código cadastrado"', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.variations[1].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN interno 3000* é tratado como sem código (EMPTY_GTIN_REASON)', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '30001234' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN com comprimento inválido (3 dígitos) é tratado como ausente → EMPTY_GTIN_REASON', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '123' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN com 9 dígitos (código interno fornecedor, lote #48) é tratado como ausente → EMPTY_GTIN_REASON', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '533100017' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN com 13 dígitos (EAN-13 possivelmente com checksum errado) vai como GTIN literal → ML valida', () => {
    const p = montarPayloadItem(familia, [{ ...variacoes[0], gtin: '1234567890123' }], capaPictureId);
    expect(p.variations[0].attributes).toEqual([{ id: 'GTIN', value_name: '1234567890123' }]);
  });
  it('cor sem GTIN em categoria sem suporte (botão MLB270272) não envia GTIN nem EMPTY_GTIN_REASON', () => {
    const botao = { ...familia, categoria_ml_id: 'MLB270272' };
    const p = montarPayloadItem(botao, [{ ...variacoes[1] }], capaPictureId);
    const ids = (p.variations[0].attributes ?? []).map((a) => a.id);
    expect(ids).not.toContain('GTIN');
    expect(ids).not.toContain('EMPTY_GTIN_REASON');
  });
  it('variação unitária sem cor usa valor controlado em vez de COLOR vazio', () => {
    const p = montarPayloadItem(
      { ...familia, categoria_ml_id: 'MLB189007' },
      [{ ...variacoes[0], cor: null }],
      capaPictureId,
    );
    expect(p.variations[0].attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Único' }]);
  });
  it('categoria Zíperes (MLB271227) com 1 variação publica item plano: family_name, price/available_quantity no corpo, sem variations (ADR-0084)', () => {
    const cursor = { ...familia, categoria_ml_id: 'MLB271227' };
    const p = montarPayloadItem(cursor, [variacoes[0]], capaPictureId);
    expect(p.family_name).toBe('Linha XIK 120 Várias Cores');
    expect(p.price).toBe(9.9);
    expect(p.available_quantity).toBe(5);
    expect(p.seller_custom_field).toBe('00000101');
    expect(p.variations).toBeUndefined();
    expect(p.attributes).toEqual(expect.arrayContaining([{ id: 'COLOR', value_name: 'Azul' }]));
    // Validado via API real: a ML rejeita title/original_price no item plano com family_name.
    expect(p.title).toBeUndefined();
    expect(p.original_price).toBeUndefined();
  });
  it('categoria Zíperes (MLB271227) com >1 variação ainda não tem suporte — falha LOUD em vez de publicar errado', () => {
    const cursor = { ...familia, categoria_ml_id: 'MLB271227' };
    expect(() => montarPayloadItem(cursor, variacoes, capaPictureId)).toThrow(/múltiplas cores/);
  });
  it('categoria sem essa exigência (linha, MLB270273) não envia family_name', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.family_name).toBeUndefined();
  });
  it('ADR-0087: formato="plano" força item plano numa categoria FORA do Set (retry reativo)', () => {
    const p = montarPayloadItem(familia, [variacoes[0]], capaPictureId, null, null, undefined, null, null, undefined, 'plano');
    expect(p.family_name).toBe('Linha XIK 120 Várias Cores');
    expect(p.price).toBe(9.9);
    expect(p.variations).toBeUndefined();
  });
});

describe('montarPayloadItem com 2a foto', () => {
  const familia = { titulo_ml: 'T', descricao_ml: 'D', categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const variacoes = [
    { codigo: '00000001', cor: 'Branco', estoque: 5, preco_publicacao: 10, gtin: '7891234567895', ml_picture_id: 'P1' },
  ];
  it('cada variação tem [capa, capa2, própria] e item.pictures inclui a capa2', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', 'CAPA2', null);
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'CAPA2', 'P1']);
    expect(p.pictures.map((x) => x.id)).toEqual(expect.arrayContaining(['CAPA', 'CAPA2', 'P1']));
  });
  it('sem capa2 (null) mantém [capa, própria]', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', null, null);
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'P1']);
  });
  // Regressão: família sem foto-capa própria mas com 2ª foto comum. A capa2 é por
  // definição a 2ª foto e nunca deve assumir a 1ª posição (o ML usa a 1ª como capa
  // da galeria). Sem capa, a própria foto da cor lidera; a capa2 cai para 2º.
  it('sem capa mas com capa2: a própria foto lidera e a capa2 fica em 2º (não vira capa)', () => {
    const p = montarPayloadItem(familia, variacoes, null, 'CAPA2', null);
    expect(p.variations[0].picture_ids).toEqual(['P1', 'CAPA2']);
    expect(p.pictures[0].id).not.toBe('CAPA2');
    expect(p.pictures[0].id).toBe('P1');
  });
});

describe('montarPayloadItem com 3a foto (CAPA3)', () => {
  const familia = { titulo_ml: 'T', descricao_ml: 'D', categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const variacoes = [
    { codigo: '00000001', cor: 'Branco', estoque: 5, preco_publicacao: 10, gtin: '7891234567895', ml_picture_id: 'P1' },
  ];
  it('cada variação tem [capa, capa2, capa3, própria] e item.pictures inclui a capa3', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', 'CAPA2', 'CAPA3');
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'CAPA2', 'CAPA3', 'P1']);
    expect(p.pictures.map((x) => x.id)).toEqual(expect.arrayContaining(['CAPA', 'CAPA2', 'CAPA3', 'P1']));
  });
  // A capa3 vem logo após a capa2 (decisão Diego 2026-06-10), sem buraco quando falta a capa2.
  it('com capa3 mas sem capa2: [capa, capa3, própria]', () => {
    const p = montarPayloadItem(familia, variacoes, 'CAPA', null, 'CAPA3');
    expect(p.variations[0].picture_ids).toEqual(['CAPA', 'CAPA3', 'P1']);
  });
  // Regressão: família sem foto-capa própria. capa2/capa3 nunca lideram; a própria foto da cor lidera.
  it('sem capa mas com capa2+capa3: própria lidera, depois capa2, capa3', () => {
    const p = montarPayloadItem(familia, variacoes, null, 'CAPA2', 'CAPA3');
    expect(p.variations[0].picture_ids).toEqual(['P1', 'CAPA2', 'CAPA3']);
    expect(p.pictures[0].id).toBe('P1');
  });
});

describe('montarPayloadItem com dimensões (ADR-0018)', () => {
  it('mescla os SELLER_PACKAGE_* nos attributes quando válidas', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId, null, null, undefined, null, {
      altura_cm: 18, largura_cm: 7, comprimento_cm: 7, peso_gramas: 150,
    });
    const ids = p.attributes.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      'BRAND', 'MODEL', 'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT',
    ]));
    expect(p.attributes.find((a) => a.id === 'SELLER_PACKAGE_WEIGHT')?.value_name).toBe('150 g');
  });

  it('não adiciona pacote quando dimensões inválidas (placeholder 0,1cm)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId, null, null, undefined, null, {
      altura_cm: 0.1, largura_cm: 0.1, comprimento_cm: 0.1, peso_gramas: 100,
    });
    expect(p.attributes.some((a) => a.id.startsWith('SELLER_PACKAGE'))).toBe(false);
  });

  it('não adiciona pacote quando dimensões ausentes (undefined)', () => {
    const p = montarPayloadItem(familia, variacoes, capaPictureId);
    expect(p.attributes.some((a) => a.id.startsWith('SELLER_PACKAGE'))).toBe(false);
  });
});

describe('montarPayloadItem com desconto', () => {
  const fam = { titulo_ml: 'T', descricao_ml: null, categoria_ml_id: 'MLB255054', atributos_ml: [] };
  const vars = [{ codigo: '1', cor: 'Azul', estoque: 5, preco_publicacao: 12.29, gtin: null, ml_picture_id: null }];

  it('com desconto: adiciona original_price inflado por variação', () => {
    const payload = montarPayloadItem(fam, vars, null, null, null, 'gold_special', { pct: 15 });
    expect(payload.variations[0].price).toBe(12.29);
    expect(payload.variations[0].original_price).toBe(14.46);
  });

  it('sem desconto (param ausente): não inclui original_price', () => {
    const payload = montarPayloadItem(fam, vars, null, null, null, 'gold_special');
    expect(payload.variations[0].original_price).toBeUndefined();
  });
});

describe('ordenarVariacoesPrincipal', () => {
  const vs = [
    { codigo: '00000003' }, { codigo: '00000001' }, { codigo: '00000002' },
  ];
  it('põe a principal primeiro, resto por código', () => {
    expect(ordenarVariacoesPrincipal(vs, '00000002').map((v) => v.codigo))
      .toEqual(['00000002', '00000001', '00000003']);
  });
  it('sem principal (null) → tudo por código', () => {
    expect(ordenarVariacoesPrincipal(vs, null).map((v) => v.codigo))
      .toEqual(['00000001', '00000002', '00000003']);
  });
  it('principal inexistente → tudo por código', () => {
    expect(ordenarVariacoesPrincipal(vs, '00009999').map((v) => v.codigo))
      .toEqual(['00000001', '00000002', '00000003']);
  });
});

describe('montarPayloadItem aceitaEmptyGtin override (E4 — categoria prevista)', () => {
  // MLB189007 (furadeira) NÃO está no Set hard-coded; sem o override não enviaria EMPTY_GTIN_REASON.
  const prevista = { titulo_ml: 'Furadeira', descricao_ml: 'D', categoria_ml_id: 'MLB189007', atributos_ml: [{ id: 'BRAND', value_name: 'Bosch' }] };
  const semGtin = [{ codigo: '900A', cor: 'Preto', estoque: 5, preco_publicacao: 99, gtin: null, ml_picture_id: 'P1' }];

  it('override=true → variação sem GTIN recebe EMPTY_GTIN_REASON', () => {
    const p = montarPayloadItem(prevista, semGtin, 'CAPA', null, null, 'gold_special', null, null, true);
    expect(p.variations[0].attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('override ausente (undefined) e fora do Set hard-coded → não envia EMPTY_GTIN_REASON', () => {
    const p = montarPayloadItem(prevista, semGtin, 'CAPA');
    const ids = (p.variations[0].attributes ?? []).map((a) => a.id);
    expect(ids).not.toContain('EMPTY_GTIN_REASON');
  });
  it('override=false → não envia (categoria não expõe o atributo)', () => {
    const p = montarPayloadItem(prevista, semGtin, 'CAPA', null, null, 'gold_special', null, null, false);
    const ids = (p.variations[0].attributes ?? []).map((a) => a.id);
    expect(ids).not.toContain('EMPTY_GTIN_REASON');
  });
});
