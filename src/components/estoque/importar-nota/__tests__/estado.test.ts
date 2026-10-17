import { describe, it, expect } from 'vitest';
import { estadoInicial, definirProduto, definirFator, definirDistribuicao, pendencias, payload, recusaInicial, aceitarDivergencia, acaoVariacaoFaltante, travarLinhaNova, motivoBloqueioEtapa, aplicarCadastradosDaNota, itemPronto, contarProntos, aplicarSugestaoCadastro } from '../estado';
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

describe('aplicarCadastradosDaNota (retomada por refNota)', () => {
  const vinc = [{ cprod: 'REF 06', codigoPai: 'A', fator: 1 }];
  it('supera vínculo; manual nunca é sobrescrito', () => {
    const e = estadoInicial(nota, '<x/>', vinc, {});
    expect(aplicarCadastradosDaNota(e, [{ nItem: 1, codigosPai: ['B'] }]).decisoes[0])
      .toMatchObject({ codigoPai: 'B', origemVinculo: 'nota' });
    const m = definirProduto(e, 1, 'C');
    expect(aplicarCadastradosDaNota(m, [{ nItem: 1, codigosPai: ['B'] }]).decisoes[0].codigoPai).toBe('C');
  });
  it('vários códigos viram candidatosNota sem produto', () => {
    const e = estadoInicial(nota, '<x/>', [], {});
    expect(aplicarCadastradosDaNota(e, [{ nItem: 2, codigosPai: ['B', 'D'] }]).decisoes[1])
      .toMatchObject({ codigoPai: null, candidatosNota: ['B', 'D'] });
  });
  it('mesmo cProd em itens distintos: cada um com o seu', () => {
    const dup = { ...nota, totais: { ...zero, vProd: 700, vNF: 700 }, itens: [nota.itens[0], { ...nota.itens[0], nItem: 2 }] };
    const e = estadoInicial(dup, '<x/>', vinc, {});
    const r = aplicarCadastradosDaNota(e, [{ nItem: 1, codigosPai: ['B'] }, { nItem: 2, codigosPai: ['D'] }]);
    expect(r.decisoes.map((d) => d.codigoPai)).toEqual(['B', 'D']);
  });
  it('lista vazia deixa o estado igual', () => {
    const e = estadoInicial(nota, '<x/>', vinc, {});
    expect(aplicarCadastradosDaNota(e, [])).toEqual(e);
  });
  it('definirProduto preserva candidatosGtin; casados guardam candidatosGtin', () => {
    const e = estadoInicial(nota, '<x/>', [{ cprod: 'X9', codigoPai: 'P1', fator: 1 }], { '7891234567895': ['P2', 'P3'] });
    expect(e.decisoes[1]).toMatchObject({ codigoPai: 'P1', origemVinculo: 'vinculo', candidatosGtin: ['P2', 'P3'] });
    expect(definirProduto(e, 2, 'Z').decisoes[1]).toMatchObject({ codigoPai: 'Z', origemVinculo: 'manual', candidatosGtin: ['P2', 'P3'] });
    const u = estadoInicial(nota, '<x/>', [], { '7891234567895': ['P2'] });
    expect(u.decisoes[1]).toMatchObject({ codigoPai: 'P2', origemVinculo: 'gtin', candidatosGtin: ['P2'] });
    expect(definirProduto(amb(), 2, 'P3').decisoes[1].candidatosGtin).toEqual(['P2', 'P3']);
  });
  it('automático A -> definirProduto(A) vira manual, preserva distribuição e resiste à nota', () => {
    let e = estadoInicial(nota, '<x/>', vinc, {});
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    e = definirProduto(e, 1, 'A');
    expect(e.decisoes[0]).toMatchObject({ origemVinculo: 'manual', distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }] });
    expect(aplicarCadastradosDaNota(e, [{ nItem: 1, codigosPai: ['B'] }]).decisoes[0].codigoPai).toBe('A');
  });
  it('limpa distribuição não travada quando o produto muda', () => {
    let e = estadoInicial(nota, '<x/>', vinc, {});
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(aplicarCadastradosDaNota(e, [{ nItem: 1, codigosPai: ['B'] }]).decisoes[0].distribuicao).toEqual([]);
  });
  function amb() { return estadoInicial(nota, '<x/>', [], { '7891234567895': ['P2', 'P3'] }); }
});

