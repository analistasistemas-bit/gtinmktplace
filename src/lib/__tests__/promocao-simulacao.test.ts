import { describe, expect, it } from 'vitest';
import { aplicarSimulacao, filtrarPorBusca, foraDaFaixa, precoAlvo } from '@/lib/promocao-simulacao';
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
