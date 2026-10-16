import { describe, expect, it } from 'vitest';
import { montarLinhasProduto, validarProdutoNovo, type ProdutoEntrada } from '../../_shared/produto/validar.ts';
import { validarFiscalDaEntrada, fiscalEfetivo } from '../processar.ts';

const entrada: ProdutoEntrada = {
  nomePai: 'Produto X', origem: 'nacional', unidade: 'UN',
  chaveCadastro: '00000000-0000-4000-8000-000000000001',
  variacoes: [{ preco: 10 }],
  fiscal: { ncm: '39269090', origemNfe: 0, tributacaoIcms: '102' },
};

describe('fiscal no cadastro manual (ADR-0135)', () => {
  it('org SEM módulo: fiscal ausente passa e nenhuma coluna fiscal é gravada', () => {
    const r = validarFiscalDaEntrada({ ...entrada, fiscal: undefined }, false, 'simples');
    expect(r).toEqual([]);
  });
  it('org COM módulo: fiscal ausente falha nomeando os campos', () => {
    const faltas = validarFiscalDaEntrada({ ...entrada, fiscal: undefined }, true, 'simples');
    expect(faltas.join(' ')).toMatch(/ncm/);
  });
  it('org COM módulo: incoerência origem × origem_nfe falha LOUD', () => {
    const faltas = validarFiscalDaEntrada(
      { ...entrada, fiscal: { ...entrada.fiscal!, origemNfe: 1 } }, true, 'simples');
    expect(faltas.join(' ')).toMatch(/incompatível/);
  });
  it('montarLinhasProduto grava colunas fiscais + regime da org', () => {
    const { familia } = montarLinhasProduto(entrada, {
      loteId: 'l', userId: 'u', orgId: 'o', codigoPai: '00100',
      codigos: ['00101'], chaveCadastro: entrada.chaveCadastro, regimeOrg: 'simples',
    });
    expect(familia.ncm).toBe('39269090');
    expect(familia.origem_nfe).toBe(0);
    expect(familia.tributacao_icms).toBe('102');
    expect(familia.tributacao_icms_regime).toBe('simples');
  });
  it('org SEM módulo: fiscal enviado no payload é descartado antes de gravar (comportamento intacto)', () => {
    expect(fiscalEfetivo(entrada, false)).toBeUndefined();
  });
  it('org COM módulo: fiscal enviado no payload passa adiante', () => {
    expect(fiscalEfetivo(entrada, true)).toBe(entrada.fiscal);
  });
  it('sem fiscal na entrada, montarLinhasProduto não inventa colunas', () => {
    const { familia } = montarLinhasProduto({ ...entrada, fiscal: undefined }, {
      loteId: 'l', userId: 'u', orgId: 'o', codigoPai: '00100',
      codigos: ['00101'], chaveCadastro: entrada.chaveCadastro,
    });
    expect(familia.ncm).toBeUndefined();
  });

  // ADR-0181 D-5: descrição fiscal = texto que sai na nota de venda do Faturador do ML.
  const ctx = {
    loteId: 'l', userId: 'u', orgId: 'o', codigoPai: '00100',
    codigos: ['00101'], chaveCadastro: entrada.chaveCadastro, regimeOrg: 'simples' as const,
  };
  it('montarLinhasProduto grava descricao_fiscal com trim; vazia ou ausente vira null', () => {
    const com = (d: string | null | undefined) =>
      montarLinhasProduto({ ...entrada, fiscal: { ...entrada.fiscal!, descricaoFiscal: d } }, ctx).familia.descricao_fiscal;
    expect(com(' Short masculino ')).toBe('Short masculino');
    expect(com('   ')).toBeNull();
    expect(com(null)).toBeNull();
    expect(com(undefined)).toBeNull();
    expect(montarLinhasProduto({ ...entrada, fiscal: undefined }, ctx).familia).not.toHaveProperty('descricao_fiscal');
  });
  it('validarProdutoNovo recusa descrição fiscal > 120 após trim e tipo não-string', () => {
    const v = (d: unknown) => validarProdutoNovo({ ...entrada, fiscal: { ...entrada.fiscal!, descricaoFiscal: d as string } });
    expect(v(`  ${'x'.repeat(120)}  `)).toEqual([]);
    expect(v('x'.repeat(121)).map((e) => e.campo)).toContain('fiscal.descricaoFiscal');
    expect(v(5).map((e) => e.campo)).toContain('fiscal.descricaoFiscal');
  });
});
