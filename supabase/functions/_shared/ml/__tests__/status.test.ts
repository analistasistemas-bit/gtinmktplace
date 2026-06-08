import { describe, it, expect } from 'vitest';
import { parseStatusML } from '../status';

describe('parseStatusML', () => {
  it('active → ativo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'active', available_quantity: 10, price: 12.9 });
    expect(r).toMatchObject({ status: 'ativo', estoque: 10, preco: 12.9, motivo: null });
  });
  it('under_review com sub_status vira moderado + motivo', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'under_review', sub_status: ['waiting_for_patch'], available_quantity: 0, price: 5 });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('waiting_for_patch');
  });
  it('paused → pausado; closed → encerrado; inactive → inativo', () => {
    expect(parseStatusML({ id: 'x', status: 'paused' }).status).toBe('pausado');
    expect(parseStatusML({ id: 'x', status: 'closed' }).status).toBe('encerrado');
    expect(parseStatusML({ id: 'x', status: 'inactive' }).status).toBe('inativo');
  });
  it('null/erro → indisponivel', () => {
    expect(parseStatusML(null).status).toBe('indisponivel');
  });
});
