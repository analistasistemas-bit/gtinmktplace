import { describe, expect, it } from 'vitest';
import { fotosDeOrigem, montarChaveEPedido, mesmoPedido } from '../origem.ts';
import { chaveComposicao } from '../../_shared/ai/foto-kit-virtual-modo.ts';

const foto = (n: number) => `https://http2.mlstatic.com/D_FOTO${n}-O.jpg`;
const item = (id: string, up: string, x: Record<string, unknown> = {}) => ({
  code: 200, body: { id, status: 'active', sub_status: [], user_product_id: up, pictures: [{ secure_url: foto(Number(id.slice(3))) }], ...x },
});
const pedidos = [{ userProductId: 'MLBU1', itemId: 'MLB1' }, { userProductId: 'MLBU2', itemId: 'MLB2' }];

describe('fotosDeOrigem', () => {
  it('2 itens ok → urls na ordem dos pedidos (não na do multiget)', () => {
    expect(fotosDeOrigem([item('MLB2', 'MLBU2'), item('MLB1', 'MLBU1')], pedidos)).toEqual({ ok: true, urls: [foto(1), foto(2)] });
  });

  it('user_product_id diferente → item_divergente', () => {
    expect(fotosDeOrigem([item('MLB1', 'MLBU1'), item('MLB2', 'MLBU9')], pedidos))
      .toEqual({ ok: false, motivo: 'item_divergente', itemId: 'MLB2' });
  });

  it('item não lido (404 ou ausente) → item_divergente, sem lançar', () => {
    expect(fotosDeOrigem([item('MLB1', 'MLBU1'), { code: 404, body: { id: 'MLB2' } }], pedidos))
      .toEqual({ ok: false, motivo: 'item_divergente', itemId: 'MLB2' });
    expect(fotosDeOrigem([item('MLB1', 'MLBU1')], pedidos)).toEqual({ ok: false, motivo: 'item_divergente', itemId: 'MLB2' });
  });

  it('item under_review → item_inelegivel', () => {
    expect(fotosDeOrigem([item('MLB1', 'MLBU1', { status: 'under_review' }), item('MLB2', 'MLBU2')], pedidos))
      .toEqual({ ok: false, motivo: 'item_inelegivel', itemId: 'MLB1' });
  });

  it('foto 1 fora do CDN do ML (ou sem foto) → item_inelegivel', () => {
    expect(fotosDeOrigem([item('MLB1', 'MLBU1'), item('MLB2', 'MLBU2', { pictures: [{ secure_url: 'https://evil.com/D_X.jpg' }] })], pedidos))
      .toEqual({ ok: false, motivo: 'item_inelegivel', itemId: 'MLB2' });
    expect(fotosDeOrigem([item('MLB1', 'MLBU1', { pictures: [] }), item('MLB2', 'MLBU2')], pedidos))
      .toEqual({ ok: false, motivo: 'item_inelegivel', itemId: 'MLB1' });
  });
});

describe('montarChaveEPedido', () => {
  const comps = [
    { user_product_id: 'MLBU9', item_id: 'MLB9', quantidade: 2, rotulo: 'B' },
    { user_product_id: 'MLBU1', item_id: 'MLB1', quantidade: 1, rotulo: 'A' },
  ];

  it('pedido na ordem do kit e composicao derivada dos ids do pedido', () => {
    const r = montarChaveEPedido(comps);
    expect(r.pedido).toEqual([{ user_product_id: 'MLBU9', quantidade: 2 }, { user_product_id: 'MLBU1', quantidade: 1 }]);
    expect(r.composicao).toBe(chaveComposicao(r.pedido.map((p) => p.user_product_id)));
    expect(r.composicao).toBe('MLBU1|MLBU9');
  });

  it('trocar só a quantidade muda o pedido, nunca a chave do teto', () => {
    const a = montarChaveEPedido(comps);
    const b = montarChaveEPedido(comps.map((c) => ({ ...c, quantidade: c.quantidade + 1 })));
    expect(b.composicao).toBe(a.composicao);
    expect(mesmoPedido(b.pedido, a.pedido)).toBe(false);
  });
});

describe('mesmoPedido', () => {
  const p = [{ user_product_id: 'MLBU1', quantidade: 2 }, { user_product_id: 'MLBU2', quantidade: 1 }];
  it('compara campo a campo (jsonb do banco reordena as chaves)', () => {
    expect(mesmoPedido([{ quantidade: 2, user_product_id: 'MLBU1' }, { quantidade: 1, user_product_id: 'MLBU2' }], p)).toBe(true);
    expect(mesmoPedido([...p].reverse(), p)).toBe(false);
    expect(mesmoPedido(p.slice(0, 1), p)).toBe(false);
    expect(mesmoPedido(null, p)).toBe(false);
  });
});
