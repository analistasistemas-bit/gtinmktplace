import { describe, expect, it } from 'vitest';
import { aplicarSimulacao, detalheLiquido, filtrarPorBusca, foraDaFaixa, precoAlvo, sobreporSimulacao } from '@/lib/promocao-simulacao';
import type { ItemPromocao } from '@/lib/promocoes';

const item = (o: Partial<ItemPromocao> & { ml_item_id: string }): ItemPromocao => ({
  status: 'candidate', preco_original: 71.9, preco_promo: null, preco_min: 40, preco_max: 70, preco_sugerido: 62.55,
  preco_avaliado: 62.55, ml_pct: null, estoque_min: null, titulo: 'Short Bermuda Linho Mauricinho Masculino',
  thumbnail: null, permalink: null, projecao: [], pior_semaforo: 'verde', ...o,
});

describe('filtrarPorBusca', () => {
  const itens = [
    item({ ml_item_id: 'MLB1', projecao: [{ sku: '00000143' } as never] }),
    item({ ml_item_id: 'MLB2', titulo: 'Calça Sarja Masculina' }),
    item({ ml_item_id: 'MLB3', titulo: 'Calça Jeans', anuncio_normal_id: 'MLB999' }),
  ];
  const ids = (t: string) => filtrarPorBusca(itens, t).map((i) => i.ml_item_id);

  it('vazio devolve tudo', () => expect(ids('  ')).toEqual(['MLB1', 'MLB2', 'MLB3']));
  it('todas as palavras, sem acento nem caixa (produto + variações)', () => {
    expect(ids('short linho')).toEqual(['MLB1']);
    expect(ids('CALCA')).toEqual(['MLB2', 'MLB3']);
  });
  it('por MLB (inclusive o normal do par de catálogo) e por SKU', () => {
    expect(ids('mlb2')).toEqual(['MLB2']);
    expect(ids('MLB999')).toEqual(['MLB3']);
    expect(ids('00000143')).toEqual(['MLB1']);
  });
});

describe('precoAlvo', () => {
  it('desconto sobre o preço original, arredondado a centavos', () => {
    expect(precoAlvo(item({ ml_item_id: 'A' }), 'desconto', 15)).toBe(61.12); // 71,90 × 0,85 = 61,115
  });
  it('preço fixo vale para todas as variações', () => expect(precoAlvo(item({ ml_item_id: 'A' }), 'preco', 59.9)).toBe(59.9));
  it('sem preço original ou valor inválido → null', () => {
    expect(precoAlvo(item({ ml_item_id: 'A', preco_original: null }), 'desconto', 10)).toBeNull();
    expect(precoAlvo(item({ ml_item_id: 'A' }), 'desconto', 0)).toBeNull();
    expect(precoAlvo(item({ ml_item_id: 'A' }), 'desconto', 100)).toBeNull();
    expect(precoAlvo(item({ ml_item_id: 'A' }), 'preco', 0)).toBeNull();
  });
});

describe('foraDaFaixa', () => {
  it('fora de [min, max] do ML', () => {
    expect(foraDaFaixa(item({ ml_item_id: 'A' }), 39.99, 'DEAL')).toMatch(/faixa do ML/);
    expect(foraDaFaixa(item({ ml_item_id: 'A' }), 70.01, 'DEAL')).toMatch(/faixa do ML/);
    expect(foraDaFaixa(item({ ml_item_id: 'A' }), 50, 'DEAL')).toBeNull();
  });
  it('Relâmpago abaixo de R$ 19', () => {
    expect(foraDaFaixa(item({ ml_item_id: 'A', preco_min: 10 }), 18.9, 'LIGHTNING')).toMatch(/R\$ 19/);
  });
});

describe('aplicarSimulacao', () => {
  it('só os simulados trocam preço, projeção e semáforo (números do servidor)', () => {
    const cor = { liquido: 30 } as never;
    const m = aplicarSimulacao([item({ ml_item_id: 'A' }), item({ ml_item_id: 'B' })], [
      { ml_item_id: 'A', status: 'simulado', preco: 55, projecao: [cor], pior_semaforo: 'amarelo' },
      { ml_item_id: 'B', status: 'ignorado', motivo: 'x' },
    ]);
    expect([...m.keys()]).toEqual(['A']);
    expect(m.get('A')).toMatchObject({ preco_avaliado: 55, projecao: [cor], pior_semaforo: 'amarelo' });
  });
});

