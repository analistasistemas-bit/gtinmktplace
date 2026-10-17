// ADR-0181 D-5: serializador do cadastro — a descrição fiscal viaja dentro de `fiscal`.
import { describe, expect, it, vi } from 'vitest';
import { montarPayload } from '../use-cadastro-produto';
import { novaLinha } from '../linha-variacao-form';
import { fiscalVazio } from '../etapa-fiscal-form';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() } } }));

const PAI = {
  nomePai: 'Short', descricaoPai: '', unidade: 'UN', fornecedor: '',
  origem: 'nacional' as const, genero: null,
};
const fiscal = (descricaoFiscal: string) => ({
  ...fiscalVazio(), ncm: '62034900', origemNfe: '0', tributacaoIcms: '102', descricaoFiscal,
});
const linha = { ...novaLinha(), preco: '10' };

describe('montarPayload — descrição fiscal', () => {
  it('sai com trim dentro de fiscal', () => {
    expect(montarPayload(PAI, [linha], 'k', fiscal('  Short masculino ')).fiscal?.descricaoFiscal)
      .toBe('Short masculino');
  });
  it('vazia (ou só espaço) sai null', () => {
    expect(montarPayload(PAI, [linha], 'k', fiscal('   ')).fiscal?.descricaoFiscal).toBeNull();
  });
  it('sem módulo fiscal, nenhum bloco fiscal', () => {
    expect(montarPayload(PAI, [linha], 'k')).not.toHaveProperty('fiscal');
  });
});

describe('montarPayload — grade', () => {
  it('envia gradeTamanho', () => {
    expect(montarPayload({ ...PAI, gradeTamanho: 'calca' }, [linha], 'k').gradeTamanho).toBe('calca');
  });
  it('aceita gênero infantil', () => {
    expect(montarPayload({ ...PAI, genero: 'meninas', gradeTamanho: 'infantil' }, [linha], 'k').genero).toBe('meninas');
  });
});

describe('montarPayload — refNota', () => {
  it('com refNota sai no payload; sem, sem a chave', () => {
    const ref = `nfe:${'1'.repeat(44)}:3`;
    expect(montarPayload(PAI, [linha], 'k', undefined, true, ref).refNota).toBe(ref);
    expect(montarPayload(PAI, [linha], 'k', undefined, true)).not.toHaveProperty('refNota');
  });
});

// ADR-0181 (emenda 2026-10-17): quantidade da nota vira sugestão, nunca estoque inicial.
describe('montarPayload — quantidadeNota', () => {
  const ref = `nfe:${'1'.repeat(44)}:3`;
  const l5 = { ...linha, estoqueInicial: '5' };
  it('origemNota + refNota + fator: cada variação leva quantidadeNota (vazio = 0) e a entrada leva fatorNota', () => {
    const p = montarPayload(PAI, [l5, linha], 'k', undefined, true, ref, 12);
    expect(p.fatorNota).toBe(12);
    expect(p.variacoes.map((v) => v.quantidadeNota)).toEqual([5, 0]);
    expect(p.variacoes[0]).not.toHaveProperty('estoqueInicial');
  });
  it('sem fator (cadastro simples), sem refNota válida ou sem origemNota: nenhum campo novo', () => {
    for (const p of [
      montarPayload(PAI, [l5], 'k', undefined, true, ref),
      montarPayload(PAI, [l5], 'k', undefined, true, 'nfe:123:3', 12),
      montarPayload(PAI, [l5], 'k', undefined, true, undefined, 12),
    ]) {
      expect(p).not.toHaveProperty('fatorNota');
      expect(p.variacoes[0]).not.toHaveProperty('quantidadeNota');
      expect(p.variacoes[0]).not.toHaveProperty('estoqueInicial');
    }
    const normal = montarPayload(PAI, [l5], 'k', undefined, false, undefined, 12);
    expect(normal).not.toHaveProperty('fatorNota');
    expect(normal.variacoes[0]).toMatchObject({ estoqueInicial: 5 });
    expect(normal.variacoes[0]).not.toHaveProperty('quantidadeNota');
  });
});
