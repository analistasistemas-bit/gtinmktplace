import { describe, expect, it } from 'vitest';
import { exigirFiscalCompletoSePreciso } from '../gate.ts';

// ADR-0187: ncm_consultar — 'vigente' (default), 'vencido', 'inexistente' (sem linha) ou 'erro'.
type Ncm = 'vigente' | 'vencido' | 'inexistente' | 'erro';
function rpcNcm(ncm: Ncm) {
  return async (_fn: string, args: { p_codigos: string[] }) => ncm === 'erro'
    ? { data: null, error: { message: 'fora do ar' } }
    : { data: ncm === 'inexistente' ? [] : args.p_codigos.map((codigo) => ({ codigo, vigente: ncm === 'vigente' })), error: null };
}

function adminFake(modulos: string[], regime: string | null, ncm: Ncm = 'vigente') {
  return {
    rpc: rpcNcm(ncm),
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => tabela === 'organizations'
            ? { data: { modulos_habilitados: modulos }, error: null }
            : { data: regime ? { regime_tributario: regime } : null },
        }),
      }),
    }),
  } as never;
}

function adminFakeErroEmpresa() {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => tabela === 'organizations'
            ? { data: { modulos_habilitados: ['fiscal'] }, error: null }
            : { data: null, error: { message: 'timeout' } },
        }),
      }),
    }),
  } as never;
}

function adminFakeErroOrganizations() {
  return {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => tabela === 'organizations'
            ? { data: null, error: { message: 'timeout' } }
            : { data: null },
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
  it('A3: erro lendo empresa_fiscal → lança SEM status (retenta), nunca vira "simples"', async () => {
    const e = await exigirFiscalCompletoSePreciso(adminFakeErroEmpresa(), completa).catch((x) => x);
    expect(e.message).toMatch(/empresa_fiscal: timeout/);
    expect(e.status).toBeUndefined();
  });
  it('A3: módulo fiscal sem empresa_fiscal → 400 nomeando o cadastro da empresa', async () => {
    const p = exigirFiscalCompletoSePreciso(adminFake(['fiscal'], null), completa);
    await expect(p).rejects.toMatchObject({ status: 400 });
    await expect(p).rejects.toThrow(/cadastro da empresa fiscal/);
  });
  it('A3: regime normal → 400 no gate, antes de qualquer escrita', async () => {
    const p = exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'normal'), completa);
    await expect(p).rejects.toMatchObject({ status: 400 });
    await expect(p).rejects.toThrow(/só Simples Nacional/);
  });
  it('erro lançado é definitivo (status 400) — não pode ser retentado pelo QStash', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples'), { ...completa, ncm: null }))
      .rejects.toMatchObject({ status: 400 });
  });
  it('erro de LEITURA do módulo (organizations) lança — nunca vira "sem módulo" (fail-open)', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFakeErroOrganizations(), completa))
      .rejects.toThrow(/organizations/);
  });

  it('ADR-0187: NCM vencido → lança definitivo (status 400) com a copy e o nome da família', async () => {
    const p = exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples', 'vencido'), completa);
    await expect(p).rejects.toMatchObject({ status: 400 });
    await expect(p).rejects.toThrow(/NCM 39269090 não está mais vigente.*"X"/);
  });
  it('ADR-0187: NCM inexistente → lança definitivo com a copy', async () => {
    const p = exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples', 'inexistente'), completa);
    await expect(p).rejects.toMatchObject({ status: 400 });
    await expect(p).rejects.toThrow(/NCM 39269090 não existe na tabela oficial/);
  });
  it('ADR-0187: erro lendo ncm_consultar → lança SEM status (transitório, QStash retenta)', async () => {
    const e = await exigirFiscalCompletoSePreciso(adminFake(['fiscal'], 'simples', 'erro'), completa)
      .catch((x: unknown) => x as Error & { status?: number });
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/ncm_consultar/);
    expect((e as { status?: number }).status).toBeUndefined();
  });
  it('ADR-0187: org sem módulo fiscal não consulta o NCM', async () => {
    await expect(exigirFiscalCompletoSePreciso(adminFake(['estoque'], null, 'erro'), completa))
      .resolves.toBe(false);
  });
});
