import { describe, expect, it } from 'vitest';
import {
  acessoDaAcao, chaveComissao, chaveLimite, chaveLimiteErro, comissaoDaListingPrice, deduplicarPorCodigo, escaparLike, formasGtin, itemBusca,
  unidadesDoProduto, validarPedido, variacaoCusto, variacoesDasLinhas, type LinhaVariacao,
} from '../roteamento.ts';

const anuncio = {
  acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB123', sellerId: '999',
  catalogProductId: 'MLB777', categoriaId: 'MLB1234', preco: 59.9, eanDaBusca: null,
};
const UUID = '0b7c6a2e-3c1d-4b5a-9f00-1234567890ab';

describe('validarPedido', () => {
  it('ação desconhecida ou corpo não-objeto → null', () => {
    expect(validarPedido({ acao: 'apagar_tudo' })).toBeNull();
    expect(validarPedido(null)).toBeNull();
    expect(validarPedido('x')).toBeNull();
  });

  it('analisar_anuncio válido devolve a EntradaAnuncio', () => {
    expect(validarPedido(anuncio)).toEqual({
      acao: 'analisar_anuncio', tipoPagina: 'anuncio',
      entrada: { mlItemId: 'MLB123', sellerId: '999', catalogProductId: 'MLB777', categoriaId: 'MLB1234', preco: 59.9, eanDaBusca: null },
    });
    const semOpcionais = validarPedido({ ...anuncio, catalogProductId: undefined, eanDaBusca: undefined });
    expect(semOpcionais).toMatchObject({ entrada: { catalogProductId: null, eanDaBusca: null } });
  });

  it.each([
    ['preco 0', { preco: 0 }], ['preco negativo', { preco: -1 }], ['preco NaN', { preco: NaN }],
    ['preco Infinity', { preco: Infinity }], ['preco string', { preco: '59.9' }],
    ['mlItemId fora do padrão', { mlItemId: 'MLA123' }], ['mlItemId ausente', { mlItemId: undefined }],
    ['sellerId vazio', { sellerId: '' }], ['sellerId número', { sellerId: 999 }],
    ['categoria vazia', { categoriaId: '' }], ['categoria fora do padrão', { categoriaId: 'MLB12a' }],
    ['catálogo inválido', { catalogProductId: 'x' }], ['tipoPagina inválido', { tipoPagina: 'home' }],
  ])('analisar_anuncio com %s → null', (_n, over) => {
    expect(validarPedido({ ...anuncio, ...over })).toBeNull();
  });

  it('buscar_sku exige termo de 2–60 caracteres', () => {
    expect(validarPedido({ acao: 'buscar_sku', termo: '  ab ' })).toEqual({ acao: 'buscar_sku', termo: 'ab' });
    expect(validarPedido({ acao: 'buscar_sku', termo: 'a' })).toBeNull();
    expect(validarPedido({ acao: 'buscar_sku', termo: 'x'.repeat(61) })).toBeNull();
  });

  it('salvar_vinculo valida chave e variacaoId (uuid)', () => {
    const ok = { acao: 'salvar_vinculo', chave: { tipo: 'item', valor: 'MLB1' }, variacaoId: UUID };
    expect(validarPedido(ok)).toEqual(ok);
    expect(validarPedido({ ...ok, chave: { tipo: 'gtin', valor: 'MLB1' } })).toBeNull();
    expect(validarPedido({ ...ok, chave: { tipo: 'item', valor: '123' } })).toBeNull();
    expect(validarPedido({ ...ok, variacaoId: 'abc' })).toBeNull();
    expect(validarPedido({ ...ok, chave: undefined })).toBeNull();
  });

  it('remover_vinculo valida a chave', () => {
    expect(validarPedido({ acao: 'remover_vinculo', chave: { tipo: 'catalogo', valor: 'MLB9' } }))
      .toEqual({ acao: 'remover_vinculo', chave: { tipo: 'catalogo', valor: 'MLB9' } });
    expect(validarPedido({ acao: 'remover_vinculo', chave: { tipo: 'catalogo', valor: 'MLB9;drop' } })).toBeNull();
  });

  it('erro_leitura: motivo na allowlist, versão semver, item MLB ou null', () => {
    const ok = { acao: 'erro_leitura', tipoPagina: 'busca', mlItemId: null, versao: '1.0.2', motivo: 'campo_ausente:preco' };
    expect(validarPedido(ok)).toEqual(ok);
    expect(validarPedido({ ...ok, motivo: 'estado_nao_encontrado', mlItemId: 'MLB5' })).toMatchObject({ mlItemId: 'MLB5' });
    expect(validarPedido({ ...ok, motivo: 'campo_ausente:Preco' })).toBeNull();
    expect(validarPedido({ ...ok, motivo: 'campo_ausente:' + 'a'.repeat(41) })).toBeNull();
    expect(validarPedido({ ...ok, motivo: 'https://site/qualquer' })).toBeNull();
    expect(validarPedido({ ...ok, versao: '1.0' })).toBeNull();
    expect(validarPedido({ ...ok, mlItemId: 'qualquer' })).toBeNull();
    expect(validarPedido({ ...ok, tipoPagina: 'outra' })).toBeNull();
  });
});

