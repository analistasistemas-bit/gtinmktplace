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

  it('sem título, nomeia a ficha em vez de soltar o código do ML cru na frase', () => {
    const alerta = base({
      tipo: 'concorrente_saiu',
      payload: {},
      pulse_produtos: { titulo: null, codigo_pai: null, catalog_product_id: 'MLB456' },
    });
    expect(textoAlerta(alerta)).toBe('Um concorrente saiu de ficha MLB456');
  });

  it('alerta órfão (sem produto) não vira "em produto a R$ 50"', () => {
    const alerta = base({ tipo: 'novo_concorrente', payload: { preco: 50 }, pulse_produtos: null });
    expect(textoAlerta(alerta)).toBe(`Novo concorrente em um produto do radar a ${fmtBRL(50)}`);
  });

  it('payload sem valores não imprime "R$ NaN"', () => {
    const alerta = base({ tipo: 'preco_caiu', payload: {}, pulse_produtos: { titulo: 'Produto X', codigo_pai: null, catalog_product_id: 'MLB1' } });
    expect(textoAlerta(alerta)).toBe('Menor preço de Produto X caiu');
  });

  it('tipo desconhecido (deploy novo da edge) não devolve linha em branco', () => {
    const alerta = base({
      tipo: 'tipo_que_nao_existe' as never,
      payload: {},
      pulse_produtos: { titulo: 'Produto X', codigo_pai: null, catalog_product_id: 'MLB1' },
    });
    expect(textoAlerta(alerta)).toBe('Mudança no mercado de Produto X');
  });
});
