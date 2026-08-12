// O webhook `orders_v2` notifica pedidos em que a conta é comprador OU vendedor. Sem esta guarda,
// cada COMPRA da empresa entrava em ml_vendas como venda (23 linhas, R$ 8.810,50 em `paid`,
// medido em 2026-08-12 — ver code-review-v11).
import { describe, it, expect } from 'vitest';
import { ehVendaDaConta } from '../venda';

describe('ehVendaDaConta', () => {
  it('aceita pedido em que a conta é o vendedor', () => {
    expect(ehVendaDaConta({ seller: { id: 1003820507 } }, '1003820507')).toBe(true);
  });

  it('aceita quando o id vem como string (o ML alterna number/string)', () => {
    expect(ehVendaDaConta({ seller: { id: '1003820507' } }, '1003820507')).toBe(true);
  });

  it('recusa COMPRA da empresa — a conta é o comprador e outro é o vendedor', () => {
    // Caso real: pedido 2000017632520548, memória RAM comprada pela AVILBV em 28/07/2026.
    expect(ehVendaDaConta({ seller: { id: 987654321 } }, '1003820507')).toBe(false);
  });

  it('recusa pedido sem seller quando a conta é conhecida', () => {
    expect(ehVendaDaConta({ seller: null }, '1003820507')).toBe(false);
    expect(ehVendaDaConta({}, '1003820507')).toBe(false);
  });

  it('aceita quando a conta externa é desconhecida — não descarta venda legítima', () => {
    expect(ehVendaDaConta({ seller: { id: 42 } }, null)).toBe(true);
    expect(ehVendaDaConta({ seller: { id: 42 } }, undefined)).toBe(true);
    expect(ehVendaDaConta({ seller: { id: 42 } }, '')).toBe(true);
  });
});
