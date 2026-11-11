import { describe, it, expect, vi } from 'vitest';
import { freteComRetentativa } from '../retentativa';

const ok = { valor: 8.15, proveniencia: 'official' as const };
const r429 = { valor: 0, proveniencia: 'estimated' as const, motivo: 'o Mercado Livre recusou o cálculo de frete (HTTP 429)' };
const r503 = { valor: 0, proveniencia: 'estimated' as const, motivo: 'o Mercado Livre recusou o cálculo de frete (HTTP 503)' };
const rede = { valor: 0, proveniencia: 'estimated' as const, motivo: 'o Mercado Livre não respondeu o frete (fetch failed)' };
const r400 = { valor: 0, proveniencia: 'estimated' as const, motivo: 'o Mercado Livre recusou o cálculo de frete (HTTP 400)' };
const semCobertura = { valor: 0, proveniencia: 'estimated' as const, motivo: 'o Mercado Livre respondeu sem cobertura de frete para este item' };
const dormir = () => Promise.resolve();

describe('freteComRetentativa', () => {
  it('429 seguido de sucesso devolve o frete oficial', async () => {
    const buscar = vi.fn().mockResolvedValueOnce(r429).mockResolvedValueOnce(ok);
    expect(await freteComRetentativa(buscar, [1, 1], dormir)).toEqual(ok);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('5xx e falha de rede também são retentados', async () => {
    const buscar = vi.fn().mockResolvedValueOnce(r503).mockResolvedValueOnce(rede).mockResolvedValueOnce(ok);
    expect(await freteComRetentativa(buscar, [1, 1], dormir)).toEqual(ok);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it('esgotadas as esperas devolve a última resposta (estimated), sem lançar', async () => {
    const buscar = vi.fn().mockResolvedValue(r429);
    expect(await freteComRetentativa(buscar, [1, 1], dormir)).toEqual(r429);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it('erro não transitório (400, sem cobertura) não é retentado', async () => {
    for (const resp of [r400, semCobertura]) {
      const buscar = vi.fn().mockResolvedValue(resp);
      expect(await freteComRetentativa(buscar, [1, 1], dormir)).toEqual(resp);
      expect(buscar).toHaveBeenCalledTimes(1);
    }
  });

  it('sucesso de primeira não espera', async () => {
    const espera = vi.fn(dormir);
    const buscar = vi.fn().mockResolvedValue(ok);
    await freteComRetentativa(buscar, [1, 1], espera);
    expect(espera).not.toHaveBeenCalled();
  });
});
