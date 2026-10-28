import { describe, expect, it } from 'vitest';
import { filtroCasa, labelDinheiro, labelRetorno, resumirPedido, type ItemFila } from '../posvenda-fila';

const item = (p: Partial<ItemFila & { return_status: string }> = {}) => ({
  claim_id: 1, status: 'opened', type: 'returns', vez_de: null, revisao_pendente: false, prazo: null, acoes_pendentes: null, ...p,
});

describe('filtroCasa', () => {
  it('sub-itens', () => {
    expect(filtroCasa('revisar', item({ revisao_pendente: true }))).toBe(true);
    expect(filtroCasa('sua_vez', item({ vez_de: 'vendedor' }))).toBe(true);
    expect(filtroCasa('sua_vez', item({ revisao_pendente: true }))).toBe(false);
    expect(filtroCasa('a_caminho', item({ vez_de: 'comprador', return_status: 'shipped' }))).toBe(true);
    expect(filtroCasa('vez_comprador', item({ vez_de: 'comprador' }))).toBe(true);
    expect(filtroCasa('andamento', item({ vez_de: 'vendedor' }))).toBe(false);
  });
});

describe('resumirPedido', () => {
  const i = (n: number, q: number, p: number) => ({ id: `i${n}`, ml_item_id: null, variation_id: null, titulo: `P${n}`, codigo: null, ean: null, quantity: q, unit_price: p });
  it('soma unidades e valor; título com +N itens; foto do primeiro que tiver', () => {
    const r = resumirPedido([i(1, 2, 10), i(2, 1, 5)], (x) => (x.id === 'i2' ? 'f/2.jpg' : null));
    expect(r).toEqual({ titulo: 'P1 +1 item', quantidade: 3, valor: 25, fotoPath: 'f/2.jpg' });
    expect(resumirPedido([], () => null)).toBeNull();
  });
});

describe('rótulos', () => {
  it('traduz e cai no valor cru', () => {
    expect(labelRetorno('delivered')).toBe('Entregue');
    expect(labelRetorno('zzz')).toBe('zzz');
    expect(labelDinheiro('refunded')).toBe('Reembolsado');
    expect(labelDinheiro(null)).toBe('—');
  });
});
