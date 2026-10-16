import { describe, it, expect } from 'vitest';
import { estadoInicial, definirProduto, definirFator, definirDistribuicao, pendencias, payload, recusaInicial, aceitarDivergencia, acaoVariacaoFaltante, travarLinhaNova, motivoBloqueioEtapa } from '../estado';
import type { NotaCompraLida } from '../../../../../supabase/functions/_shared/nfe/tipos';

const zero = { vProd: 590, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 590 };
const nota: NotaCompraLida = {
  chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', totais: zero, assinada: false, cStat: 100,
  itens: [
    { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: null, cfop: '5102', gtin: null, uCom: 'PC', qCom: 35,
      vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 },
    { nItem: 2, cProd: 'X9', xProd: 'Meia', ncm: null, cfop: '5102', gtin: '7891234567895', uCom: 'CX', qCom: 2,
      vProd: 240, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 },
  ],
};

describe('recusaInicial', () => {
  it('destinatário, CFOP, já importada e desfeita', () => {
    expect(recusaInicial(nota, '11444777000161', null)).toBeNull();
    expect(recusaInicial(nota, '99999999000191', null)).toMatch(/destinatário/);
    expect(recusaInicial({ ...nota, itens: [{ ...nota.itens[0], cfop: '5910' }] }, '11444777000161', null)).toMatch(/5910/);
    expect(recusaInicial(nota, '11444777000161', { status: 'importada', importadaEm: '2026-10-14T10:00:00Z' })).toMatch(/já foi importada em 14\/10/);
    expect(recusaInicial(nota, '11444777000161', { status: 'desfeita', importadaEm: '2026-10-14T10:00:00Z' })).toMatch(/desfeita/);
  });
});

describe('estado da importação', () => {
  it('vínculo pré-seleciona; GTIN único casa; GTIN ambíguo vira conflito', () => {
    const e = estadoInicial(nota, '<x/>', [{ cprod: 'REF 06', codigoPai: 'P1', fator: 1 }], { '7891234567895': ['P2'] });
    expect(e.decisoes[0]).toMatchObject({ codigoPai: 'P1', origemVinculo: 'vinculo' });
    expect(e.decisoes[1]).toMatchObject({ codigoPai: 'P2', origemVinculo: 'gtin' });
    const amb = estadoInicial(nota, '<x/>', [], { '7891234567895': ['P2', 'P3'] });
    expect(amb.decisoes[1]).toMatchObject({ codigoPai: null, candidatosGtin: ['P2', 'P3'] });
    expect(pendencias(amb).find((p) => p.nItem === 2)?.erro).toMatch(/2 produtos/);
  });
  it('distribuição usa a quantidade convertida e aceita SKU de outro produto', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 20, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 2)?.erro).toMatch(/20 de 24/);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 20, custoPrecificacao: 10 },
                                   { codigo: 'OUTRO-PRODUTO-1', quantidade: 4, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 2)).toBeUndefined();
  });
  it('trocar o produto zera a distribuição, mas preserva o que já está no ledger (travado)', () => {
    let e = estadoInicial(nota, '<x/>', [], {}, [{ nItem: 1, codigo: 'S9', quantidade: 5, custo: 10 }]);
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    e = definirProduto(e, 1, 'P9');
    expect(e.decisoes[0].distribuicao).toEqual([{ codigo: 'S9', quantidade: 5, custoPrecificacao: 10, travada: true }]);
    // e a pendência cobra só o restante: 5 de 35
    expect(pendencias(e).find((p) => p.nItem === 1)?.erro).toMatch(/5 de 35/);
  });
  it('linha travada com custo nulo: nasce com o custo de aquisição e o custo é editável; quantidade não', () => {
    let e = estadoInicial(nota, '<x/>', [], {}, [{ nItem: 1, codigo: 'S9', quantidade: 5, custo: null }]);
    expect(e.decisoes[0].distribuicao[0]).toMatchObject({ codigo: 'S9', quantidade: 5, custoPrecificacao: 10, travada: true });
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S9', quantidade: 99, custoPrecificacao: 12 },
                                   { codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    expect(e.decisoes[0].distribuicao).toEqual([
      { codigo: 'S9', quantidade: 5, custoPrecificacao: 12, travada: true },
      { codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    expect(pendencias(e).find((p) => p.nItem === 1)).toBeUndefined();
  });
  it('divergência de vNF vira pendência até o aceite e segue no payload', () => {
    const div = { ...nota, totais: { ...nota.totais, vNF: 600 } };
    let e = estadoInicial(div, '<x/>', [], {});
    expect(pendencias(e).some((p) => p.nItem === 0)).toBe(true);
    e = aceitarDivergencia(e, true);
    expect(pendencias(e).some((p) => p.nItem === 0)).toBe(false);
  });
  it('payload só sai sem pendências e contém só decisões (não a nota)', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    expect(() => payload(e)).toThrow(/pendên/);
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }]);
    expect(payload(e)).toEqual({ xml: '<x/>', aceitarDivergenciaTotal: false, decisoes: [
      { nItem: 1, codigoPai: 'P1', fator: 1, distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }] },
      { nItem: 2, codigoPai: 'P2', fator: 12, distribuicao: [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }] },
    ] });
  });
});

