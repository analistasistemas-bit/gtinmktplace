import { describe, expect, it } from 'vitest';
import {
  chaveComissao, chaveLimite, chaveLimiteErro, comissaoDaListingPrice, deduplicarPorCodigo, escaparLike, formasGtin, itemBusca,
  basesDeKit, chaveFrete, dimensoesDaLinha, dataDoProduto, dimensoesDoKitVivo, unidadesDoProduto, unidadesDoSku, uppDasBases, validarPedido, variacaoCusto, variacoesDasLinhas, type LinhaVariacao,
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

describe('dataDoProduto', () => {
  it('date_created ISO de /products/{id}; ausente, inválida ou corpo nulo → null', () => {
    expect(dataDoProduto({ date_created: '2020-07-30T21:40:56Z' })).toBe('2020-07-30T21:40:56Z');
    expect(dataDoProduto({ date_created: 'ontem' })).toBeNull();
    expect(dataDoProduto({})).toBeNull();
    expect(dataDoProduto(null)).toBeNull();
  });
});

describe('unidadesDoProduto', () => {
  const upp = (a: object) => ({ attributes: [{ id: 'UNITS_PER_PACK', ...a }] });
  const IND = { estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' };
  it('lê UNITS_PER_PACK inteiro ≥ 1, value_struct.number antes de value_name', () => {
    expect(unidadesDoProduto(upp({ value_name: '3' }))).toEqual({ estado: 'ok', valor: 3 });
    expect(unidadesDoProduto(upp({ value_struct: { number: 12, unit: '' }, value_name: '1' }))).toEqual({ estado: 'ok', valor: 12 });
  });
  it('produto sem o atributo → quantidade por anúncio não confirmada (nunca 1)', () => {
    const NC = { estado: 'indisponivel', motivo: 'quantidade por anúncio não confirmada' };
    expect(unidadesDoProduto({ attributes: [] })).toEqual(NC);
    expect(unidadesDoProduto({ attributes: [{ id: 'BRAND', value_name: 'X' }] })).toEqual(NC);
  });
  it('corpo null (HTTP/timeout) ou atributo ilegível → indisponível, nunca 1', () => {
    expect(unidadesDoProduto(null)).toEqual(IND);
    expect(unidadesDoProduto(upp({ value_name: '2.5' }))).toEqual(IND);
    expect(unidadesDoProduto(upp({ value_name: '0' }))).toEqual(IND);
    expect(unidadesDoProduto(upp({ value_name: null }))).toEqual(IND);
    expect(unidadesDoProduto(upp({ value_name: 'doze' }))).toEqual(IND);
  });
});

function linha(over: Partial<LinhaVariacao> = {}): LinhaVariacao {
  return {
    id: 'v1', codigo: '001', nome: 'Linha 1', custo: '10.5', peso_gramas: 300, altura_cm: 10, largura_cm: 5, comprimento_cm: 20,
    atualizado_em: '2026-10-01T00:00:00Z',
    familias: { origem: 'importado', kit_multiplicador: null, nome_pai: 'Pai', codigo_pai: '9001', atributos_ml: [{ id: 'UNITS_PER_PACK', value_name: '1' }] }, ...over,
  };
}

describe('variacaoCusto', () => {
  it('mapeia custo, origem da família, unidades e dimensões', () => {
    expect(variacaoCusto(linha())).toEqual({
      variacaoId: 'v1', codigo: '001', custo: 10.5, origem: 'importado', unidades: 1, codigoPai: '9001',
      dimensoes: { altura_cm: 10, largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 },
    });
  });
  it('dimensão incompleta → null; custo 0 → null; família em array', () => {
    const v = variacaoCusto(linha({ altura_cm: null, custo: 0, familias: [{ origem: 'nacional', kit_multiplicador: null, nome_pai: null }] }));
    expect(v).toMatchObject({ dimensoes: null, unidades: null, custo: null, origem: 'nacional', codigoPai: null });
  });
  it('família sem origem válida → origem null (nunca presumida), variação mantida', () => {
    expect(variacaoCusto(linha({ familias: { origem: null, kit_multiplicador: null, nome_pai: null } }))).toMatchObject({ variacaoId: 'v1', origem: null });
    expect(variacaoCusto(linha({ familias: { origem: 'NACIONAL ', kit_multiplicador: null, nome_pai: null } })).origem).toBeNull();
  });
});

describe('unidadesDoSku (composição comercial confirmada do SKU)', () => {
  const fam = (atributos_ml: unknown, kit_multiplicador: number | null = null) => ({ origem: 'nacional', kit_multiplicador, nome_pai: null, atributos_ml });
  const upp = (v: unknown) => [{ id: 'BRAND', value_name: 'X' }, { id: 'UNITS_PER_PACK', value_name: v }];
  it('UNITS_PER_PACK do próprio anúncio do SKU (caixa de 24, sem kit → 24)', () => {
    expect(unidadesDoSku(fam(upp('24')))).toBe(24);
    expect(unidadesDoSku(fam([{ id: 'UNITS_PER_PACK', value_struct: { number: 6 }, value_name: '1' }]))).toBe(6);
  });
  it('sem o atributo, ilegível ou família ausente → null (não confirmado; nunca kit_multiplicador ?? 1)', () => {
    expect(unidadesDoSku(fam([]))).toBeNull();
    expect(unidadesDoSku(fam(null))).toBeNull();
    expect(unidadesDoSku(fam(upp('2.5')))).toBeNull();
    expect(unidadesDoSku(fam(upp('0')))).toBeNull();
    expect(unidadesDoSku(null)).toBeNull();
  });
  const kit = (m: number, base: string | null = '9001') => ({ ...fam(upp(String(m)), m), kit_base_codigo_pai: base });
  it('kit vinculado: kit_multiplicador × UNITS_PER_PACK da base (kit de 3 caixas de 24 → 72)', () => {
    expect(unidadesDoSku(kit(3), new Map([['9001', 24]]))).toBe(72);
    expect(unidadesDoSku(kit(3), new Map([['9001', 1]]))).toBe(3);
  });
  it('kit vinculado: UPP do kit = multiplicador sozinho não prova nada; base desconhecida/ausente → null', () => {
    expect(unidadesDoSku(kit(3))).toBeNull();
    expect(unidadesDoSku(kit(3), new Map([['9001', null]]))).toBeNull();
    expect(unidadesDoSku(kit(3, null), new Map([['9001', 24]]))).toBeNull();
  });
});

describe('bases de kit', () => {
  const l = (f: object) => ({ id: 'x', codigo: '1', nome: null, custo: 1, peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null, atualizado_em: '', familias: { origem: null, kit_multiplicador: null, nome_pai: null, ...f } });
  it('basesDeKit: só linhas de kit, sem repetir', () => {
    expect(basesDeKit([l({}), l({ kit_multiplicador: 3, kit_base_codigo_pai: '9001' }), l({ kit_multiplicador: 2, kit_base_codigo_pai: '9001' })])).toEqual(['9001']);
  });
  it('uppDasBases: lotes da mesma base que concordam → valor; divergem ou não declaram → null', () => {
    const upp = (v: string) => [{ id: 'UNITS_PER_PACK', value_name: v }];
    const m = uppDasBases([
      { codigo_pai: 'A', atributos_ml: upp('24') }, { codigo_pai: 'A', atributos_ml: upp('24') },
      { codigo_pai: 'B', atributos_ml: upp('24') }, { codigo_pai: 'B', atributos_ml: upp('12') },
      { codigo_pai: 'C', atributos_ml: [] },
    ]);
    expect([m.get('A'), m.get('B'), m.get('C'), m.get('D')]).toEqual([24, null, null, undefined]);
  });
});

describe('dimensoesDaLinha', () => {
  it('completas → objeto; incompleta → null', () => {
    expect(dimensoesDaLinha({ altura_cm: '10', largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 })).toEqual({ altura_cm: 10, largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 });
    expect(dimensoesDaLinha({ altura_cm: null, largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 })).toBeNull();
  });
});

describe('deduplicarPorCodigo', () => {
  it('mesmo código em dois lotes → 1 linha (com custo, depois mais recente)', () => {
    const velha = linha({ id: 'a', atualizado_em: '2026-01-01T00:00:00Z' });
    const nova = linha({ id: 'b', atualizado_em: '2026-09-01T00:00:00Z' });
    const semCusto = linha({ id: 'c', custo: null, atualizado_em: '2026-10-01T00:00:00Z' });
    expect(deduplicarPorCodigo([velha, semCusto, nova]).map((l) => l.id)).toEqual(['b']);
  });
  it('SKU sem origem conta na ambiguidade: dois códigos, um sem origem → 2', () => {
    const semOrigem = linha({ id: 'b', codigo: '002', familias: { origem: null, kit_multiplicador: null, nome_pai: null } });
    expect(variacoesDasLinhas([linha({ id: 'a' }), semOrigem]).map((v) => [v.variacaoId, v.origem])).toEqual([['a', 'importado'], ['b', null]]);
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

describe('chaveFrete (#13: por conta ML)', () => {
  const D = { altura_cm: 10, largura_cm: 5, comprimento_cm: 20, peso_gramas: 300 };
  it('inclui conta, org, categoria, preço e embalagem', () => {
    expect(chaveFrete('111', 'org-1', 'MLB5', 99.9, D)).toBe('ext:fr:111:org-1:MLB5:99.9:10x5x20,300');
    expect(chaveFrete('111', 'org-1', 'MLB5', 99.9, null)).toBe('ext:fr:111:org-1:MLB5:99.9:padrao');
  });
  it('outra conta ML na mesma org → outra chave', () => {
    expect(chaveFrete('111', 'org-1', 'MLB5', 10, null)).not.toBe(chaveFrete('222', 'org-1', 'MLB5', 10, null));
  });
});

describe('dimensoesDoKitVivo (NEW-B: kit vivo e canônico)', () => {
  type Linha = Record<string, unknown>;
  /** Banco em memória com o pedaço do PostgREST usado: eq / in / not is null / order. */
  function banco(tabelas: Record<string, Linha[]>) {
    return {
      from(t: string) {
        let linhas = [...(tabelas[t] ?? [])];
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { linhas = linhas.filter((l) => l[c] === v); return q; },
          in: (c: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.includes(l[c])); return q; },
          not: (c: string) => { linhas = linhas.filter((l) => l[c] != null); return q; },
          order: (c: string, o: { ascending: boolean }) => {
            linhas.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o.ascending ? 1 : -1)); return q;
          },
          then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
        };
        return q;
      },
    } as never;
  }
  const fam = (id: string, codigo_pai: string, status: string, criado_em: string, kit_multiplicador = 3) =>
    ({ id, org_id: 'o', codigo_pai, kit_base_codigo_pai: '9001', kit_multiplicador, status, criado_em });
  const varia = (familia_id: string, altura_cm: number) =>
    ({ org_id: 'o', familia_id, altura_cm, largura_cm: 10, comprimento_cm: 10, peso_gramas: 900 });

  it('kit antigo (lote anterior) e kit em erro coexistindo com o vigente → dimensões do vigente', async () => {
    const admin = banco({
      familias: [
        fam('velho', '9100', 'publicado', '2026-01-01'), fam('atual', '9100', 'publicado', '2026-09-01'),
        fam('erro', '9200', 'erro', '2026-10-01'),
      ],
      variacoes: [varia('velho', 11), varia('atual', 22), varia('erro', 33)],
    });
    expect(await dimensoesDoKitVivo(admin, 'o', '9001', 3)).toMatchObject({ altura_cm: 22 });
  });

  it('dois kits vivos distintos com o mesmo multiplicador → null (ambíguo)', async () => {
    const admin = banco({
      familias: [fam('a', '9100', 'publicado', '2026-09-01'), fam('b', '9300', 'pronto', '2026-09-02')],
      variacoes: [varia('a', 22), varia('b', 44)],
    });
    expect(await dimensoesDoKitVivo(admin, 'o', '9001', 3)).toBeNull();
  });

  it('só kit em erro, outro multiplicador ou variação sem dimensões → null', async () => {
    expect(await dimensoesDoKitVivo(banco({ familias: [fam('e', '9200', 'erro', '2026-10-01')], variacoes: [varia('e', 33)] }), 'o', '9001', 3)).toBeNull();
    expect(await dimensoesDoKitVivo(banco({ familias: [fam('a', '9100', 'publicado', '2026-09-01', 2)], variacoes: [varia('a', 22)] }), 'o', '9001', 3)).toBeNull();
    expect(await dimensoesDoKitVivo(banco({ familias: [fam('a', '9100', 'publicado', '2026-09-01')], variacoes: [{ org_id: 'o', familia_id: 'a', altura_cm: null }] }), 'o', '9001', 3)).toBeNull();
  });
});
