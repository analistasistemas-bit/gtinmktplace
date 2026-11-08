import { describe, it, expect, vi } from 'vitest';
import { MODULOS_VALIDOS, gravarModulosOrg } from '../modulos-org.ts';
import { MODULOS } from '../../../../src/lib/modulos';

describe('MODULOS_VALIDOS', () => {
  it('fica em sincronia com o registry do frontend', () => {
    expect([...MODULOS_VALIDOS].sort()).toEqual(MODULOS.map((m) => m.id).sort());
  });
  it('tem kit_variacao e imagem_ia (ADR-0199)', () => {
    expect(MODULOS_VALIDOS).toEqual(expect.arrayContaining(['kit_variacao', 'imagem_ia']));
  });
});

describe('gravarModulosOrg (ADR-0199)', () => {
  it('gravou: 200', async () => {
    const chamar = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    expect(await gravarModulosOrg(chamar)).toEqual({ status: 200, body: { ok: true } });
  });
  it('kit com saldo ou transferência aberta: 409 com o motivo do banco', async () => {
    const chamar = vi.fn().mockResolvedValue({ data: { ok: false, motivo: 'Há kit com saldo.' }, error: null });
    expect(await gravarModulosOrg(chamar)).toEqual({ status: 409, body: { error: 'Há kit com saldo.' } });
  });
  it('erro do banco: 400 com a mensagem, como o update direto fazia', async () => {
    const chamar = vi.fn().mockResolvedValue({ data: null, error: { message: 'fiscal_exige_pj' } });
    expect(await gravarModulosOrg(chamar)).toEqual({ status: 400, body: { error: 'fiscal_exige_pj' } });
  });
});