describe('variação faltante (D-8)', () => {
  it('publicado+admin abre o fluxo; publicado sem admin pede admin; não publicado recusa', () => {
    expect(acaoVariacaoFaltante({ publicado: true }, true)).toBe('adicionar-publicado');
    expect(acaoVariacaoFaltante({ publicado: true }, false)).toBe('pedir-admin');
    expect(acaoVariacaoFaltante({ publicado: false }, true)).toBe('recusar-nao-publicado');
  });
  it('linha nova entra travada e o payload não carrega a flag', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    e = definirProduto(e, 1, 'P1');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 30, custoPrecificacao: 10 }]);
    e = travarLinhaNova(e, 1, 'S9', 5, 10);
    expect(e.decisoes[0].distribuicao.find((l) => l.codigo === 'S9')).toMatchObject({ quantidade: 5, travada: true });
    e = definirProduto(e, 2, 'P2'); e = definirFator(e, 2, 12);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 24, custoPrecificacao: 10 }]);
    expect(JSON.stringify(payload(e))).not.toContain('travada');
  });
  it('repetir o mesmo código (retry jaExistia) substitui a linha em vez de duplicar', () => {
    let e = definirProduto(estadoInicial(nota, '<x/>', [], {}), 1, 'P1');
    e = travarLinhaNova(e, 1, 'S9', 5, 10);
    e = travarLinhaNova(e, 1, 'S9', 5, 10);
    expect(e.decisoes[0].distribuicao.filter((l) => l.codigo === 'S9')).toHaveLength(1);
  });
});

describe('motivoBloqueioEtapa', () => {
  it('etapa Produtos só avança com produto e fator válido em todo item', () => {
    let e = estadoInicial(nota, '<x/>', [], {});
    expect(motivoBloqueioEtapa(e, 1)).toBe('Item 1: escolha ou cadastre o produto.');
    e = definirProduto(e, 1, 'P1');
    expect(motivoBloqueioEtapa(e, 1)).toBe('Item 2: escolha ou cadastre o produto.');
    e = definirProduto(e, 2, 'P2');
    expect(motivoBloqueioEtapa(e, 1)).toBeNull();
    expect(motivoBloqueioEtapa(definirFator(e, 2, 0), 1)).toMatch(/^Item 2: /);
  });
  it('etapa Distribuição só avança com a soma exata em todo item', () => {
    let e = definirProduto(definirProduto(estadoInicial(nota, '<x/>', [], {}), 1, 'P1'), 2, 'P2');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 34, custoPrecificacao: 10 }]);
    e = definirDistribuicao(e, 2, [{ codigo: 'S2', quantidade: 2, custoPrecificacao: 120 }]);
    expect(motivoBloqueioEtapa(e, 2)).toBe('Item 1: A distribuição soma 34 de 35 unidades da nota.');
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(motivoBloqueioEtapa(e, 2)).toBeNull();
  });
});
