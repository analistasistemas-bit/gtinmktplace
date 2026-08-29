import { describe, expect, it } from 'vitest';
import {
  LIMITACAO_3_2,
  montarSecoes237,
  PISO_NICHO_MES,
} from '../relatorio-secoes-237.ts';
import type { AnuncioAmostra } from '../../pulse/nicho-vendedor.ts';

const snap = (seller_id: string, t0: number, t1: number) => [
  { seller_id, transactions_total: t0, dia: '2026-08-01' },
  { seller_id, transactions_total: t1, dia: '2026-08-31' },
];

function anuncio(partial: Partial<AnuncioAmostra> & Pick<AnuncioAmostra, 'seller_id'>): AnuncioAmostra {
  return {
    item_id: partial.item_id ?? `MLB-${partial.seller_id}`,
    seller_id: partial.seller_id,
    preco: partial.preco ?? 10,
    vendidos: partial.vendidos ?? 100,
  };
}

describe('montarSecoes237', () => {
  it('3.1 é a mesma referência que 2.6 (uma origem, um valor)', () => {
    const anuncios = [anuncio({ seller_id: 'v1' })];
    const serie = snap('v1', 100, 121);
    const s = montarSecoes237(anuncios, serie);
    expect(s['3.1']).toBe(s['2.6']);
  });

  it('2.8 = 10% de 2.6 quando há faturamento', () => {
    const anuncios = [anuncio({ seller_id: 'v1', preco: 100, vendidos: 1 })];
    const serie = snap('v1', 0, 310);
    const s = montarSecoes237(anuncios, serie);
    expect(s['2.6'].estado).toBe('valor');
    if (s['2.6'].estado !== 'valor') return;
    expect(s['2.8']).toEqual({
      valor: s['2.6'].faturamento_mes * 0.10,
      unidade: 'R$/mês',
      rotulo: 'meta de entrada (10% do faturamento do nicho)',
    });
  });

  it('2.9 compara faturamento com piso comercial 30k', () => {
    const acima = montarSecoes237(
      [anuncio({ seller_id: 'big', preco: 10_000, vendidos: 1 })],
      snap('big', 0, 3100),
    );
    expect(acima['2.9'].parecer).toBe('nicho comporta entrada');
    expect(acima['2.7'].valor).toBe(PISO_NICHO_MES);
    expect(acima['2.7'].tipo).toBe('regra_comercial');

    const abaixo = montarSecoes237(
      [anuncio({ seller_id: 'small', preco: 10, vendidos: 1 })],
      snap('small', 100, 121),
    );
    expect(abaixo['2.9'].parecer).toBe('nicho pequeno para a meta');
  });

  it('sem estimativa → 2.9 mensagem e 2.8 sem_dado', () => {
    const s = montarSecoes237(
      [anuncio({ seller_id: 'solo' })],
      [{ seller_id: 'solo', transactions_total: 100, dia: '2026-08-01' }],
    );
    expect(s['2.9'].parecer).toBe('não dá para medir o tamanho deste nicho');
    expect(s['2.8']).toEqual({ estado: 'sem_dado', mensagem: 'faturamento do nicho indisponível' });
  });

  it('inclui limitacao_3_2 da ADR-0142', () => {
    const s = montarSecoes237([], []);
    expect(s.limitacao_3_2).toBe(LIMITACAO_3_2);
    expect(s.limitacao_3_2).toContain('loja inteira');
  });

  it('3.4 rotula sem estimativa mensal, nunca venderam', () => {
    const s = montarSecoes237(
      [anuncio({ seller_id: 'x' })],
      [{ seller_id: 'x', transactions_total: 100, dia: '2026-08-01' }],
    );
    expect(s['3.4'].rotulo).toContain('sem estimativa mensal');
    expect(s['3.4'].rotulo.toLowerCase()).not.toContain('venderam');
  });
});
