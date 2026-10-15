import { describe, it, expect } from 'vitest';
import {
  chaveNfeValida, gtinValido, cfopAceito, quantidadeEmEstoque, conciliarItens, custoAquisicaoUnit,
  erroDistribuicao, limparDescricaoFornecedor, origemSugerida,
} from '../regras';
import type { ItemNotaLido, NotaCompraLida } from '../tipos';

const item = (o: Partial<ItemNotaLido> = {}): ItemNotaLido => ({
  nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null, uCom: 'PC',
  qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, ...o,
});
const zero = { vProd: 0, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vII: 0, vIPIDevol: 0, vFCPST: 0, vNF: 0 };
const nota = (itens: ItemNotaLido[], tot: Partial<typeof zero>): NotaCompraLida => ({
  chave: '26261011222333000181550010000010511000030324', numero: 1, serie: 1, modelo: 55, tipoNf: 1,
  emitidaEm: '2026-10-13T00:00:00-03:00', emitenteCnpj: '11222333000181', emitenteNome: 'F',
  destinatarioCnpj: '11444777000161', assinada: false, cStat: 100, itens, totais: { ...zero, ...tot },
});

describe('chaveNfeValida', () => {
  it('aceita DV correto e recusa DV, tamanho e caractere errados', () => {
    expect(chaveNfeValida('26261011222333000181550010000010511000030324')).toBe(true);
    expect(chaveNfeValida('26261011222333000181550010000010511000030325')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032')).toBe(false);
    expect(chaveNfeValida('2626101122233300018155001000001051100003032X')).toBe(false);
  });
});

describe('gtinValido', () => {
  it('aceita EAN-13 com DV certo e recusa DV errado ou tamanho inválido', () => {
    expect(gtinValido('7891234567895')).toBe(true);
    expect(gtinValido('7891234567894')).toBe(false);
    expect(gtinValido('12345')).toBe(false);
  });
});

describe('cfopAceito', () => {
  it('venda/revenda (5102, 6102, 5405) sim; bonificação, remessa, devolução não', () => {
    for (const c of ['5102', '6102', '5405']) expect(cfopAceito(c)).toBe(true);
    for (const c of ['5910', '5949', '5202']) expect(cfopAceito(c)).toBe(false);
  });
});

describe('quantidadeEmEstoque', () => {
  it('2 CX × 12 = 24; fracionário que não fecha e fator inválido recusam', () => {
    expect(quantidadeEmEstoque(2, 12)).toEqual({ ok: true, quantidade: 24 });
    expect(quantidadeEmEstoque(2.5, 1).ok).toBe(false);
    expect(quantidadeEmEstoque(2, 0).ok).toBe(false);
    expect(quantidadeEmEstoque(2, 1.5).ok).toBe(false);
  });
});

describe('conciliarItens', () => {
  it('usa os valores por item quando batem com o total', () => {
    const r = conciliarItens(nota([item({ vFrete: 5 })], { vProd: 350, vFrete: 5, vNF: 355 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens[0].vFrete).toBe(5);
    expect(r.itens[0].rateio).toEqual({});
    expect(r.avisoTotal).toBeNull();
  });
  it('rateia por maiores restos: 10,00 em 3 itens iguais', () => {
    const r = conciliarItens(nota(
      [item({ nItem: 1, vProd: 100 }), item({ nItem: 2, vProd: 100 }), item({ nItem: 3, vProd: 100 })],
      { vProd: 300, vFrete: 10, vNF: 310 },
    ));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vFrete)).toEqual([3.34, 3.33, 3.33]);
    expect(r.itens[0].rateio).toEqual({ vFrete: 3.34 });
  });
  it('0,02 em 4 itens nunca gera parcela negativa; 0,01 só no total também rateia', () => {
    const quatro = [1, 2, 3, 4].map((n) => item({ nItem: n, vProd: 10 }));
    const r = conciliarItens(nota(quatro, { vProd: 40, vFrete: 0.02, vNF: 40.02 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vFrete)).toEqual([0.01, 0.01, 0, 0]);
    const um = conciliarItens(nota([item({ vProd: 10 })], { vProd: 10, vSeg: 0.01, vNF: 10.01 }));
    expect(um.ok && um.itens[0].vSeg).toBe(0.01);
  });
  it('desconto só no total é rateado e reduz (não aumenta) o custo', () => {
    const r = conciliarItens(nota([item({ nItem: 1, vProd: 75 }), item({ nItem: 2, vProd: 25 })],
      { vProd: 100, vDesc: 10, vNF: 90 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens.map((i) => i.vDesc)).toEqual([7.5, 2.5]);
  });
  it('recusa negativo, vProd que não bate e acessório parcial', () => {
    expect(conciliarItens(nota([item({ vFrete: -5 })], { vProd: 350, vFrete: -5 })).ok).toBe(false);
    expect(conciliarItens(nota([item({ vProd: 100 })], { vProd: 300 })).ok).toBe(false);
    expect(conciliarItens(nota([item({ vFrete: 2 })], { vProd: 350, vFrete: 5 })).ok).toBe(false);
  });
  it('vNF fora da composição vira aviso, não recusa', () => {
    const r = conciliarItens(nota([item()], { vProd: 350, vNF: 999999 }));
    expect(r.ok && r.avisoTotal).toMatch(/999999/);
    expect(r.ok && r.divergenciaTotal).toBeCloseTo(999649, 2);
  });
  it('maiores restos desempatam pelo menor nItem, não pela posição no XML', () => {
    const r = conciliarItens(nota([4, 3, 2, 1].map((n) => item({ nItem: n, vProd: 10 })), { vProd: 40, vFrete: 0.02, vNF: 40.02 }));
    if (!r.ok) throw new Error(r.erro);
    expect(Object.fromEntries(r.itens.map((i) => [i.nItem, i.vFrete]))).toEqual({ 1: 0.01, 2: 0.01, 3: 0, 4: 0 });
  });
});

describe('vFCPST, vII e vIPIDevol', () => {
  it('vFCPST entra no custo de aquisição (só no total → rateado)', () => {
    const r = conciliarItens(nota([item({ vProd: 700, qCom: 70 })], { vProd: 700, vFCPST: 14, vNF: 714 }));
    if (!r.ok) throw new Error(r.erro);
    expect(r.itens[0].vFCPST).toBe(14);
    expect(custoAquisicaoUnit(r.itens[0], 1)).toBeCloseTo(714 / 70, 10);
  });
  it('vII ou vIPIDevol > 0 recusa', () => {
    expect(conciliarItens(nota([item()], { vProd: 350, vII: 1, vNF: 351 })).ok).toBe(false);
    expect(conciliarItens(nota([item()], { vProd: 350, vIPIDevol: 1, vNF: 351 })).ok).toBe(false);
  });
});

describe('custoAquisicaoUnit', () => {
  it('soma acessórios, subtrai desconto e divide pela quantidade convertida', () => {
    const r = conciliarItens(nota(
      [item({ qCom: 2, vProd: 240, vFrete: 12, vSeg: 1, vOutro: 2, vIPI: 6, vST: 3, vDesc: 4 })],
      { vProd: 240, vFrete: 12, vSeg: 1, vOutro: 2, vIPI: 6, vST: 3, vDesc: 4, vNF: 260 },
    ));
    if (!r.ok) throw new Error(r.erro);
    expect(custoAquisicaoUnit(r.itens[0], 12)).toBeCloseTo(260 / 24, 10);
  });
});

describe('erroDistribuicao', () => {
  const l = (codigo: string, quantidade: number) => ({ codigo, quantidade, custoPrecificacao: 10 });
  it('soma exata passa; diferente diz quanto falta', () => {
    expect(erroDistribuicao(35, [l('A', 15), l('B', 20)])).toBeNull();
    expect(erroDistribuicao(35, [l('A', 15), l('B', 18)])).toMatch(/33 de 35/);
  });
  it('repetido, não inteiro, ≤ 0, custo ≤ 0 e lista vazia falham', () => {
    expect(erroDistribuicao(10, [l('A', 5), l('A', 5)])).toMatch(/repetido/);
    expect(erroDistribuicao(10, [l('A', 10.5)])).toMatch(/inteira/);
    expect(erroDistribuicao(10, [l('A', 0), l('B', 10)])).toMatch(/maior que zero/);
    expect(erroDistribuicao(10, [{ codigo: 'A', quantidade: 10, custoPrecificacao: 0 }])).toMatch(/custo/i);
    expect(erroDistribuicao(10, [])).toMatch(/0 de 10/);
  });
});

describe('limparDescricaoFornecedor', () => {
  it('tira o sufixo de grade agregada e normaliza espaços', () => {
    expect(limparDescricaoFornecedor('Short masculino - DIV - DIV')).toBe('Short masculino');
    expect(limparDescricaoFornecedor('  Camiseta  básica ')).toBe('Camiseta básica');
  });
});

describe('origemSugerida', () => {
  it('ausente fica pendente; importação direta vira mercado interno; binária coerente', () => {
    expect(origemSugerida(null)).toBeNull();
    expect(origemSugerida(0)).toEqual({ origemNfe: 0, origem: 'nacional' });
    expect(origemSugerida(1)).toEqual({ origemNfe: 2, origem: 'importado' });
    expect(origemSugerida(6)).toEqual({ origemNfe: 7, origem: 'importado' });
    expect(origemSugerida(3)).toEqual({ origemNfe: 3, origem: 'nacional' });
    expect(origemSugerida(8)).toEqual({ origemNfe: 8, origem: 'nacional' });
  });
});
