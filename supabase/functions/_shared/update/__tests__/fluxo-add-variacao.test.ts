import { describe, it, expect } from 'vitest';
import { ehFluxoAddVariacao } from '../fluxo-add-variacao';

function admin(resposta: { data: unknown; error: { message: string } | null }) {
  const api = { select: () => api, eq: () => api, maybeSingle: async () => resposta };
  return { from: () => api } as never;
}

describe('ehFluxoAddVariacao', () => {
  it('lote manual → true', async () => {
    expect(await ehFluxoAddVariacao(admin({ data: { origem: 'manual' }, error: null }), 'l1')).toBe(true);
  });

  it('lote de planilha → false', async () => {
    expect(await ehFluxoAddVariacao(admin({ data: { origem: 'planilha' }, error: null }), 'l1')).toBe(false);
  });

  it('erro lendo o lote → lança (nunca vira false, que reprecificaria as irmãs)', async () => {
    await expect(ehFluxoAddVariacao(admin({ data: null, error: { message: 'timeout' } }), 'l1'))
      .rejects.toThrow(/lote l1.*timeout/);
  });

  it('lote ausente → lança', async () => {
    await expect(ehFluxoAddVariacao(admin({ data: null, error: null }), 'l1')).rejects.toThrow(/lote l1 não encontrado/);
  });
});
