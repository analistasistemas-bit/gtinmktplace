import { describe, it, expect, vi } from 'vitest';
import { MODULOS_VALIDOS, recusaDesligarKitVariacao } from '../modulos-org.ts';
import { MODULOS } from '../../../../src/lib/modulos';

describe('MODULOS_VALIDOS', () => {
  it('fica em sincronia com o registry do frontend', () => {
    expect([...MODULOS_VALIDOS].sort()).toEqual(MODULOS.map((m) => m.id).sort());
  });
  it('tem kit_variacao e imagem_ia (ADR-0197)', () => {
    expect(MODULOS_VALIDOS).toEqual(expect.arrayContaining(['kit_variacao', 'imagem_ia']));
  });
});

describe('recusaDesligarKitVariacao (ADR-0197)', () => {
  it('módulo mantido: não consulta o banco', async () => {
    const consultar = vi.fn();
    expect(await recusaDesligarKitVariacao(['kit_variacao'], consultar)).toBeNull();
    expect(consultar).not.toHaveBeenCalled();
  });
  it('sem kit ativo: libera', async () => {
    const consultar = vi.fn().mockResolvedValue({ data: null, error: null });
    expect(await recusaDesligarKitVariacao(['estoque'], consultar)).toBeNull();
  });
  it('kit com saldo ou transferência aberta: 409 com o motivo do banco', async () => {
    const consultar = vi.fn().mockResolvedValue({ data: 'Há kit com saldo.', error: null });
    expect(await recusaDesligarKitVariacao([], consultar)).toEqual({
      status: 409, body: { error: 'Há kit com saldo.' },
    });
  });
  it('falha na consulta: recusa, nunca desliga no escuro', async () => {
    const consultar = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const r = await recusaDesligarKitVariacao([], consultar);
    expect(r?.status).toBe(500);
    expect(r?.body.error).toContain('timeout');
  });
});
