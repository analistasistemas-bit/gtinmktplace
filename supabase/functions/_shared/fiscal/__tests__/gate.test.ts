import { describe, expect, it } from 'vitest';
import { exigirFiscalCompletoSePreciso } from '../gate.ts';

function adminFake(modulos: string[], regime: string | null) {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => tabela === 'organizations'
            ? { data: { modulos_habilitados: modulos } }
            : { data: regime ? { regime_tributario: regime } : null },
        }),
      }),
    }),
  } as never;
}

const completa = {
  id: 'f1', org_id: 'o1', nome_pai: 'X', unidade: 'UN', origem: 'nacional' as const,
  ncm: '39269090', cest: null, origem_nfe: 0, fci: null, ex_tipi: null,
  tributacao_icms: '102', tributacao_icms_regime: 'simples',
};

describe('exigirFiscalCompletoSePreciso (ADR-0135 D-7)', () => {
  it('org sem módulo: no-op, retorna false', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['estoque'], null), { ...completa, ncm: null }))
      .resolves.toBe(false);
  });
  it('org com módulo e família completa: retorna true', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples'), completa))
      .resolves.toBe(true);
  });
  it('org com módulo e família sem ncm: lança nomeando o campo e a família', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples'), { ...completa, ncm: null }))
      .rejects.toThrow(/ncm/);
  });
  it('regime da família diverge do da org: lança pedindo recadastro', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'normal'), completa))
      .rejects.toThrow(/recadastre/);
  });
});
