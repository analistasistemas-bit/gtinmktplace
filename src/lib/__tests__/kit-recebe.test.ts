import { describe, expect, it } from 'vitest';
import { simularRecebe } from '../kit-recebe';
import type { Tarifa } from '../tarifa';

/** Tarifa como `calcularTarifaML` devolve: recebe já líquido de comissão, frete e imposto. */
function tarifa(preco: number, frete: number, imposto = 0, proveniencia: Tarifa['proveniencia'] = 'official'): Tarifa {
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - frete - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete, proveniencia };
}

// recebe = 100 − 12 − 10 − 8 = 70
const base = { preco: 100, precoEmDia: true, custo: 50, tipo: 'gold_special' as const, aliquotaPct: 8 as number | null, tarifa: tarifa(100, 10, 8) as Tarifa | null | undefined };

describe('simularRecebe', () => {
  it('ok com lucro positivo', () => {
    const s = simularRecebe(base);
    expect(s.estado).toBe('ok');
    expect(s.resumo?.recebe).toBe(70);
    expect(s.resumo?.lucro).toBeCloseTo(20);
    expect(s.resumo?.aliquotaPct).toBe(8);
    expect(s.semAliquota).toBe(false);
    expect(s.precisaConfirmar).toBe(false);
  });
  it('prejuízo exige confirmação', () => {
    const s = simularRecebe({ ...base, custo: 80 });
    expect(s.estado).toBe('prejuizo');
    expect(s.resumo!.lucro).toBeLessThan(0);
    expect(s.precisaConfirmar).toBe(true);
  });
  it('sem alíquota: ok mas exige confirmação', () => {
    const s = simularRecebe({ ...base, aliquotaPct: null });
    expect(s.estado).toBe('ok');
    expect(s.semAliquota).toBe(true);
    expect(s.precisaConfirmar).toBe(true);
  });
  it('preço desatualizado ou tarifa ainda chegando → calculando, sem resumo', () => {
    for (const p of [{ ...base, precoEmDia: false }, { ...base, tarifa: undefined }]) {
      const s = simularRecebe(p);
      expect(s.estado).toBe('calculando');
      expect(s.resumo).toBeNull();
      expect(s.precisaConfirmar).toBe(false);
    }
  });
  it('tarifa null ou não oficial → indisponível, exige confirmação', () => {
    for (const t of [null, tarifa(100, 10, 8, 'estimated')]) {
      const s = simularRecebe({ ...base, tarifa: t });
      expect(s.estado).toBe('indisponivel');
      expect(s.resumo).toBeNull();
      expect(s.precisaConfirmar).toBe(true);
    }
  });
  it('custo null → sem_custo, sem resumo, sem confirmação (mesmo sem alíquota)', () => {
    const s = simularRecebe({ ...base, custo: null, aliquotaPct: null });
    expect(s.estado).toBe('sem_custo');
    expect(s.resumo).toBeNull();
    expect(s.precisaConfirmar).toBe(false);
  });
  it('preço 0 → sem_preco', () => {
    const s = simularRecebe({ ...base, preco: 0 });
    expect(s.estado).toBe('sem_preco');
    expect(s.resumo).toBeNull();
    expect(s.precisaConfirmar).toBe(false);
  });
});
