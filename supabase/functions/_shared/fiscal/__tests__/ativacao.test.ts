import { describe, expect, it } from 'vitest';
import { pendenciasAtivacaoFiscal, type EmpresaFiscalRow } from '../ativacao.ts';

const completa: EmpresaFiscalRow = {
  cnpj: '11222333000181', razao_social: 'DSA LTDA', nome_fantasia: null,
  inscricao_estadual: '123456', regime_tributario: 'simples',
  cep: '50000000', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro',
  municipio: 'Recife', municipio_ibge: '2611606', uf: 'PE',
  natureza_operacao: 'Venda de mercadoria', cfop_dentro_uf: '5102',
  cfop_fora_uf_nao_contribuinte: '6108', cfop_fora_uf_contribuinte: null,
  cst_pis: '49', cst_cofins: '49', origin_type: 'reseller',
  emissao_a_partir_de: '2026-10-01',
};

describe('pendenciasAtivacaoFiscal (spec §5.3 — lista tudo de uma vez)', () => {
  it('org PJ completa e UF coerente: zero pendências', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, 'PE')).toEqual([]);
  });
  it('org PF é pendência mesmo com empresa completa', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pf' }, completa, 'PE').join(' '))
      .toMatch(/pessoa jurídica/);
  });
  it('sem empresa_fiscal: pendência única dizendo o que falta', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, null, 'PE')[0]).toMatch(/empresa/i);
  });
  it('campos vazios são listados TODOS de uma vez, nomeados', () => {
    const p = pendenciasAtivacaoFiscal(
      { tipoPessoa: 'pj' }, { ...completa, cnpj: null, cep: null, cst_pis: null }, 'PE');
    expect(p.length).toBeGreaterThanOrEqual(3);
    expect(p.join(' ')).toMatch(/CNPJ/);
    expect(p.join(' ')).toMatch(/CEP/);
    expect(p.join(' ')).toMatch(/PIS/);
  });
  it('CNPJ com dígito errado é pendência própria', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, cnpj: '11222333000180' }, 'PE')
      .join(' ')).toMatch(/dígito/);
  });
  it('Regime Normal é recusado com mensagem de v2 (D-6)', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, regime_tributario: 'normal' }, 'PE')
      .join(' ')).toMatch(/Simples/);
  });
  it('UF divergente de configuracoes.uf_empresa nomeia AS DUAS (trava ADR-0112)', () => {
    const p = pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, 'SP').join(' ');
    expect(p).toContain('PE');
    expect(p).toContain('SP');
  });
  it('sem uf_empresa em configuracoes também é pendência', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, completa, null).join(' '))
      .toMatch(/ADR-0112|Configurações/);
  });
  it('sem emissao_a_partir_de é pendência (D-8)', () => {
    expect(pendenciasAtivacaoFiscal({ tipoPessoa: 'pj' }, { ...completa, emissao_a_partir_de: null }, 'PE')
      .join(' ')).toMatch(/início da emissão/);
  });
});
