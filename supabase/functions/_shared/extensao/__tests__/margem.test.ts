import { describe, expect, it } from 'vitest';
import { calcularMinhaMargem, custoDoPacote, fatorDoPacote } from '../margem.ts';
import type { Disponivel, EntradaMargem, MargemTipo } from '../tipos.ts';

function entrada(over: Partial<EntradaMargem> = {}): EntradaMargem {
  return {
    preco: 213.19,
    aliquotaPct: { estado: 'ok', valor: 7 },
    custoPacote: { estado: 'ok', valor: 80 },
    classico: { comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0 } }, frete: { estado: 'ok', valor: 25.45 } },
    premium: { comissao: { estado: 'ok', valor: { percentual: 17, fixa: 0 } }, frete: { estado: 'ok', valor: 25.45 } },
    ...over,
  };
}

function ok(d: Disponivel<MargemTipo>): MargemTipo {
  if (d.estado !== 'ok') throw new Error(`esperava ok, veio indisponível: ${d.motivo}`);
  return d.valor;
}

describe('calcularMinhaMargem', () => {
  it('Clássico: caso validado no Chrome (R$ 213,19)', () => {
    const r = calcularMinhaMargem(entrada());
    expect(r.preco).toBe(213.19);
    expect(ok(r.classico)).toEqual({
      comissao: 25.58, imposto: 14.92, frete: 25.45, recebe: 147.24, custo: 80, lucro: 67.24, margemPct: 31.54, avisos: [],
    });
  });

  it('Premium 17% no mesmo cenário', () => {
    const p = ok(calcularMinhaMargem(entrada()).premium);
    expect(p.comissao).toBe(36.24);
    expect(p.recebe).toBe(136.58);
  });

  it('usa saleFeeAmount quando o preço é o consultado; senão o percentual', () => {
    const frete = { estado: 'ok' as const, valor: 25.45 };
    const e = entrada({
      classico: { comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0, saleFeeAmount: 25.58, precoConsultado: 213.19 } }, frete },
    });
    expect(ok(calcularMinhaMargem(e).classico).comissao).toBe(25.58);
    // valor distinto do percentual prova que saleFeeAmount é a fonte
    const e2 = entrada({
      classico: { comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0, saleFeeAmount: 30, precoConsultado: 213.19 } }, frete },
    });
    expect(ok(calcularMinhaMargem(e2).classico).comissao).toBe(30);
    expect(ok(calcularMinhaMargem({ ...e2, preco: 199 }).classico).comissao).toBe(23.88);
  });

  it('saleFeeAmount null/NaN no preço consultado → percentual, nunca comissão zero', () => {
    const frete = { estado: 'ok' as const, valor: 25.45 };
    for (const saleFeeAmount of [null, NaN, undefined]) {
      const e = entrada({
        classico: { comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0, saleFeeAmount: saleFeeAmount as unknown as number, precoConsultado: 213.19 } }, frete },
      });
      expect(ok(calcularMinhaMargem(e).classico).comissao).toBe(25.58);
    }
  });

  it('custoPacote null → recebe calculado, custo/lucro/margemPct null', () => {
    const c = ok(calcularMinhaMargem(entrada({ custoPacote: null })).classico);
    expect(c.recebe).toBe(147.24);
    expect(c.custo).toBeNull();
    expect(c.lucro).toBeNull();
    expect(c.margemPct).toBeNull();
    expect(c.avisos).toEqual([]);
  });

  it('custoPacote indisponível → custo/lucro/margemPct null e motivo em avisos', () => {
    const r = calcularMinhaMargem(entrada({ custoPacote: { estado: 'indisponivel', motivo: 'composição diferente' } }));
    const c = ok(r.classico);
    expect(c.recebe).toBe(147.24);
    expect(c.custo).toBeNull();
    expect(c.lucro).toBeNull();
    expect(c.margemPct).toBeNull();
    expect(c.avisos).toContain('composição diferente');
    expect(ok(r.premium).avisos).toContain('composição diferente');
  });

  it('comissão do Premium indisponível → premium indisponível; clássico ok', () => {
    const r = calcularMinhaMargem(entrada({
      premium: { comissao: { estado: 'indisponivel', motivo: 'tarifa indisponível' }, frete: { estado: 'ok', valor: 25.45 } },
    }));
    expect(r.premium).toEqual({ estado: 'indisponivel', motivo: 'tarifa indisponível' });
    expect(r.classico.estado).toBe('ok');
  });

  it('frete indisponível → tipo indisponível', () => {
    const r = calcularMinhaMargem(entrada({
      classico: { comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0 } }, frete: { estado: 'indisponivel', motivo: 'frete indisponível' } },
    }));
    expect(r.classico).toEqual({ estado: 'indisponivel', motivo: 'frete indisponível' });
    expect(r.premium.estado).toBe('ok');
  });

  it('alíquota indisponível → ambos indisponíveis com o motivo da alíquota', () => {
    const motivo = 'alíquotas não confirmadas';
    const r = calcularMinhaMargem(entrada({ aliquotaPct: { estado: 'indisponivel', motivo } }));
    expect(r.classico).toEqual({ estado: 'indisponivel', motivo });
    expect(r.premium).toEqual({ estado: 'indisponivel', motivo });
  });

  it('frete ok com aviso → aviso aparece em avisos', () => {
    const r = calcularMinhaMargem(entrada({
      classico: {
        comissao: { estado: 'ok', valor: { percentual: 12, fixa: 0 } },
        frete: { estado: 'ok', valor: 25.45, aviso: 'estimado (pacote padrão)' },
      },
    }));
    expect(ok(r.classico).avisos).toEqual(['estimado (pacote padrão)']);
  });
});

