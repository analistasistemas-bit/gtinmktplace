import { describe, it, expect } from 'vitest';
import { MOCK_FAMILIAS } from '@/lib/mocks/familias';

describe('MOCK_FAMILIAS (Lote #42)', () => {
  const familiasLote42 = MOCK_FAMILIAS.filter((f) => f.loteId === 'lote-42');

  it('tem 50 famílias no lote-42', () => {
    expect(familiasLote42.length).toBe(50);
  });

  it('tem mistura CREATE/UPDATE (38 CREATE + 12 UPDATE)', () => {
    const creates = familiasLote42.filter((f) => f.operacao === 'CREATE');
    const updates = familiasLote42.filter((f) => f.operacao === 'UPDATE');
    expect(creates.length).toBe(38);
    expect(updates.length).toBe(12);
  });

  it('tem ao menos 3 famílias com precoAbaixo20pc=true (alerta)', () => {
    const alertas = familiasLote42.filter((f) => f.precoAbaixo20pc);
    expect(alertas.length).toBeGreaterThanOrEqual(3);
  });

  it('tem todas as 3 categorias de concorrência presentes', () => {
    const concs = new Set(familiasLote42.map((f) => f.concorrencia));
    expect(concs).toContain('sem');
    expect(concs).toContain('moderada');
    expect(concs).toContain('alta');
  });

  it('cada família tem ao menos 1 variação', () => {
    expect(familiasLote42.every((f) => f.variacoes.length >= 1)).toBe(true);
  });

  it('IDs de família são únicos', () => {
    const ids = MOCK_FAMILIAS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
