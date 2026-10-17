import { describe, it, expect } from 'vitest';
import { linhasIniciais, semearDistribuicao, definirFator, definirDistribuicao, estadoInicial, custoPadraoSku } from '../estado';
import { custoAquisicaoUnit } from '../../../../../supabase/functions/_shared/nfe/regras';
import type { NotaCompraLida } from '../../../../../supabase/functions/_shared/nfe/tipos';

describe('linhasIniciais', () => {
  it('1 SKU recebe o total; vários SKUs começam zerados com o custo default', () => {
    expect(linhasIniciais([{ codigo: 'S1' }], 35, 10)).toEqual([{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(linhasIniciais([{ codigo: 'S1' }, { codigo: 'S2' }], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }]);
  });
});

describe('semearDistribuicao', () => {
  it('sem linha salva usa linhasIniciais', () => {
    expect(semearDistribuicao([{ codigo: 'S1' }], [], 35, 10)).toEqual(linhasIniciais([{ codigo: 'S1' }], 35, 10));
  });
  it('preserva quantidade, custo editado e SKU de outro produto; SKU sem linha entra zerado', () => {
    const salva = [
      { codigo: 'S1', quantidade: 20, custoPrecificacao: 12.5 },
      { codigo: 'X9', quantidade: 15, custoPrecificacao: 8, codigoPai: 'OUTRO' },
    ];
    expect(semearDistribuicao([{ codigo: 'S1' }, { codigo: 'S2' }], salva, 35, 10)).toEqual([
      salva[0], { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }, salva[1]]);
    // 1 SKU com tudo movido p/ outro produto: não volta a receber o total
    expect(semearDistribuicao([{ codigo: 'S1' }], [salva[1]], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, salva[1]]);
  });
});

describe('definirFator', () => {
  const z = { vProd: 240, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 240 };
  const nota: NotaCompraLida = {
    chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
    emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
    destinatarioCnpj: '11444777000161', totais: z, assinada: false, cStat: 100,
    itens: [{ nItem: 1, cProd: 'X', xProd: 'Meia', ncm: null, cfop: '5102', gtin: null, uCom: 'CX', qCom: 2,
      vProd: 240, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0 }],
  };
  it('fator novo limpa as linhas não travadas, preserva as travadas e o semear usa o custo novo', () => {
    const previas = [{ nItem: 1, codigo: 'T1', quantidade: 3, custo: 5 }];
    let e = estadoInicial(nota, '<x/>', [{ cprod: 'X', codigoPai: 'P', fator: 1 }], {}, previas);
    e = definirDistribuicao(e, 1, [{ codigo: 'S1', quantidade: 2, custoPrecificacao: 120 }]);
    expect(e.decisoes[0].distribuicao.map((l) => l.codigo)).toEqual(['T1', 'S1']);
    e = definirFator(e, 1, 12);
    expect(e.decisoes[0].distribuicao).toEqual([expect.objectContaining({ codigo: 'T1', travada: true })]);
    const custo = Math.round(custoAquisicaoUnit(e.itens[0], 12) * 100) / 100;
    expect(custo).toBe(10);
    expect(semearDistribuicao([{ codigo: 'S1' }], e.decisoes[0].distribuicao, 24, custo)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, expect.objectContaining({ codigo: 'T1' })]);
    expect(definirFator(e, 1, 12).decisoes[0]).toBe(e.decisoes[0]);
  });
});

// ADR-0181 D-9 (emenda 2026-10-17): custo padrão = custo cadastrado só com prova positiva de 1ª entrada.
describe('custoPadraoSku', () => {
  it('prova positiva + custo > 0 + saldo 0 ⇒ custo cadastrado (casos reais 00000010 → 17, 00000043 → 14,50)', () => {
    expect(custoPadraoSku({ custo: 17, saldo: 0 }, true, 10)).toBe(17);
    expect(custoPadraoSku({ custo: 14.5, saldo: 0 }, true, 10)).toBe(14.5);
    // custo numeric sem escala: nunca arredondar (sobrescreveria o valor no confirmar).
    expect(custoPadraoSku({ custo: 4.251, saldo: 0 }, true, 10)).toBe(4.251);
  });
  it('sem prova (recompra, planilha, manual, histórico com estoque, consulta falhou) ⇒ custo da nota', () => {
    expect(custoPadraoSku({ custo: 17, saldo: 0 }, false, 10)).toBe(10);
  });
  it('saldo > 0, custo nulo ou 0 ⇒ custo da nota', () => {
    expect(custoPadraoSku({ custo: 17, saldo: 3 }, true, 10)).toBe(10);
    expect(custoPadraoSku({ custo: null, saldo: 0 }, true, 10)).toBe(10);
    expect(custoPadraoSku({ custo: 0, saldo: 0 }, true, 10)).toBe(10);
  });
});

describe('linhasIniciais / semearDistribuicao com custo do SKU', () => {
  const skus = [{ codigo: 'S1', custo: 17, estoque: 0 }, { codigo: 'S2', custo: 17, estoque: 0 }];
  it('com prova: todos os SKUs com 17 e quantidade 0 (short 00000010)', () => {
    expect(linhasIniciais(skus, 32, 10, true)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 17 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 17 }]);
  });
  it('sem prova (recompra com saldo > 0 e custo antigo): custo da nota', () => {
    expect(linhasIniciais([{ codigo: 'S1', custo: 17, estoque: 5 }], 32, 10, true)[0].custoPrecificacao).toBe(10);
    expect(linhasIniciais(skus, 32, 10, false).map((l) => l.custoPrecificacao)).toEqual([10, 10]);
  });
  it('linha sugerida: quantidade da sugestão e custo recalculado pelo SKU (não o placeholder da nota)', () => {
    const salva = [{ codigo: 'S1', quantidade: 5, custoPrecificacao: 10, sugerida: true }];
    expect(semearDistribuicao(skus, salva, 32, 10, true)).toEqual([
      { codigo: 'S1', quantidade: 5, custoPrecificacao: 17 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 17 }]);
    expect(semearDistribuicao(skus, salva, 32, 10, false)[0]).toEqual({ codigo: 'S1', quantidade: 5, custoPrecificacao: 10 });
  });
  it('travada e linha já editada mantêm o custo salvo; outro produto preservado', () => {
    const salva = [
      { codigo: 'S1', quantidade: 3, custoPrecificacao: 9, travada: true },
      { codigo: 'X9', quantidade: 2, custoPrecificacao: 8, codigoPai: 'OUTRO' },
    ];
    expect(semearDistribuicao(skus, salva, 32, 10, true)).toEqual([
      salva[0], { codigo: 'S2', quantidade: 0, custoPrecificacao: 17 }, salva[1]]);
  });
});