describe('composição do pacote (D-8: nunca presumida)', () => {
  const ok = (valor: number) => ({ estado: 'ok' as const, valor });
  const NC = { estado: 'indisponivel', motivo: 'composição não confirmada' } as const;
  const DIF = { estado: 'indisponivel', motivo: 'composição diferente' } as const;
  it('fator = unidades do anúncio ÷ unidades do SKU, só inteiro ≥ 1', () => {
    expect(fatorDoPacote(3, 1)).toEqual(ok(3));
    expect(fatorDoPacote(4, 2)).toEqual(ok(2));
    expect(fatorDoPacote(24, 24)).toEqual(ok(1)); // caixa de 24 contra anúncio de 24 → 1 caixa (Codex #3)
  });
  it('divisão não inteira → composição diferente', () => {
    expect(fatorDoPacote(3, 2)).toEqual(DIF);
    expect(fatorDoPacote(1, 24)).toEqual(DIF);
  });
  it.each([[null, 1], [1, null], [null, null], [0, 1], [1.5, 1], [NaN, 1], [2, 0], [2, -1]])('lado desconhecido/inválido (%s ÷ %s) → composição não confirmada', (a, s) => {
    expect(fatorDoPacote(a, s)).toEqual(NC);
  });
  it('custo do pacote = custo do SKU × fator, em centavos', () => {
    expect(custoDoPacote(10, ok(1))).toEqual(ok(10));
    expect(custoDoPacote(10.1, ok(3))).toEqual(ok(30.3));
  });
  it('fator indisponível passa o motivo; custo ausente/inválido → motivo próprio', () => {
    expect(custoDoPacote(10, NC)).toEqual(NC);
    expect(custoDoPacote(10, DIF)).toEqual(DIF);
    expect(custoDoPacote(null, ok(1))).toEqual({ estado: 'indisponivel', motivo: 'custo não cadastrado' });
    expect(custoDoPacote(NaN, ok(1))).toEqual({ estado: 'indisponivel', motivo: 'custo inválido' });
  });
});