// Jaqueta MLB5441057075 a R$ 49,90 (Zaven, 03/11): mesmo cálculo do "Você recebe por venda" de Publicados.
describe('detalheLiquido', () => {
  const cor = {
    variation_id: 1, cor: 'Azul Celeste', sku: null, custo: 18.5, piso: 28.5, origem: 'nacional',
    comissao_pct: 14, comissao_fixa: 0, frete: 8.25, aliquota_pct: 4, liquido: 32.664,
    ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde' as const, motivo: null,
  };
  it('decompõe o líquido do servidor em comissão, imposto, frete, lucro e markup', () => {
    const d = detalheLiquido(cor, 49.9)!;
    expect(d.comissao).toBeCloseTo(6.986, 3);
    expect(d.imposto).toBeCloseTo(1.996, 3);
    expect(d.frete).toBe(8.25);
    expect(d.recebe).toBe(32.664);
    expect(d.lucro).toBeCloseTo(14.164, 3);
    expect(Math.round(d.markup * 100)).toBe(77);
    // Margem = lucro ÷ preço de venda (mesma régua de cascata-pedido/Vendas SKU): 14,164 / 49,90.
    expect(Math.round(d.margem! * 100)).toBe(28);
    expect(detalheLiquido(cor, 0)!.margem).toBeNull(); // preço 0: margem indefinida, nunca "0%"
  });
  it('comissão fixa entra na comissão', () => {
    expect(detalheLiquido({ ...cor, comissao_fixa: 6.25 }, 49.9)!.comissao).toBeCloseTo(13.236, 3);
  });
  it('sem líquido, custo ou tarifa → null (nunca zero)', () => {
    expect(detalheLiquido({ ...cor, liquido: null }, 49.9)).toBeNull();
    expect(detalheLiquido({ ...cor, frete: null }, 49.9)).toBeNull();
    expect(detalheLiquido({ ...cor, custo: null }, 49.9)).toBeNull();
    expect(detalheLiquido(cor, null)).toBeNull();
  });
});

describe('sobreporSimulacao', () => {
  it('preço, projeção e semáforo simulados; "até quanto descer" fica o do sync (não depende do preço)', () => {
    const atual = item({ ml_item_id: 'A', projecao: [
      { variation_id: 1, liquido: 40, ate_quanto: 41.45, ate_quanto_motivo: null } as never,
      { variation_id: 2, liquido: 40, ate_quanto: null, ate_quanto_motivo: 'qualquer' } as never,
    ] });
    const sim = item({ ml_item_id: 'A', preco_avaliado: 49.9, pior_semaforo: 'amarelo', projecao: [
      { variation_id: 2, liquido: 30, ate_quanto: null, ate_quanto_motivo: null } as never,
      { variation_id: 1, liquido: 31, ate_quanto: null, ate_quanto_motivo: null } as never,
    ] });
    const r = sobreporSimulacao(atual, sim);
    expect(r).toMatchObject({ preco_avaliado: 49.9, pior_semaforo: 'amarelo' });
    expect(r.projecao).toEqual([
      expect.objectContaining({ variation_id: 2, liquido: 30, ate_quanto: null, ate_quanto_motivo: 'qualquer' }),
      expect.objectContaining({ variation_id: 1, liquido: 31, ate_quanto: 41.45, ate_quanto_motivo: null }),
    ]);
  });

  it('achados Codex: cor sem par no sync ou com custo/piso/alíquota diferentes → sem "até quanto"', () => {
    const base = { custo: 20, piso: 30, aliquota_pct: 4, ate_quanto: null, ate_quanto_motivo: null };
    const atual = item({ ml_item_id: 'A', projecao: [{ variation_id: 1, ...base, ate_quanto: 36.59 } as never] });
    const sim = (o: object) => sobreporSimulacao(atual, item({ ml_item_id: 'A', projecao: [{ variation_id: 1, ...base, ...o } as never] })).projecao[0];
    expect(sim({}).ate_quanto).toBe(36.59);
    expect(sim({ variation_id: 2 }).ate_quanto).toBeNull();
    expect(sim({ custo: 50 }).ate_quanto).toBeNull();
    expect(sim({ piso: 60 }).ate_quanto).toBeNull();
    expect(sim({ aliquota_pct: 16 }).ate_quanto).toBeNull();
  });
});
