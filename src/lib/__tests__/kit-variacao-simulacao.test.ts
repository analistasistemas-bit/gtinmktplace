import { describe, expect, it } from 'vitest';
import {
  aliquotaDoKit, chaveDimensoes, simularKit, skuDoKit, type PecaBase,
} from '../kit-variacao-simulacao';
import type { Tarifa } from '../tarifa';

const peca = (cor: string, tamanho: string, custo: number | null, pesoGramas = 200): PecaBase => ({
  cor, tamanho, custo, pesoGramas, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});

const variacoes = [
  peca('Preto', 'M', 20), peca('Branco', 'M', 25), peca('Marrom', 'M', 40),
];

/** Tarifa como `calcularTarifaML` devolve: recebe já líquido de comissão, frete e imposto. */
function tarifa(preco: number, frete: number, imposto = 0, proveniencia: Tarifa['proveniencia'] = 'official'): Tarifa {
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - frete - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete, proveniencia };
}

const cores = ['Preto', 'Branco', 'Marrom'];
const quantidades = [
  { cores: ['Preto', 'Branco'], tamanho: 'M', quantidade: 2 },
  { cores: ['Marrom', 'Preto'], tamanho: 'M', quantidade: 1 },
  { cores: ['Branco', 'Marrom'], tamanho: 'M', quantidade: 0 },
];

function cotacoesPara(preco: number, frete: number, imposto = 0) {
  const m = new Map<string, Tarifa | null | undefined>();
  for (const q of quantidades) {
    const sku = skuDoKit(variacoes, cores, q.cores, q.tamanho);
    if (sku) m.set(chaveDimensoes(sku.dim), tarifa(preco, frete, imposto));
  }
  return m;
}

describe('skuDoKit (mesma conta de montarVariacaoKitVariacao)', () => {
  it('soma custo e peso, altura da primeira peça × N, largura e comprimento da primeira', () => {
    const sku = skuDoKit(variacoes, cores, ['Branco', 'Preto'], 'M')!;
    expect(sku.custo).toBe(45);
    expect(sku.dim).toEqual({ pesoGramas: 400, alturaCm: 6, larguraCm: 20, comprimentoCm: 30 });
    expect(sku.rotulo).toBe('Preto e Branco');
  });
  it('peça sem custo marca o SKU sem custo, nunca zero', () => {
    const sku = skuDoKit([peca('Preto', 'M', null), peca('Branco', 'M', 25)], cores, ['Preto', 'Branco'], 'M')!;
    expect(sku.custo).toBeNull();
  });
  it('peça que a base não tem → null', () => {
    expect(skuDoKit(variacoes, cores, ['Preto', 'Branco'], 'G')).toBeNull();
  });
});

describe('aliquotaDoKit', () => {
  it('só com alíquota confirmada e origem explícita', () => {
    expect(aliquotaDoKit('importado', { nacional: 8, importado: 16, confirmada: true })).toBe(16);
    expect(aliquotaDoKit('nacional', { nacional: 8, importado: 16, confirmada: true })).toBe(8);
    expect(aliquotaDoKit('nacional', { nacional: 8, importado: 16, confirmada: false })).toBeNull();
    expect(aliquotaDoKit(null, { nacional: 8, importado: 16, confirmada: true })).toBeNull();
    expect(aliquotaDoKit('nacional', undefined)).toBeNull();
  });
});

