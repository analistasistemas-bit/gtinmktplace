import { describe, it, expect } from 'vitest';
import { agregarConcorrencia } from '../agregar';
import type { ProdutoConcorrencia } from '../agregar';
import type { DadosOfertas } from '../tipos';

function ofertas(parcial: Partial<DadosOfertas>): DadosOfertas {
  return {
    vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
    frete_gratis: 0, full: 0, seller_ids: [], category_id: null,
    ...parcial,
  };
}

function produto(parcial: Partial<ProdutoConcorrencia> & { ofertas: DadosOfertas }): ProdutoConcorrencia {
  return { product_id: 'MLB1', product_name: 'Produto', ...parcial };
}

describe('agregarConcorrencia', () => {
  it('produto único → devolve os próprios valores', () => {
    const p = produto({
      product_id: 'MLB1',
      product_name: 'Fita Cetim Azul',
      ofertas: ofertas({ vendedores: 3, preco_min: 10, preco_max: 20, total_ofertas: 4, frete_gratis: 1, full: 2, seller_ids: [1, 2, 3], category_id: 'MLB255054' }),
    });
    const r = agregarConcorrencia([p]);
    expect(r.preco_min).toBe(10);
    expect(r.ofertas?.preco_max).toBe(20);
    expect(r.vendedores).toBe(3);
    expect(r.product_id).toBe('MLB1');
    expect(r.product_name).toBe('Fita Cetim Azul');
    expect(r.origem).toBe('gtin');
    expect(r.classe).toBe('moderada');
  });

  it('múltiplos: preco_min é o menor global e o representativo é o da cor mais barata', () => {
    const azul = produto({
      product_id: 'MLB1', product_name: 'Fita Azul',
      ofertas: ofertas({ vendedores: 2, preco_min: 15, preco_max: 18, seller_ids: [1, 2] }),
    });
    const vermelha = produto({
      product_id: 'MLB2', product_name: 'Fita Vermelha',
      ofertas: ofertas({ vendedores: 1, preco_min: 8, preco_max: 8, seller_ids: [3] }),
    });
    const r = agregarConcorrencia([azul, vermelha]);
    expect(r.preco_min).toBe(8);
    expect(r.product_id).toBe('MLB2');
    expect(r.product_name).toBe('Fita Vermelha');
  });

  it('união de seller_ids faz dedup entre produtos', () => {
    const a = produto({
      product_id: 'MLB1', ofertas: ofertas({ vendedores: 2, preco_min: 10, seller_ids: [1, 2] }),
    });
    const b = produto({
      product_id: 'MLB2', ofertas: ofertas({ vendedores: 2, preco_min: 12, seller_ids: [2, 3] }),
    });
    const r = agregarConcorrencia([a, b]);
    expect(r.vendedores).toBe(3);
    expect(r.ofertas?.seller_ids.slice().sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });

  it('preco_max é o maior global; total_ofertas/frete_gratis/full são somados', () => {
    const a = produto({
      product_id: 'MLB1',
      ofertas: ofertas({ preco_min: 10, preco_max: 20, total_ofertas: 3, frete_gratis: 1, full: 1, seller_ids: [1] }),
    });
    const b = produto({
      product_id: 'MLB2',
      ofertas: ofertas({ preco_min: 5, preco_max: 30, total_ofertas: 2, frete_gratis: 2, full: 0, seller_ids: [2] }),
    });
    const r = agregarConcorrencia([a, b]);
    expect(r.ofertas?.preco_max).toBe(30);
    expect(r.ofertas?.total_ofertas).toBe(5);
    expect(r.ofertas?.frete_gratis).toBe(3);
    expect(r.ofertas?.full).toBe(1);
  });

  it('produto com preco_min null é ignorado no mínimo, mas seus sellers contam', () => {
    const semPreco = produto({
      product_id: 'MLB1',
      ofertas: ofertas({ preco_min: null, preco_max: null, seller_ids: [9] }),
    });
    const comPreco = produto({
      product_id: 'MLB2',
      ofertas: ofertas({ preco_min: 7, preco_max: 7, seller_ids: [10] }),
    });
    const r = agregarConcorrencia([semPreco, comPreco]);
    expect(r.preco_min).toBe(7);
    expect(r.product_id).toBe('MLB2');
    expect(r.ofertas?.seller_ids.slice().sort((x, y) => x - y)).toEqual([9, 10]);
  });

  it('todos os produtos com preco_min null → preco_min agregado é null e o representativo é o 1º da lista', () => {
    const a = produto({ product_id: 'MLB1', ofertas: ofertas({ preco_min: null }) });
    const b = produto({ product_id: 'MLB2', ofertas: ofertas({ preco_min: null }) });
    const r = agregarConcorrencia([a, b]);
    expect(r.preco_min).toBeNull();
    expect(r.product_id).toBe('MLB1');
  });

  it('classe é recalculada a partir da união (3 + 3 distintos = 6 → alta)', () => {
    const a = produto({ product_id: 'MLB1', ofertas: ofertas({ vendedores: 3, seller_ids: [1, 2, 3] }) });
    const b = produto({ product_id: 'MLB2', ofertas: ofertas({ vendedores: 3, seller_ids: [4, 5, 6] }) });
    const r = agregarConcorrencia([a, b]);
    expect(r.vendedores).toBe(6);
    expect(r.classe).toBe('alta');
  });

  it('guard: lista vazia lança erro', () => {
    expect(() => agregarConcorrencia([])).toThrow('agregarConcorrencia: lista vazia');
  });

  it('category_id é resolvido do 2º produto quando o 1º tem category_id null', () => {
    const a = produto({ product_id: 'MLB1', ofertas: ofertas({ category_id: null }) });
    const b = produto({ product_id: 'MLB2', ofertas: ofertas({ category_id: 'MLB255054' }) });
    const r = agregarConcorrencia([a, b]);
    expect(r.ofertas?.category_id).toBe('MLB255054');
  });

  it('empate de preco_min entre dois produtos → representativo é o 1º da lista (ordem)', () => {
    const a = produto({ product_id: 'MLB1', product_name: 'Fita A', ofertas: ofertas({ preco_min: 10 }) });
    const b = produto({ product_id: 'MLB2', product_name: 'Fita B', ofertas: ofertas({ preco_min: 10 }) });
    const r = agregarConcorrencia([a, b]);
    expect(r.preco_min).toBe(10);
    expect(r.product_id).toBe('MLB1');
  });

  it('fallback vendedoresSoma: todos com seller_ids vazio → vendedores = soma de ofertas.vendedores', () => {
    const a = produto({ product_id: 'MLB1', ofertas: ofertas({ vendedores: 3, seller_ids: [] }) });
    const b = produto({ product_id: 'MLB2', ofertas: ofertas({ vendedores: 4, seller_ids: [] }) });
    const r = agregarConcorrencia([a, b]);
    expect(r.vendedores).toBe(7);
    expect(r.classe).toBe('alta');
  });
});
