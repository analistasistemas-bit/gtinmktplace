import { describe, expect, it } from 'vitest';
import {
  camposFiscaisFaltantes, validarCnpj, validarCoerenciaOrigem, UNIDADES_FISCAIS, CSOSN_VALIDOS, CST_ICMS_VALIDOS,
} from '../validar.ts';

const FCI_OK = '0A1B2C3D-0000-1111-2222-ABCDEF012345';
const base = {
  ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null,
  tributacao_icms: '102', tributacao_icms_regime: 'simples' as const,
  unidade: 'UN', origem: 'nacional' as const,
};

describe('coerência origem binária × origem_nfe (D-5, nunca derivação)', () => {
  it('nacional aceita 0/3/4/5/8 e recusa 1/2/6/7', () => {
    for (const ok of [0, 3, 4, 5, 8]) expect(validarCoerenciaOrigem('nacional', ok)).toBeNull();
    for (const nao of [1, 2, 6, 7]) expect(validarCoerenciaOrigem('nacional', nao)).toMatch(/incompatível/);
  });
  it('importado aceita 1/2/6/7 e recusa 0', () => {
    for (const ok of [1, 2, 6, 7]) expect(validarCoerenciaOrigem('importado', ok)).toBeNull();
    expect(validarCoerenciaOrigem('importado', 0)).toMatch(/incompatível/);
  });
});

describe('camposFiscaisFaltantes — LOUD nomeando o campo (D-7)', () => {
  it('família completa não tem faltas', () => {
    expect(camposFiscaisFaltantes(base, 'simples')).toEqual([]);
  });
  it('sem ncm, sem origem_nfe e sem csosn: três faltas nomeadas', () => {
    const faltas = camposFiscaisFaltantes(
      { ...base, ncm: null, origem_nfe: null, tributacao_icms: null }, 'simples');
    expect(faltas.join(' ')).toMatch(/ncm/);
    expect(faltas.join(' ')).toMatch(/origem_nfe/);
    expect(faltas.join(' ')).toMatch(/csosn/);
  });
  it('origem 3/5/8 exige FCI', () => {
    expect(camposFiscaisFaltantes({ ...base, origem_nfe: 3 }, 'simples').join(' ')).toMatch(/fci/);
  });
  it('regime da família ≠ regime da org exige recadastro (troca detectada, D-6)', () => {
    expect(camposFiscaisFaltantes(base, 'normal').join(' ')).toMatch(/recadastre/);
  });
  it('A4: CSOSN fora da lista sob simples (999, 00) é recusado nomeando os válidos', () => {
    for (const v of ['999', '00']) {
      expect(camposFiscaisFaltantes({ ...base, tributacao_icms: v }, 'simples').join(' '))
        .toMatch(new RegExp(`csosn ${v} inválido \\(use: 101, 102`));
    }
  });
  it('A4: CSOSN válido passa; CST válido sob simples também é recusado', () => {
    for (const v of CSOSN_VALIDOS) expect(camposFiscaisFaltantes({ ...base, tributacao_icms: v }, 'simples')).toEqual([]);
    expect(camposFiscaisFaltantes({ ...base, tributacao_icms: '60' }, 'simples').join(' ')).toMatch(/csosn 60 inválido/);
  });
  it('A4: sob normal, CST fora do domínio recusa; CST válido passa', () => {
    const n = { ...base, tributacao_icms_regime: 'normal' as const };
    expect(camposFiscaisFaltantes({ ...n, tributacao_icms: '999' }, 'normal').join(' ')).toMatch(/cst de ICMS 999 inválido/);
    for (const v of CST_ICMS_VALIDOS) expect(camposFiscaisFaltantes({ ...n, tributacao_icms: v }, 'normal')).toEqual([]);
  });
  it('A4: FCI fora do formato é recusada', () => {
    expect(camposFiscaisFaltantes({ ...base, origem_nfe: 3, fci: 'FCI123' }, 'simples').join(' ')).toMatch(/fci \(formato/);
  });
  it('A4: FCI preenchida com origem 0 é recusada (apague o campo)', () => {
    expect(camposFiscaisFaltantes({ ...base, fci: FCI_OK }, 'simples').join(' ')).toMatch(/fci só se aplica a origem_nfe 3, 5 ou 8/);
  });
  it('A4: FCI válida com origem 3 passa', () => {
    expect(camposFiscaisFaltantes({ ...base, origem_nfe: 3, fci: FCI_OK }, 'simples')).toEqual([]);
  });
  it('unidade fora do vocabulário controlado falha nomeando as opções', () => {
    const faltas = camposFiscaisFaltantes({ ...base, unidade: 'CAIXA GRANDE' }, 'simples');
    expect(faltas.join(' ')).toContain('UN');
  });
  it('ncm com 7 dígitos é inválido', () => {
    expect(camposFiscaisFaltantes({ ...base, ncm: '3926909' }, 'simples').join(' ')).toMatch(/ncm/);
  });
});

describe('validarCnpj (dígito verificador)', () => {
  it('aceita CNPJ válido com e sem máscara', () => {
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
  });
  it('recusa dígito errado e sequência repetida', () => {
    expect(validarCnpj('11222333000180')).toBe(false);
    expect(validarCnpj('00000000000000')).toBe(false);
  });
});

it('UNIDADES_FISCAIS contém as unidades em uso hoje', () => {
  expect(UNIDADES_FISCAIS).toContain('UN');
  expect(UNIDADES_FISCAIS).toContain('PAR');
});
