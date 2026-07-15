import { describe, it, expect } from 'vitest';
import { montarVariacoesUpdate, montarVariacaoNova } from '../atualizar';
import { corDaVariacaoML } from '../atualizar-item';

describe('corDaVariacaoML', () => {
  it('extrai o value_name do atributo COLOR', () => {
    expect(corDaVariacaoML([{ id: 'GTIN', value_name: '789' }, { id: 'COLOR', value_name: 'Rosa Pink' }])).toBe('Rosa Pink');
  });
  it('null quando não há COLOR', () => {
    expect(corDaVariacaoML([{ id: 'GTIN', value_name: '789' }])).toBeNull();
  });
  it('null quando o argumento não é array', () => {
    expect(corDaVariacaoML(undefined)).toBeNull();
    expect(corDaVariacaoML(null)).toBeNull();
  });
  it('COLOR com value_name vazio → null', () => {
    expect(corDaVariacaoML([{ id: 'COLOR', value_name: '' }])).toBeNull();
  });
});

const atuais = [
  { id: 'V1', seller_custom_field: '00000101', available_quantity: 5 },
  { id: 'V2', seller_custom_field: '00000102', available_quantity: 8 },
];

describe('montarVariacoesUpdate', () => {
  it('aplica o estoque novo na variação casada por código', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V1', available_quantity: 12 });
  });
  it('preserva o estoque atual de variação sem correspondente no lote (cor removida)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toContainEqual({ id: 'V2', available_quantity: 8 });
  });
  it('inclui TODAS as variações atuais (nunca deleta por omissão)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    expect(r).toHaveLength(2);
  });
  it('nunca inclui price (preço preservado pelo ML)', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }]);
    for (const v of r) expect(v).not.toHaveProperty('price');
  });
  it('cor nova do lote (sem variação atual) não entra no PUT', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000999', estoque: 3 }]);
    const ids = r.map((v) => v.id);
    expect(ids).toEqual(['V1', 'V2']);
  });
  it('id numérico do ML é mantido', () => {
    const r = montarVariacoesUpdate([{ id: 123, seller_custom_field: '00000101', available_quantity: 5 }], [{ codigo: '00000101', estoque: 7 }]);
    expect(r[0]).toEqual({ id: 123, available_quantity: 7 });
  });

  const atuaisNovos = [
    { id: 1, seller_custom_field: '00000001', available_quantity: 10 },
    { id: 2, seller_custom_field: '00000002', available_quantity: 20 },
  ];
  const desejados = [{ codigo: '00000001', estoque: 5 }, { codigo: '00000002', estoque: 8 }];

  it('sem fotos comuns: só atualiza estoque (sem picture_ids)', () => {
    const r = montarVariacoesUpdate(atuaisNovos, desejados);
    expect(r[0]).toEqual({ id: 1, available_quantity: 5 });
    expect((r[0] as Record<string, unknown>).picture_ids).toBeUndefined();
  });

  it('com fotos por código: emite picture_ids [capa, capa2, própria] (dedup)', () => {
    const picsPorCodigo = { '00000001': ['CAPA', 'CAPA2', 'P1'], '00000002': ['CAPA', 'CAPA2'] };
    const r = montarVariacoesUpdate(atuaisNovos, desejados, picsPorCodigo);
    expect(r[0]).toEqual({ id: 1, available_quantity: 5, picture_ids: ['CAPA', 'CAPA2', 'P1'] });
    expect(r[1]).toEqual({ id: 2, available_quantity: 8, picture_ids: ['CAPA', 'CAPA2'] });
  });

  it('UPDATE com desconto: variação existente recebe price + original_price', () => {
    const atuais = [{ id: 'A', seller_custom_field: '1', available_quantity: 3 }];
    const desejados = [{ codigo: '1', estoque: 9 }];
    const precos = { '1': 12.29 };
    const out = montarVariacoesUpdate(atuais, desejados, undefined, { pct: 15, precoPorCodigo: precos });
    expect(out[0]).toMatchObject({ id: 'A', available_quantity: 9, price: 12.29, original_price: 14.46 });
  });

  it('UPDATE sem desconto: variação existente NÃO recebe price/original_price', () => {
    const atuais = [{ id: 'A', seller_custom_field: '1', available_quantity: 3 }];
    const out = montarVariacoesUpdate(atuais, [{ codigo: '1', estoque: 9 }]);
    expect(out[0]).toEqual({ id: 'A', available_quantity: 9 });
  });

  // ADR-0016 adendo: ao mudar o preço de publicação da família (ex.: ao incluir
  // cores novas a um preço diferente), o ML exige preço único entre variações.
  // O preço da família é propagado para TODAS as variações existentes do anúncio.
  it('com precoFamilia: toda variação existente recebe price = precoFamilia', () => {
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }], undefined, undefined, 12.5);
    expect(r[0]).toMatchObject({ id: 'V1', available_quantity: 12, price: 12.5 });
    expect(r[1]).toMatchObject({ id: 'V2', available_quantity: 8, price: 12.5 });
  });

  it('precoFamilia preenche o price até de variação existente fora do lote (cor publicada excluída)', () => {
    // V2 não está nos desejados (excluída da seleção), mas o ML não aceita ela num
    // preço diferente das novas → recebe o preço da família mesmo assim.
    const r = montarVariacoesUpdate(atuais, [{ codigo: '00000101', estoque: 12 }], undefined, undefined, 12.5);
    expect(r.find((v) => v.id === 'V2')).toMatchObject({ price: 12.5 });
  });

  it('desconto tem precedência: precoFamilia não sobrescreve o price do desconto', () => {
    const a = [{ id: 'A', seller_custom_field: '1', available_quantity: 3 }];
    const out = montarVariacoesUpdate(a, [{ codigo: '1', estoque: 9 }], undefined, { pct: 15, precoPorCodigo: { '1': 12.29 } }, 99);
    expect(out[0]).toMatchObject({ price: 12.29, original_price: 14.46 });
  });

  // Bug lote #24/#25: renomear a cor de uma variação JÁ publicada não ia ao ML porque
  // o PUT nunca incluía COLOR das existentes. Agora envia COLOR quando (e só quando) muda.
  const atuaisCor = [
    { id: 'V1', seller_custom_field: '02710013', available_quantity: 5, cor: 'Rosa' },
    { id: 'V2', seller_custom_field: '03083284', available_quantity: 5, cor: 'Outra' },
  ];
  it('envia COLOR na variação existente quando a cor mudou (Rosa → Rosa Pink)', () => {
    const r = montarVariacoesUpdate(atuaisCor, [{ codigo: '02710013', estoque: 5 }], undefined, undefined, null, {
      '02710013': 'Rosa Pink',
    });
    expect(r.find((v) => v.id === 'V1')?.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Rosa Pink' }]);
  });
  it('NÃO envia COLOR quando a cor desejada é igual à do ML (idempotente)', () => {
    const r = montarVariacoesUpdate(atuaisCor, [{ codigo: '02710013', estoque: 5 }], undefined, undefined, null, {
      '02710013': 'Rosa',
    });
    expect(r.find((v) => v.id === 'V1')).not.toHaveProperty('attribute_combinations');
  });
  it('NÃO envia COLOR de variação cujo código não está no mapa de cor desejada', () => {
    const r = montarVariacoesUpdate(atuaisCor, [{ codigo: '02710013', estoque: 5 }], undefined, undefined, null, {
      '02710013': 'Rosa Pink',
    });
    expect(r.find((v) => v.id === 'V2')).not.toHaveProperty('attribute_combinations');
  });
  it('cor desejada vazia/nula não vira COLOR (não zera a cor no ML)', () => {
    const r = montarVariacoesUpdate(atuaisCor, [{ codigo: '02710013', estoque: 5 }], undefined, undefined, null, {
      '02710013': '',
    });
    expect(r.find((v) => v.id === 'V1')).not.toHaveProperty('attribute_combinations');
  });

  it('somenteEstoque suprime price e original_price mesmo com desconto e precoFamilia', () => {
    const atuais = [{ id: 1, seller_custom_field: 'A1', available_quantity: 5, cor: 'Azul' }];
    const desejados = [{ codigo: 'A1', estoque: 9 }];
    const desconto = { pct: 15, precoPorCodigo: { A1: 20 } };
    const out = montarVariacoesUpdate(atuais, desejados, undefined, desconto, 20, undefined, true /* somenteEstoque */);
    expect(out[0].available_quantity).toBe(9);
    expect(out[0].price).toBeUndefined();
    expect(out[0].original_price).toBeUndefined();
  });

  it('sem somenteEstoque mantem o comportamento atual (empurra precoFamilia)', () => {
    const atuais = [{ id: 1, seller_custom_field: 'A1', available_quantity: 5, cor: 'Azul' }];
    const out = montarVariacoesUpdate(atuais, [{ codigo: 'A1', estoque: 9 }], undefined, null, 20);
    expect(out[0].price).toBe(20);
  });
});