describe('acessoDaAcao', () => {
  it('vínculo é escrita; o resto é leitura', () => {
    expect(acessoDaAcao('salvar_vinculo')).toBe('write');
    expect(acessoDaAcao('remover_vinculo')).toBe('write');
    expect(acessoDaAcao('analisar_anuncio')).toBe('read');
    expect(acessoDaAcao(undefined)).toBe('read');
  });
});

describe('chaves de limite (UTC, independente do TZ do processo)', () => {
  // 21/10 23:59 em São Paulo = 22/10 02:59 UTC.
  const agora = new Date('2026-10-22T02:59:30Z');
  it('análises: janela por minuto', () => {
    expect(chaveLimite('u1', agora)).toBe('ext:rl:u1:202610220259');
  });
  it('erros de leitura: janela por hora', () => {
    expect(chaveLimiteErro('u1', agora)).toBe('ext:rl-erro:u1:2026102202');
  });
});

describe('formasGtin', () => {
  it('GTIN-14 com zero à esquerda casa com o 13 gravado', () => {
    expect(formasGtin('07891234567895')).toEqual(expect.arrayContaining(['07891234567895', '7891234567895']));
  });
  it('13 dígitos também procura a forma de 14', () => {
    expect(formasGtin('7891234567895')).toEqual(['7891234567895', '07891234567895']);
  });
  it('não-numérico (código 3000…) passa como está', () => {
    expect(formasGtin('3000ABC')).toEqual(['3000ABC']);
  });
});

