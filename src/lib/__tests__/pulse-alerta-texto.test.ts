import { describe, it, expect } from 'vitest';
import { idadeAlerta, textoAlerta } from '../pulse-alerta-texto';
import { fmtBRL } from '../formato';
import type { PulseAlerta } from '../pulse';

const base = (over: Partial<PulseAlerta>): PulseAlerta => ({
  id: '1', produto_id: 'p1', tipo: 'preco_caiu', payload: {}, lido: false, criado_em: '2026-08-16T00:00:00Z',
  severidade: 'info',
  pulse_produtos: { titulo: 'Fone Bluetooth X', codigo_pai: 'ABC123', catalog_product_id: 'MLB123' },
  ...over,
});

describe('textoAlerta', () => {
  it('preco_caiu: menor preço caiu de X para Y', () => {
    const alerta = base({ tipo: 'preco_caiu', payload: { de: 129.9, para: 99.9 } });
    expect(textoAlerta(alerta)).toBe(
      `Menor preço de Fone Bluetooth X caiu de ${fmtBRL(129.9)} para ${fmtBRL(99.9)} (-23%)`,
    );
  });

  it('novo_concorrente: cai no seller_id quando não há nickname', () => {
    const alerta = base({ tipo: 'novo_concorrente', payload: { item_id: 'MLB999', seller_id: 42, preco: 79.5 } });
    expect(textoAlerta(alerta)).toBe(`vendedor 42 entrou em Fone Bluetooth X a ${fmtBRL(79.5)}`);
  });

  it('concorrente_saiu: cai no seller_id quando não há nickname', () => {
    const alerta = base({ tipo: 'concorrente_saiu', payload: { item_id: 'MLB999', seller_id: 42 } });
    expect(textoAlerta(alerta)).toBe('vendedor 42 saiu de Fone Bluetooth X');
  });

  it('nomeia o vendedor quando o payload traz nickname', () => {
    const alerta = base({
      tipo: 'concorrente_saiu', payload: { item_id: 'MLB999', seller_id: 42, nickname: 'LOJA SETE' },
    });
    expect(textoAlerta(alerta)).toBe('LOJA SETE saiu de Fone Bluetooth X');
  });

  it('mantém o texto genérico sem nickname e sem seller_id', () => {
    const alerta = base({ tipo: 'concorrente_saiu', payload: {} });
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

// ADR-0133 Errata 4 D-2: "caiu de R$ 49,90 para R$ 47,90" obriga a conta mental exatamente no
// momento da decisão.
describe('textoAlerta — o quanto caiu', () => {
  it('acrescenta o percentual da queda', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 49.9, para: 47.9 } })))
      .toBe(`Menor preço de Fone Bluetooth X caiu de ${fmtBRL(49.9)} para ${fmtBRL(47.9)} (-4%)`);
  });

  it('arredonda para inteiro — casa decimal de percentual não muda decisão aqui', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 71.99, para: 68.99 } })))
      .toMatch(/\(-4%\)$/);
  });

  it('sem os dois preços, não inventa percentual', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 49.9 } })))
      .toBe('Menor preço de Fone Bluetooth X caiu');
  });

  it('"de" zero não vira divisão por zero nem Infinity na tela', () => {
    expect(textoAlerta(base({ tipo: 'preco_caiu', payload: { de: 0, para: 0 } })))
      .toBe(`Menor preço de Fone Bluetooth X caiu de ${fmtBRL(0)} para ${fmtBRL(0)}`);
  });
});

describe('idadeAlerta', () => {
  const agora = new Date('2026-09-01T12:00:00.000Z');
  it('minutos', () => expect(idadeAlerta('2026-09-01T11:40:00.000Z', agora)).toBe('há 20 minutos'));
  it('horas', () => expect(idadeAlerta('2026-09-01T09:00:00.000Z', agora)).toBe('há cerca de 3 horas'));
  it('dias', () => expect(idadeAlerta('2026-08-29T12:00:00.000Z', agora)).toBe('há 3 dias'));
  it('data do futuro (relógio torto) devolve string vazia, não "há -1 dias"', () => {
    expect(idadeAlerta('2026-09-02T12:00:00.000Z', agora)).toBe('');
  });
});
