import { describe, expect, it } from 'vitest';
import { lerSimular, MAX_SIMULAR, simular, type ProjecaoExata } from '../simular.ts';
import type { LinhaCentral } from '../validar.ts';

const linha = (o: Partial<LinhaCentral> & { ml_item_id: string }): LinhaCentral => ({
  status: 'candidate', titulo: null, preco_min: 40, preco_max: 100, preco_sugerido: 90, preco_promo: null,
  preco_avaliado: 90, projecao: [], ...o,
});
const central = (...ls: LinhaCentral[]) => new Map(ls.map((l) => [l.ml_item_id, l]));
const cor = { liquido: 30, semaforo: 'verde' } as never;
const projetarOk: ProjecaoExata = async (_l, preco) => ({ projecao: [{ ...(cor as object), preco_teste: preco } as never], pior_semaforo: 'verde' });

describe('lerSimular', () => {
  it('aceita pedido válido', () => {
    expect(lerSimular({ promocao_id: 'P', itens: [{ ml_item_id: 'MLB1', preco: 50 }] }))
      .toEqual({ promocao_id: 'P', itens: [{ ml_item_id: 'MLB1', preco: 50 }] });
  });
  it.each([
    [{ itens: [{ ml_item_id: 'MLB1', preco: 50 }] }],
    [{ promocao_id: 'P', itens: [] }],
    [{ promocao_id: 'P', itens: [{ ml_item_id: 'MLB1', preco: 0 }] }],
    [{ promocao_id: 'P', itens: [{ ml_item_id: 'MLB1', preco: Number.NaN }] }],
    [{ promocao_id: 'P', itens: [{ ml_item_id: '', preco: 10 }] }],
    [{ promocao_id: 'P', itens: Array.from({ length: MAX_SIMULAR + 1 }, (_, i) => ({ ml_item_id: `MLB${i}`, preco: 10 })) }],
  ])('recusa pedido inválido %#', (b) => expect(lerSimular(b)).toBeNull());
});

describe('simular', () => {
  it('projeta no preço pedido com a tarifa exata (servidor), item a item', async () => {
    const vistos: number[] = [];
    const r = await simular([{ ml_item_id: 'MLB1', preco: 63.5 }], central(linha({ ml_item_id: 'MLB1' })),
      async (l, p) => { vistos.push(p); return projetarOk(l, p); });
    expect(vistos).toEqual([63.5]);
    expect(r).toEqual([{ ml_item_id: 'MLB1', status: 'simulado', preco: 63.5, projecao: [expect.anything()], pior_semaforo: 'verde' }]);
  });

  it('Relâmpago participando com convite de outro horário e sem faixa → ignorado (emenda 2026-11-08 (2))', async () => {
    const r = await simular([{ ml_item_id: 'C', preco: 50 }],
      central(linha({ ml_item_id: 'C', status: 'pending', convite_aberto: true, preco_min: null, preco_max: null })),
      async (l, p) => projetarOk(l, p));
    expect(r[0].status).toBe('ignorado');
  });

  it('fora da Central, encerrado ou convidado sem faixa do ML → ignorado com motivo, sem projetar', async () => {
    let chamadas = 0;
    const r = await simular(
      [{ ml_item_id: 'X', preco: 50 }, { ml_item_id: 'E', preco: 50 }, { ml_item_id: 'F', preco: 50 }],
      central(linha({ ml_item_id: 'E', status: 'finished' }), linha({ ml_item_id: 'F', preco_min: null, preco_max: null })),
      async (l, p) => { chamadas++; return projetarOk(l, p); },
    );
    expect(chamadas).toBe(0);
    expect(r.map((x) => [x.ml_item_id, x.status])).toEqual([['X', 'ignorado'], ['E', 'ignorado'], ['F', 'ignorado']]);
    expect(r[2]).toMatchObject({ motivo: 'O ML não informou a faixa de preço deste anúncio' });
  });

  // Emenda 2026-11-03 (alterar preço): participante simula sem faixa (o ML não a informa para quem já participa).
  it('participando (started/pending) sem faixa → simula', async () => {
    const r = await simular([{ ml_item_id: 'P', preco: 43.9 }],
      central(linha({ ml_item_id: 'P', status: 'started', preco_min: null, preco_max: null })), projetarOk);
    expect(r[0]).toMatchObject({ ml_item_id: 'P', status: 'simulado', preco: 43.9 });
  });

  it('falha da projeção (ML/tarifa) ou sem alíquota → ignorado; nunca líquido inventado', async () => {
    const r = await simular([{ ml_item_id: 'A', preco: 50 }, { ml_item_id: 'B', preco: 50 }],
      central(linha({ ml_item_id: 'A' }), linha({ ml_item_id: 'B' })),
      async (l) => { if (l.ml_item_id === 'A') throw new Error('429'); return null; });
    expect(r).toEqual([
      { ml_item_id: 'A', status: 'ignorado', motivo: 'Não foi possível calcular agora. Tente de novo.' },
      { ml_item_id: 'B', status: 'ignorado', motivo: expect.stringMatching(/alíquotas/) },
    ]);
  });
});