describe('itemPronto / contarProntos', () => {
  it('produto + quantidade inteira = pronto; motivoBloqueio null sse todos prontos', () => {
    let e = estadoInicial(nota, '<x/>', [{ cprod: 'REF 06', codigoPai: 'A', fator: 1 }], {});
    expect(itemPronto(e, e.decisoes[0])).toBe(true);
    expect(itemPronto(e, e.decisoes[1])).toBe(false);
    expect(contarProntos(e)).toEqual({ prontos: 1, total: 2 });
    expect(motivoBloqueioEtapa(e, 1)).not.toBeNull();
    e = definirProduto(e, 2, 'B');
    expect(motivoBloqueioEtapa(e, 1)).toBeNull();
    const meio = { ...e, itens: e.itens.map((i) => (i.nItem === 1 ? { ...i, qCom: 0.5 } : i)) };
    expect(itemPronto(meio, meio.decisoes[0])).toBe(false);
    expect(motivoBloqueioEtapa(meio, 1)).toMatch(/^Item 1:/);
  });
});

// ADR-0181 (emenda 2026-10-17): sugestão de distribuição gravada no cadastro pela nota.
describe('sugestão de distribuição do cadastro', () => {
  const sug = (fator: number, linhas: Array<[string, number]>) =>
    ({ fator, linhas: linhas.map(([codigo, quantidade]) => ({ codigo, quantidade })) });
  const linhasDe = (e: ReturnType<typeof estadoInicial>, n: number) =>
    e.decisoes[n].distribuicao.map(({ codigo, quantidade, travada, sugerida }) => ({ codigo, quantidade, travada, sugerida }));

  it('reabrir: produto `nota` aplicado ⇒ distribuição semeada com a sugestão (sugerida, sem travar)', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 20], ['S2', 15]]) }]);
    expect(linhasDe(e, 0)).toEqual([
      { codigo: 'S1', quantidade: 20, travada: undefined, sugerida: true },
      { codigo: 'S2', quantidade: 15, travada: undefined, sugerida: true }]);
    expect(pendencias(e).filter((p) => p.nItem === 1)).toEqual([]);
  });
  it('fator 12 gravado é restaurado ao reabrir (2 CX × 12 = 24)', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 2, codigosPai: ['P2'], sugestao: sug(12, [['M1', 24]]) }]);
    expect(e.decisoes[1]).toMatchObject({ codigoPai: 'P2', fator: 12, avisoSugestao: null });
    expect(itemPronto(e, e.decisoes[1])).toBe(true);
    expect(pendencias(e).filter((p) => p.nItem === 2)).toEqual([]);
  });
  it('vínculo com fator diferente ⇒ sugestão descartada com aviso; fator do vínculo fica', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [{ cprod: 'X9', codigoPai: 'P2', fator: 6 }], {}),
      [{ nItem: 2, codigosPai: ['P2'], sugestao: sug(12, [['M1', 24]]) }]);
    expect(e.decisoes[1]).toMatchObject({ fator: 6, distribuicao: [], avisoSugestao: 'Sugestão do cadastro descartada: fator da nota mudou' });
  });
  it('código que não existe mais é descartado + aviso (nunca vira SKU de outro produto)', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 20], ['VELHO', 15]]), codigosValidos: ['S1', 'S2'] }]);
    expect(linhasDe(e, 0)).toEqual([{ codigo: 'S1', quantidade: 20, travada: undefined, sugerida: true }]);
    expect(e.decisoes[0].distribuicao.some((l) => l.codigoPai)).toBe(false);
    expect(e.decisoes[0].avisoSugestao).toBe('Parte da sugestão é de SKUs que não existem mais — redistribua');
  });
  it('travadas vencem; escolha manual e linhas não travadas já editadas não são tocadas', () => {
    const previas = [{ nItem: 1, codigo: 'S1', quantidade: 3, custo: 5 }];
    const e0 = estadoInicial(nota, '<x/>', [], {}, previas);
    const e = aplicarCadastradosDaNota(e0, [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 20], ['S2', 15]]) }]);
    expect(linhasDe(e, 0)).toEqual([
      { codigo: 'S1', quantidade: 3, travada: true, sugerida: undefined },
      { codigo: 'S2', quantidade: 15, travada: undefined, sugerida: true }]);
    const manual = definirProduto(estadoInicial(nota, '<x/>', [], {}), 1, 'OUTRO');
    expect(aplicarCadastradosDaNota(manual, [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 35]]) }]).decisoes[0])
      .toEqual(manual.decisoes[0]);
    const vinc = [{ cprod: 'REF 06', codigoPai: 'P1', fator: 1 }];
    const editado = definirDistribuicao(estadoInicial(nota, '<x/>', vinc, {}), 1, [{ codigo: 'X', quantidade: 1, custoPrecificacao: 8, codigoPai: 'Z' } as never]);
    const r = aplicarCadastradosDaNota(editado, [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 35]]) }]);
    expect(r.decisoes[0].distribuicao.map((l) => l.codigo)).toEqual(['X']);
  });
  it('vários códigos para o item: sugestão não é aplicada', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1', 'P9'], sugestao: sug(1, [['S1', 35]]) }]);
    expect(e.decisoes[0].distribuicao).toEqual([]);
  });
  it('trocar produto ou fator descarta a sugestão', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 35]]) }]);
    expect(definirProduto(e, 1, 'P9').decisoes[0].distribuicao).toEqual([]);
    expect(definirFator(e, 1, 2).decisoes[0].distribuicao).toEqual([]);
  });
  it('sugestão que não soma Q aparece como está e bloqueia a etapa', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 10]]) }]);
    expect(linhasDe(e, 0)).toEqual([{ codigo: 'S1', quantidade: 10, travada: undefined, sugerida: true }]);
    expect(motivoBloqueioEtapa(e, 2)).toMatch(/^Item 1:/);
  });
  it('sessão (aoCadastrar): aplica a sugestão devolvida pela edge; sem sugestão, só vincula', () => {
    let e = definirProduto(estadoInicial(nota, '<x/>', [], {}), 2, 'P2');
    e = definirFator(e, 2, 12);
    const com = aplicarSugestaoCadastro(e, 2, sug(12, [['M1', 20], ['M2', 4]]));
    expect(linhasDe(com, 1).map((l) => [l.codigo, l.quantidade, l.sugerida])).toEqual([['M1', 20, true], ['M2', 4, true]]);
    expect(aplicarSugestaoCadastro(e, 2, undefined)).toBe(e);
    expect(aplicarSugestaoCadastro(e, 2, null)).toBe(e);
    expect(aplicarSugestaoCadastro(definirFator(e, 2, 6), 2, sug(12, [['M1', 24]])).decisoes[1])
      .toMatchObject({ fator: 6, distribuicao: [], avisoSugestao: 'Sugestão do cadastro descartada: fator da nota mudou' });
  });
  it('payload não carrega a flag sugerida', () => {
    const e = aplicarCadastradosDaNota(estadoInicial(nota, '<x/>', [], {}),
      [{ nItem: 1, codigosPai: ['P1'], sugestao: sug(1, [['S1', 35]]) }, { nItem: 2, codigosPai: ['P2'], sugestao: sug(1, [['M1', 2]]) }]);
    expect(JSON.stringify(payload(e))).not.toContain('sugerida');
  });
});
