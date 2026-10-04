import { describe, expect, it } from 'vitest';
import { decidirReajuste, type Vivo } from '../decidir.ts';

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
