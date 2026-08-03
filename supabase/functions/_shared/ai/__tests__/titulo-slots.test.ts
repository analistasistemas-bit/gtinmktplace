import { describe, it, expect } from 'vitest';
import { ORDEM_CORTE, ORDEM_LEITURA, SLOTS_VAZIOS } from '../titulo-slots';

describe('contrato de slots', () => {
  it('tem exatamente dez slots', () => {
    expect(Object.keys(SLOTS_VAZIOS)).toHaveLength(10);
  });

  it('todo slot começa vazio', () => {
    expect(Object.values(SLOTS_VAZIOS).every((v) => v === '')).toBe(true);
  });

  it('ordem de corte é o espelho exato da ordem de leitura', () => {
    expect([...ORDEM_CORTE]).toEqual([...ORDEM_LEITURA].reverse());
  });

  it('ordem de leitura começa em produto e termina em sinonimo', () => {
    expect(ORDEM_LEITURA[0]).toBe('produto');
    expect(ORDEM_LEITURA[ORDEM_LEITURA.length - 1]).toBe('sinonimo');
  });

  it('as duas ordens cobrem todos os slots, sem sobra nem falta', () => {
    expect([...ORDEM_LEITURA].sort()).toEqual(Object.keys(SLOTS_VAZIOS).sort());
    expect([...ORDEM_CORTE].sort()).toEqual(Object.keys(SLOTS_VAZIOS).sort());
  });
});