describe('simularKit', () => {
  const base = { preco: 100, pecas: 2, cores, quantidades, variacoes, tipo: 'gold_special' as const, aliquotaPct: 8 };

  it('destaca a pior combinação (menor lucro) e ignora quantidade 0', () => {
    const s = simularKit({ ...base, cotacoes: cotacoesPara(100, 10, 8) });
    expect(s.linhas.map((l) => l.rotulo)).toEqual(['Preto e Branco', 'Preto e Marrom']);
    expect(s.estado).toBe('ok');
    expect(s.pior?.rotulo).toBe('Preto e Marrom');
    // recebe 100 − 12 − 10 − 8 = 70; custo 60 → lucro 10, margem 10%, markup 1/6
    expect(s.pior?.resumo?.lucro).toBeCloseTo(10);
    expect(s.pior?.resumo?.margem).toBeCloseTo(0.1);
    expect(s.pior?.resumo?.markup).toBeCloseTo(10 / 60);
    expect(s.pior?.resumo?.imposto).toBe(8);
    expect(s.precisaConfirmar).toBe(false);
  });

  it('prejuízo em qualquer combinação exige confirmação', () => {
    const s = simularKit({ ...base, preco: 70, cotacoes: cotacoesPara(70, 10, 5.6) });
    expect(s.estado).toBe('prejuizo');
    expect(s.pior!.resumo!.lucro).toBeLessThan(0);
    expect(s.precisaConfirmar).toBe(true);
  });

  it('cotação indisponível não mostra número e exige confirmação', () => {
    const cot = cotacoesPara(100, 10, 8);
    const chave = chaveDimensoes(skuDoKit(variacoes, cores, ['Marrom', 'Preto'], 'M')!.dim);
    cot.set(chave, null);
    // mesmas dimensões nas duas combinações: as duas ficam sem cotação
    const s = simularKit({ ...base, cotacoes: cot });
    expect(s.estado).toBe('indisponivel');
    expect(s.linhas.every((l) => l.resumo === null)).toBe(true);
    expect(s.pior).toBeNull();
    expect(s.precisaConfirmar).toBe(true);
  });

  it('cotação não oficial (estimada) conta como indisponível', () => {
    const cot = new Map<string, Tarifa | null | undefined>();
    for (const k of cotacoesPara(100, 10, 8).keys()) cot.set(k, tarifa(100, 10, 8, 'estimated'));
    const s = simularKit({ ...base, cotacoes: cot });
    expect(s.estado).toBe('indisponivel');
    expect(s.linhas[0].resumo).toBeNull();
  });

  it('peça sem custo na base bloqueia (como base_sem_custo da edge), sem lucro e sem confirmação', () => {
    const s = simularKit({
      ...base, variacoes: [peca('Preto', 'M', 20), peca('Branco', 'M', null), peca('Marrom', 'M', 40)],
      cotacoes: cotacoesPara(100, 10, 8),
    });
    expect(s.estado).toBe('sem_custo');
    expect(s.pior).toBeNull();
    expect(s.precisaConfirmar).toBe(false);
    expect(s.linhas.find((l) => l.rotulo === 'Preto e Branco')!.motivo).toMatch(/sem custo/i);
    expect(s.linhas.find((l) => l.rotulo === 'Preto e Branco')!.resumo).toBeNull();
    expect(s.linhas.find((l) => l.rotulo === 'Preto e Marrom')!.resumo).not.toBeNull();
  });

  it('cotação ainda chegando → calculando, sem decisão de confirmação', () => {
    const cot = new Map<string, Tarifa | null | undefined>();
    const s = simularKit({ ...base, cotacoes: cot });
    expect(s.estado).toBe('calculando');
    expect(s.pior).toBeNull();
  });

  it('sem alíquota não calcula imposto e avisa', () => {
    const s = simularKit({ ...base, aliquotaPct: null, cotacoes: cotacoesPara(100, 10, 0) });
    expect(s.semAliquota).toBe(true);
    expect(s.linhas.every((l) => l.resumo?.imposto === 0)).toBe(true);
    expect(s.precisaConfirmar).toBe(true);
  });

  it('Premium usa a coluna premium da tarifa', () => {
    const s = simularKit({ ...base, tipo: 'gold_pro', cotacoes: cotacoesPara(100, 10, 8) });
    expect(s.pior?.resumo?.comissaoPct).toBe(17);
  });

  it('peça excluída da publicação não entra (como a edge): combinação inválida e bloqueia', () => {
    const s = simularKit({
      ...base, variacoes: [peca('Preto', 'M', 20), { ...peca('Branco', 'M', 25), excluidaDaPublicacao: true }, peca('Marrom', 'M', 40)],
      cotacoes: cotacoesPara(100, 10, 8),
    });
    expect(s.estado).toBe('peca_inexistente');
    expect(s.pior).toBeNull();
    expect(s.precisaConfirmar).toBe(false);
    expect(s.linhas.find((l) => l.rotulo === 'Preto e Branco')!.resumo).toBeNull();
  });
});