const corNova = {
  codigo: '00000777', cor: 'Vermelho', estoque: 9,
  preco_publicacao: 12.5, gtin: '7891234567890', ml_picture_id: 'PICNOVA',
};

describe('montarVariacaoNova', () => {
  it('monta COLOR, estoque, preço, picture_ids e seller_custom_field, sem id', () => {
    const v = montarVariacaoNova(corNova, null, null, null, 'MLB270273');
    expect(v).not.toHaveProperty('id');
    expect(v.attribute_combinations).toEqual([{ id: 'COLOR', value_name: 'Vermelho' }]);
    expect(v.available_quantity).toBe(9);
    expect(v.price).toBe(12.5);
    expect(v.picture_ids).toEqual(['PICNOVA']);
    expect(v.seller_custom_field).toBe('00000777');
  });
  it('a capa entra como 1ª foto da variação nova', () => {
    const v = montarVariacaoNova(corNova, 'CAPA1', null, null, 'MLB270273');
    expect(v.picture_ids).toEqual(['CAPA1', 'PICNOVA']);
  });
  it('GTIN EAN válido vira atributo GTIN', () => {
    const v = montarVariacaoNova(corNova, null, null, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'GTIN', value_name: '7891234567890' }]);
  });
  it('sem GTIN em categoria que aceita → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, null, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('GTIN interno 3000* → EMPTY_GTIN_REASON', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: '30009999' }, null, null, null, 'MLB270273');
    expect(v.attributes).toEqual([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }]);
  });
  it('sem GTIN em categoria sem suporte (botão MLB270272) → sem atributo de GTIN', () => {
    const v = montarVariacaoNova({ ...corNova, gtin: null }, null, null, null, 'MLB270272');
    expect(v.attributes).toBeUndefined();
  });
  it('inclui [capa, capa2, própria] em picture_ids', () => {
    const v = { codigo: '00000009', cor: 'Azul', estoque: 3, preco_publicacao: 12, gtin: null, ml_picture_id: 'PN' };
    const r = montarVariacaoNova(v, 'CAPA', 'CAPA2', null, 'MLB255054');
    expect(r.picture_ids).toEqual(['CAPA', 'CAPA2', 'PN']);
  });

  it('inclui [capa, capa2, capa3, própria] em picture_ids', () => {
    const v = { codigo: '00000009', cor: 'Azul', estoque: 3, preco_publicacao: 12, gtin: null, ml_picture_id: 'PN' };
    const r = montarVariacaoNova(v, 'CAPA', 'CAPA2', 'CAPA3', 'MLB255054');
    expect(r.picture_ids).toEqual(['CAPA', 'CAPA2', 'CAPA3', 'PN']);
  });

  // Regressão: cor nova sem foto-capa própria mas com 2ª foto comum. A capa2 não
  // pode liderar (viraria capa da variação no ML); a própria foto vem 1ª, capa2 2ª.
  it('sem capa mas com capa2: própria foto lidera e capa2 fica em 2º', () => {
    const v = { codigo: '00000009', cor: 'Azul', estoque: 3, preco_publicacao: 12, gtin: null, ml_picture_id: 'PN' };
    const r = montarVariacaoNova(v, null, 'CAPA2', null, 'MLB255054');
    expect(r.picture_ids).toEqual(['PN', 'CAPA2']);
  });

  it('sem capa mas com capa2+capa3: própria lidera, depois capa2, capa3', () => {
    const v = { codigo: '00000009', cor: 'Azul', estoque: 3, preco_publicacao: 12, gtin: null, ml_picture_id: 'PN' };
    const r = montarVariacaoNova(v, null, 'CAPA2', 'CAPA3', 'MLB255054');
    expect(r.picture_ids).toEqual(['PN', 'CAPA2', 'CAPA3']);
  });

  it('montarVariacaoNova com desconto adiciona original_price', () => {
    const v = { codigo: '2', cor: 'Rosa', estoque: 4, preco_publicacao: 12.29, gtin: null, ml_picture_id: null };
    const out = montarVariacaoNova(v, null, null, null, 'MLB255054', { pct: 15 });
    expect(out.price).toBe(12.29);
    expect(out.original_price).toBe(14.46);
  });
});
