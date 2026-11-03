import { describe, expect, it } from 'vitest';
import { validatePaymentProfile, validateTerms } from '../validation.ts';

const ORG = '90000000-0000-0000-0000-000000000001';
const valid = {
  org_id: ORG,
  starts_on: '2026-10-01',
  modality: 2,
  monthly_fee_cents: 0,
  revenue_bps_t1: 700,
  revenue_bps_t2: 600,
  revenue_bps_t3: 550,
  revenue_bps_t4: 500,
  sonar_unit_cents: 120,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'Negociação outubro',
};

describe('validateTerms', () => {
  it('preserva valores zero e a infraestrutura da modalidade 2', () => {
    expect(validateTerms(valid)).toMatchObject({
      monthly_fee_cents: 0,
      sonar_unit_cents: 120,
      setup_fee_cents: 0,
      modality: 2,
    });
  });

  it('rejeita percentual negativo em qualquer faixa', () => {
    expect(() => validateTerms({ ...valid, revenue_bps_t1: -1 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps_t4: -1 })).toThrow();
  });

  it('rejeita vigência que não começa no primeiro dia do mês', () => {
    expect(() => validateTerms({ ...valid, starts_on: '2026-10-15' })).toThrow();
  });

  it('rejeita centavos decimais, ausentes ou fora do inteiro seguro', () => {
    expect(() => validateTerms({ ...valid, monthly_fee_cents: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, sonar_unit_cents: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => validateTerms({ ...valid, setup_fee_cents: undefined })).toThrow();
  });

  it('rejeita modalidade e percentual decimais', () => {
    expect(() => validateTerms({ ...valid, modality: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps_t1: 0.5 })).toThrow();
  });

  it('rejeita modalidade 1 cobrando Sonar do cliente', () => {
    expect(() => validateTerms({ ...valid, modality: 1, monthly_fee_cents: 60000, sonar_unit_cents: 120 }))
      .toThrow('Modalidade 1 não cobra Sonar do cliente');
  });

  it('rejeita modalidade 2 com infraestrutura separada', () => {
    expect(() => validateTerms({ ...valid, modality: 2, monthly_fee_cents: 60000 }))
      .toThrow('Modalidade 2 não tem infraestrutura separada');
  });

  it('exige competência mensal válida para implantação cobrada', () => {
    expect(() => validateTerms({ ...valid, setup_fee_cents: 1, setup_due_month: null })).toThrow();
    expect(() => validateTerms({ ...valid, setup_fee_cents: 1, setup_due_month: '2026-13' })).toThrow();
  });

  it('rejeita tipo inválido antes da checagem de modalidade', () => {
    expect(() => validateTerms({ ...valid, modality: 1, monthly_fee_cents: 60000, sonar_unit_cents: '0' }))
      .toThrow('sonar_unit_cents deve ser um inteiro não negativo');
  });
});

describe('validateTerms — vencimento (ADR-0193 D-9)', () => {
  it('ausente vira dia 05 e informado é preservado', () => {
    expect(validateTerms(valid).due_day).toBe(5);
    expect(validateTerms({ ...valid, due_day: 28 }).due_day).toBe(28);
  });
  it.each([0, 29, 5.5, '10', null])('rejeita due_day %s', (dueDay) => {
    expect(() => validateTerms({ ...valid, due_day: dueDay })).toThrow('due_day');
  });
});

describe('validatePaymentProfile', () => {
  const perfil = { beneficiary_name: 'Daludi Comércio', document: '111.444.777-35', bank_name: 'Banco', branch: '0001', account: '12345-6', pix_key_type: 'cpf', pix_key: '111.444.777-35', city: 'São Paulo' };

  it('aceita CPF/CNPJ válidos e normaliza documento e chave', () => {
    expect(validatePaymentProfile(perfil)).toMatchObject({ document: '11144477735', pix_key: '11144477735', city: 'São Paulo' });
    expect(validatePaymentProfile({ ...perfil, document: '11.222.333/0001-81', pix_key_type: 'cnpj', pix_key: '11.222.333/0001-81' }))
      .toMatchObject({ document: '11222333000181', pix_key: '11222333000181' });
  });

  it('rejeita documento com dígito verificador errado ou repetido', () => {
    expect(() => validatePaymentProfile({ ...perfil, document: '11144477734' })).toThrow('document');
    expect(() => validatePaymentProfile({ ...perfil, document: '11111111111' })).toThrow('document');
    expect(() => validatePaymentProfile({ ...perfil, document: '11222333000180' })).toThrow('document');
  });

  it('exige chave Pix coerente com o tipo', () => {
    expect(() => validatePaymentProfile({ ...perfil, pix_key_type: 'cnpj' })).toThrow('CNPJ');
    expect(() => validatePaymentProfile({ ...perfil, pix_key_type: 'email', pix_key: 'sem-arroba' })).toThrow('e-mail');
    expect(() => validatePaymentProfile({ ...perfil, pix_key_type: 'random', pix_key: 'abc' })).toThrow('UUID');
    expect(() => validatePaymentProfile({ ...perfil, pix_key_type: 'boleto' })).toThrow('pix_key_type');
    expect(validatePaymentProfile({ ...perfil, pix_key_type: 'email', pix_key: ' Financeiro@Daludi.com.br ' }).pix_key).toBe('financeiro@daludi.com.br');
    expect(validatePaymentProfile({ ...perfil, pix_key_type: 'phone', pix_key: '(85) 99999-8888' }).pix_key).toBe('+5585999998888');
    expect(validatePaymentProfile({ ...perfil, pix_key_type: 'phone', pix_key: '+55 85 99999-8888' }).pix_key).toBe('+5585999998888');
    expect(() => validatePaymentProfile({ ...perfil, pix_key_type: 'phone', pix_key: '9999' })).toThrow('celular');
    expect(validatePaymentProfile({ ...perfil, pix_key_type: 'random', pix_key: '123E4567-E89B-12D3-A456-426614174000' }).pix_key)
      .toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('aplica os limites do BR Code depois de remover acentos (nome ≤ 25, cidade ≤ 15)', () => {
    expect(() => validatePaymentProfile({ ...perfil, beneficiary_name: 'A'.repeat(26) })).toThrow('25');
    expect(validatePaymentProfile({ ...perfil, beneficiary_name: 'Ç'.repeat(25) }).beneficiary_name).toBe('Ç'.repeat(25));
    expect(() => validatePaymentProfile({ ...perfil, city: 'Cidade Comprida X' })).toThrow('15');
    expect(() => validatePaymentProfile({ ...perfil, bank_name: '  ' })).toThrow('bank_name');
  });
});
