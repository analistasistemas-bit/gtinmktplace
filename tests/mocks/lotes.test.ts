import { describe, it, expect } from 'vitest';
import { MOCK_LOTES } from '@/lib/mocks/lotes';

describe('MOCK_LOTES', () => {
  it('tem ao menos 6 lotes', () => {
    expect(MOCK_LOTES.length).toBeGreaterThanOrEqual(6);
  });

  it('cobre todos os estados de LoteStatus', () => {
    const statuses = new Set(MOCK_LOTES.map((l) => l.status));
    expect(statuses).toContain('revisao');
    expect(statuses).toContain('concluido');
    expect(statuses).toContain('publicando');
    expect(statuses).toContain('erro');
    expect(statuses).toContain('processando');
  });

  it('tem ao menos um lote em revisao (alvo principal da tela Revisão)', () => {
    expect(MOCK_LOTES.filter((l) => l.status === 'revisao').length).toBeGreaterThanOrEqual(1);
  });

  it('IDs são únicos', () => {
    const ids = MOCK_LOTES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
