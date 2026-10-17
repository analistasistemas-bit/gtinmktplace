import { describe, it, expect } from 'vitest';
import { validarCorpo } from '../validar.ts';

const id = '11111111-1111-4111-8111-111111111111';

describe('validarCorpo', () => {
  it('aceita hoje e foto', () => {
    expect(validarCorpo({ acao: 'hoje' }).ok).toBe(true);
    expect(validarCorpo({ acao: 'foto', data_base: '2025-12-31' }).ok).toBe(true);
  });
  it('recusa ação desconhecida e corpo não-objeto', () => {
    expect(validarCorpo({ acao: 'x' }).ok).toBe(false);
    expect(validarCorpo(null).ok).toBe(false);
  });
  it('recusa data_base fora de AAAA-12-31', () => {
    expect(validarCorpo({ acao: 'foto', data_base: '2025-11-30' }).ok).toBe(false);
    expect(validarCorpo({ acao: 'foto' }).ok).toBe(false);
  });
  it('recusa versao não inteira ou inventario_id inválido', () => {
    expect(validarCorpo({ acao: 'confirmar', inventario_id: id, versao: 1.5 }).ok).toBe(false);
    expect(validarCorpo({ acao: 'confirmar', inventario_id: id, versao: '1' }).ok).toBe(false);
    expect(validarCorpo({ acao: 'confirmar', inventario_id: 'x', versao: 1 }).ok).toBe(false);
    expect(validarCorpo({ acao: 'confirmar', inventario_id: id, versao: 1 }).ok).toBe(true);
  });
  it('recusa contagem negativa ou não inteira; aceita null', () => {
    const f = (q: unknown) =>
      validarCorpo({ acao: 'salvar', inventario_id: id, versao: 1, itens: [{ codigo: 'A', quantidade_contada: q }] }).ok;
    expect(f(-1)).toBe(false);
    expect(f(1.5)).toBe(false);
    expect(f('3')).toBe(false);
    expect(f(null)).toBe(true);
    expect(f(0)).toBe(true);
  });
});
