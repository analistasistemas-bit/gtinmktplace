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
  it('forbidden no sub_status vira moderado mesmo já inactive+deleted', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'inactive', sub_status: ['forbidden', 'deleted'], available_quantity: 0, price: 5 });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toContain('forbidden');
  });
  it('poor_quality_thumbnail conta como moderado', () => {
    const r = parseStatusML({ id: 'MLB1', status: 'inactive', sub_status: ['poor_quality_thumbnail'] });
    expect(r.status).toBe('moderado');
  });
  it('paused → pausado; closed → encerrado; inactive sem moderação → inativo', () => {
    expect(parseStatusML({ id: 'x', status: 'paused' }).status).toBe('pausado');
    expect(parseStatusML({ id: 'x', status: 'closed' }).status).toBe('encerrado');
    expect(parseStatusML({ id: 'x', status: 'inactive' }).status).toBe('inativo');
    expect(parseStatusML({ id: 'x', status: 'inactive', sub_status: ['out_of_stock'] }).status).toBe('inativo');
  });
  it('null/erro → indisponivel', () => {
    expect(parseStatusML(null).status).toBe('indisponivel');
  });
});
