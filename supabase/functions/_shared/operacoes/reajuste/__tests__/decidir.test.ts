import { describe, expect, it } from 'vitest';
import { decidirReajuste, reconciliarPasso, type Vivo } from '../decidir.ts';
import { oferta } from '../ofertas.ts';
import type { Passo } from '../tipos.ts';

const ok = (preco: number, todasIguais = true, composicao: string[] | null = null): Vivo =>
  ({ kind: 'ok', preco, todasIguais, composicao });
const FALHOU: Vivo = { kind: 'falhou' };

// alvo 11,00; anterior 10,00
describe('decidirReajuste — ml_confirmado', () => {
  it('sempre persistir (mesmo com leitura falha)', () => {
    expect(decidirReajuste('ml_confirmado', 11, 10, FALHOU, null)).toEqual({ tipo: 'persistir' });
    expect(decidirReajuste('ml_confirmado', 11, 10, ok(10), null)).toEqual({ tipo: 'persistir' });
  });
});

describe('decidirReajuste — escrita_pedida (conferência)', () => {
  it('leitura falhou → conferindo', () => {
    expect(decidirReajuste('escrita_pedida', 11, 10, FALHOU, null))
      .toEqual({ tipo: 'fim', status: 'conferindo', mensagem: 'Aguardando confirmação do ML' });
  });
  it('composição mudou → erro', () => {
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(11, true, ['1', '3']), ['1', '2']))
      .toEqual({ tipo: 'fim', status: 'erro', mensagem: 'Variações do anúncio mudaram durante o reajuste' });
  });
  it('todas = alvo → persistir (composição em outra ordem é igual)', () => {
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(11, true, ['2', '1']), ['1', '2'])).toEqual({ tipo: 'persistir' });
  });
  it('comparação em centavos', () => {
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(11.001), null)).toEqual({ tipo: 'persistir' });
  });
  it('todas = anterior → voltar_pendente', () => {
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(10), null)).toEqual({ tipo: 'voltar_pendente' });
  });
  it('outro valor ou variações divergentes → erro terceiros', () => {
    const erro = { tipo: 'fim', status: 'erro', mensagem: 'Preço alterado por terceiros durante o reajuste' };
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(12), null)).toEqual(erro);
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(11, false), null)).toEqual(erro);
    expect(decidirReajuste('escrita_pedida', 11, 10, ok(10, false), null)).toEqual(erro);
  });
});

describe('decidirReajuste — sem etapa (envio novo)', () => {
  it('leitura falhou → erro', () => {
    expect(decidirReajuste(null, 11, 10, FALHOU, null))
      .toEqual({ tipo: 'fim', status: 'erro', mensagem: 'Não foi possível ler o anúncio' });
  });
  it('composição mudou → mudou', () => {
    const m = { tipo: 'fim', status: 'mudou', mensagem: 'Variações do anúncio mudaram — refaça o preview' };
    expect(decidirReajuste(null, 11, 10, ok(10, true, ['1']), ['1', '2'])).toEqual(m);
    expect(decidirReajuste(null, 11, 10, ok(10, true, null), ['1'])).toEqual(m);
    expect(decidirReajuste(null, 11, 10, ok(10, true, ['1']), null)).toEqual(m);
  });
  it('preço ≠ anterior ou variações divergentes → mudou', () => {
    const m = { tipo: 'fim', status: 'mudou', mensagem: 'O preço mudou desde o preview' };
    expect(decidirReajuste(null, 11, 10, ok(10.5), null)).toEqual(m);
    expect(decidirReajuste(null, 11, 10, ok(10, false), null)).toEqual(m);
  });
  it('igual ao anterior → escrever', () => {
    expect(decidirReajuste(null, 11, 10, ok(10, true, ['1', '2']), ['2', '1'])).toEqual({ tipo: 'escrever' });
    expect(decidirReajuste(null, 11, 10, ok(10), null)).toEqual({ tipo: 'escrever' });
  });
});

describe('reconciliarPasso', () => {
  const base: Passo = { tipo: 'base', anterior: 10, alvo: 11, estado: 'escrita_pedida' };
  const f = (preco: number, min_unidades = 3) => ({ min_unidades, preco });
  const faixas: Passo = { tipo: 'faixas', anterior: [f(8)], alvo: [f(9)], estado: 'escrita_pedida' };

  it('base: mesma regra de decidirReajuste', () => {
    expect(reconciliarPasso(base, ok(11))).toBe('alvo');
    expect(reconciliarPasso(base, ok(10))).toBe('anterior');
    expect(reconciliarPasso(base, ok(10.5))).toBe('indefinido');
    expect(reconciliarPasso(base, ok(11, false))).toBe('indefinido');
    expect(reconciliarPasso(base, FALHOU)).toBe('indefinido');
  });
  it('base: composição diferente da esperada → indefinido', () => {
    expect(reconciliarPasso(base, ok(11, true, ['1']), ['1', '2'])).toBe('indefinido');
    expect(reconciliarPasso(base, ok(11, true, ['2', '1']), ['1', '2'])).toBe('alvo');
  });
  it('faixas: por mesmasFaixas, em centavos e sem depender da ordem', () => {
    expect(reconciliarPasso(faixas, [f(9.001)])).toBe('alvo');
    expect(reconciliarPasso(faixas, [f(8)])).toBe('anterior');
    expect(reconciliarPasso(faixas, [f(8.5)])).toBe('indefinido');
    expect(reconciliarPasso(faixas, [])).toBe('indefinido');
    expect(reconciliarPasso(faixas, null)).toBe('indefinido');
  });
  it('faixas: apagar não é anterior nem alvo, a menos que seja o combinado', () => {
    expect(reconciliarPasso({ ...faixas, anterior: [] }, [])).toBe('anterior');
  });
  it('oferta e saída ainda não têm leitura: lança', () => {
    const o = oferta({ promocao_id: 'P', tipo: 'DEAL', status: 'started', preco: 5, offer_id: null, inicio: null, fim: null });
    expect(() => reconciliarPasso({ tipo: 'saida', oferta: o, estado: 'escrita_pedida' }, FALHOU)).toThrow(/passo saida/);
    expect(() => reconciliarPasso({ tipo: 'oferta', oferta: o, anterior: 5, alvo: 4, estado: 'escrita_pedida' }, FALHOU)).toThrow(/passo oferta/);
  });
});
