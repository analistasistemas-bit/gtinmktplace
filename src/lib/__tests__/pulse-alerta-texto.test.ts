import { describe, it, expect } from 'vitest';
import { textoAlerta } from '../pulse-alerta-texto';
import { fmtBRL } from '../formato';
import type { PulseAlerta } from '../pulse';

const base = (over: Partial<PulseAlerta>): PulseAlerta => ({
  id: '1', produto_id: 'p1', tipo: 'preco_caiu', payload: {}, lido: false, criado_em: '2026-08-16T00:00:00Z',
  pulse_produtos: { titulo: 'Fone Bluetooth X', codigo_pai: 'ABC123', catalog_product_id: 'MLB123' },
  ...over,
});

describe('textoAlerta', () => {
  it('preco_caiu: menor preço caiu de X para Y', () => {
    const alerta = base({ tipo: 'preco_caiu', payload: { de: 129.9, para: 99.9 } });
    expect(textoAlerta(alerta)).toBe(
      `Menor preço de Fone Bluetooth X caiu de ${fmtBRL(129.9)} para ${fmtBRL(99.9)}`,
    );
  });

  it('novo_concorrente: novo concorrente a R$ preco', () => {
    const alerta = base({ tipo: 'novo_concorrente', payload: { item_id: 'MLB999', seller_id: 42, preco: 79.5 } });
    expect(textoAlerta(alerta)).toBe(`Novo concorrente em Fone Bluetooth X a ${fmtBRL(79.5)}`);
  });

  it('concorrente_saiu: um concorrente saiu', () => {
    const alerta = base({ tipo: 'concorrente_saiu', payload: { item_id: 'MLB999', seller_id: 42 } });
    expect(textoAlerta(alerta)).toBe('Um concorrente saiu de Fone Bluetooth X');
  });

  it('cai para catalog_product_id quando o produto não tem título', () => {
    const alerta = base({
      tipo: 'concorrente_saiu',
      payload: {},
      pulse_produtos: { titulo: null, codigo_pai: null, catalog_product_id: 'MLB456' },
    });
    expect(textoAlerta(alerta)).toBe('Um concorrente saiu de MLB456');
  });
});
