import { describe, it, expect } from 'vitest';
import { parseStatusShopee, type ItemShopeeStatus } from '../status';

const base: ItemShopeeStatus = { item_id: 1, item_status: 'NORMAL' };

describe('parseStatusShopee', () => {
  it('NORMAL → ativo', () => {
    expect(parseStatusShopee({ ...base, item_status: 'NORMAL' }).status).toBe('ativo');
  });

  it('UNLIST → pausado', () => {
    expect(parseStatusShopee({ ...base, item_status: 'UNLIST' }).status).toBe('pausado');
  });

  it('BANNED → moderado com motivo', () => {
    const r = parseStatusShopee({ ...base, item_status: 'BANNED' });
    expect(r.status).toBe('moderado');
    expect(r.motivo).toMatch(/banned/i);
  });

  it('REVIEWING → moderado', () => {
    expect(parseStatusShopee({ ...base, item_status: 'REVIEWING' }).status).toBe('moderado');
  });

  it('SELLER_DELETE / SHOPEE_DELETE → encerrado', () => {
    expect(parseStatusShopee({ ...base, item_status: 'SELLER_DELETE' }).status).toBe('encerrado');
    expect(parseStatusShopee({ ...base, item_status: 'SHOPEE_DELETE' }).status).toBe('encerrado');
  });

  it('status desconhecido/ausente → indisponivel', () => {
    expect(parseStatusShopee({ ...base, item_status: 'WAT' }).status).toBe('indisponivel');
    expect(parseStatusShopee({ item_id: 1 }).status).toBe('indisponivel');
    expect(parseStatusShopee(null).status).toBe('indisponivel');
  });

  it('propaga estoque e preço quando presentes', () => {
    const r = parseStatusShopee({ ...base, normalized_stock: 7, current_price: 29.9 });
    expect(r.estoque).toBe(7);
    expect(r.preco).toBe(29.9);
  });

  it('estoque/preço ausentes → null', () => {
    const r = parseStatusShopee(base);
    expect(r.estoque).toBeNull();
    expect(r.preco).toBeNull();
  });
});