describe('escaparLike', () => {
  it('escapa curingas', () => {
    expect(escaparLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });
});

describe('chaveComissao', () => {
  it('leva a conta ML: duas contas não dividem a mesma entrada de cache', () => {
    expect(chaveComissao('111', 'MLB1', 'gold_pro', 59.9)).toBe('ext:lp:111:MLB1:gold_pro:59.9');
    expect(chaveComissao('222', 'MLB1', 'gold_pro', 59.9)).not.toBe(chaveComissao('111', 'MLB1', 'gold_pro', 59.9));
  });
});

describe('comissaoDaListingPrice', () => {
  const det = { percentage_fee: 12, fixed_fee: 6.25 };
  it('valor pronto do ML vai junto do preço consultado', () => {
    expect(comissaoDaListingPrice({ sale_fee_amount: 18.24, sale_fee_details: det }, 100)).toEqual({
      estado: 'ok', valor: { percentual: 12, fixa: 6.25, saleFeeAmount: 18.24, precoConsultado: 100 },
    });
  });
  it('sale_fee_amount null → sem saleFeeAmount (margem usa percentual + fixa)', () => {
    const r = comissaoDaListingPrice({ sale_fee_amount: null as unknown as number, sale_fee_details: det }, 100);
    expect(r).toEqual({ estado: 'ok', valor: { percentual: 12, fixa: 6.25 } });
    expect(r.estado === 'ok' && 'saleFeeAmount' in r.valor).toBe(false);
  });
  it('sem sale_fee_details (com ou sem sale_fee_amount) → indisponível', () => {
    expect(comissaoDaListingPrice({ sale_fee_amount: 18.24 }, 100).estado).toBe('indisponivel');
    expect(comissaoDaListingPrice({ sale_fee_amount: null as unknown as number }, 100).estado).toBe('indisponivel');
  });
});

describe('unidadesDoProduto', () => {
  it('lê UNITS_PER_PACK inteiro ≥ 1', () => {
    expect(unidadesDoProduto({ attributes: [{ id: 'UNITS_PER_PACK', value_name: '3' }] })).toBe(3);
  });
  it('ausente, inválido ou fracionário → 1', () => {
    expect(unidadesDoProduto(null)).toBe(1);
    expect(unidadesDoProduto({ attributes: [] })).toBe(1);
    expect(unidadesDoProduto({ attributes: [{ id: 'UNITS_PER_PACK', value_name: '2.5' }] })).toBe(1);
    expect(unidadesDoProduto({ attributes: [{ id: 'UNITS_PER_PACK', value_name: '0' }] })).toBe(1);
  });
});

function linha(over: Partial<LinhaVariacao> = {}): LinhaVariacao {
  return {
    id: 'v1', codigo: '001', nome: 'Linha 1', custo: '10.5', peso_gramas: 300, altura_cm: 10, largura_cm: 5, comprimento_cm: 20,
    atualizado_em: '2026-10-01T00:00:00Z', familias: { origem: 'importado', kit_multiplicador: null, nome_pai: 'Pai' }, ...over,
  };
}

describe('variacaoCusto', () => {
  it('mapeia custo, origem da família, unidades e dimensões', () => {
    expect(variacaoCusto(linha())).toEqual({
      variacaoId: 'v1', codigo: '001', custo: 10.5, origem: 'importado', unidades: 1,
      dimensoes: { altura_cm: 10, largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 },
    });
  });
  it('dimensão incompleta → null; kit_multiplicador vira unidades; custo 0 → null', () => {
    const v = variacaoCusto(linha({ altura_cm: null, custo: 0, familias: [{ origem: 'nacional', kit_multiplicador: 2, nome_pai: null }] }));
    expect(v).toMatchObject({ dimensoes: null, unidades: 2, custo: null, origem: 'nacional' });
  });
  it('família sem origem válida → null (origem nunca presumida)', () => {
    expect(variacaoCusto(linha({ familias: { origem: null, kit_multiplicador: null, nome_pai: null } }))).toBeNull();
  });
});

describe('deduplicarPorCodigo', () => {
  it('mesmo código em dois lotes → 1 linha (com custo, depois mais recente)', () => {
    const velha = linha({ id: 'a', atualizado_em: '2026-01-01T00:00:00Z' });
    const nova = linha({ id: 'b', atualizado_em: '2026-09-01T00:00:00Z' });
    const semCusto = linha({ id: 'c', custo: null, atualizado_em: '2026-10-01T00:00:00Z' });
    expect(deduplicarPorCodigo([velha, semCusto, nova]).map((l) => l.id)).toEqual(['b']);
  });
  it('códigos diferentes continuam ambíguos (2)', () => {
    expect(variacoesDasLinhas([linha({ id: 'a' }), linha({ id: 'b', codigo: '002' })])).toHaveLength(2);
  });
  it('mesmo código com unidades diferentes (kit) não funde', () => {
    const kit = linha({ id: 'k', familias: { origem: 'nacional', kit_multiplicador: 2, nome_pai: null } });
    expect(deduplicarPorCodigo([linha(), kit])).toHaveLength(2);
  });
});

describe('itemBusca', () => {
  it('nome cai para o da família quando a variação não tem', () => {
    expect(itemBusca(linha({ nome: null }))).toEqual({ variacaoId: 'v1', codigo: '001', nome: 'Pai', custo: 10.5, origem: 'importado' });
  });
});
