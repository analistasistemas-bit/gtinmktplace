// ADR-0173: variantes ESTRITAS de leituras/gravações do faturamento — cobertura verificável (sem
// buraco silencioso) para os workers agendados em fan-out, que rodam 1 org + 1 lote por mensagem.
import { describe, it, expect, vi } from 'vitest';
import { buscarPedidosPeriodoEstrito, TETO_PEDIDOS_JANELA } from '../io';
import { buscarMensagensPackEstrito, upsertMensagensEstrito, listarPacksDeVendasEstrito } from '../mensagens-io';
import type { MensagemML } from '../mensagem-mapper';

// ─── buscarPedidosPeriodoEstrito ───────────────────────────────────────────

const ME = { ok: true, status: 200, json: async () => ({ id: 999 }) };
const intervalo = { desde: '2026-01-01T00:00:00Z', ate: '2026-01-02T00:00:00Z' };

function pagina(results: Array<{ id: number }>, total: number) {
  return { ok: true, status: 200, json: async () => ({ results, paging: { total } }) };
}
function erroPagina(status: number, corpo = 'erro') {
  return { ok: false, status, text: async () => corpo };
}
function faixa(de: number, ate: number) {
  return Array.from({ length: ate - de }, (_, i) => ({ id: de + i }));
}

describe('buscarPedidosPeriodoEstrito', () => {
  it('2 páginas coerentes (total:70) → 70 pedidos', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce(pagina(faixa(0, 50), 70))
      .mockResolvedValueOnce(pagina(faixa(50, 70), 70));
    const r = await buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch);
    expect(r).toHaveLength(70);
  });

  it('1ª ok e 2ª 500 → rejeita', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce(pagina(faixa(0, 50), 70))
      .mockResolvedValueOnce(erroPagina(500));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch)).rejects.toThrow(/500/);
  });

  it('429 na 1ª → rejeita', async () => {
    const f = vi.fn().mockResolvedValueOnce(ME).mockResolvedValueOnce(erroPagina(429));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch)).rejects.toThrow(/429/);
  });

  it('fetch que lança → rejeita', async () => {
    const f = vi.fn().mockResolvedValueOnce(ME).mockRejectedValueOnce(new Error('rede caiu'));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch)).rejects.toThrow('rede caiu');
  });

  it('páginas sobrepostas (id 50 nas duas páginas, 69 únicos com total:70) → rejeita', async () => {
    const p1 = faixa(1, 51); // 1..50
    const p2 = faixa(50, 70); // 50..69 (50 repetido)
    const f = vi.fn()
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce(pagina(p1, 70))
      .mockResolvedValueOnce(pagina(p2, 70));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch))
      .rejects.toThrow(/cobertura incompleta/);
  });

  it('página que omite um id (total 70, chegam 69 únicos) → rejeita', async () => {
    const p1 = faixa(1, 51); // 1..50
    const p2 = faixa(51, 70); // 51..69 (falta o 70º id, ex.: 70)
    const f = vi.fn()
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce(pagina(p1, 70))
      .mockResolvedValueOnce(pagina(p2, 70));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch))
      .rejects.toThrow(/cobertura incompleta/);
  });

  it('total da 1ª página 70 e da última 71 → rejeita', async () => {
    const p1 = faixa(1, 51); // 1..50
    const p2 = faixa(51, 72); // 51..71 (21 itens, página afirma total 71)
    const f = vi.fn()
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce(pagina(p1, 70))
      .mockResolvedValueOnce(pagina(p2, 71));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch))
      .rejects.toThrow(/total mudou/);
  });

  it(`total: ${TETO_PEDIDOS_JANELA + 1} → rejeita`, async () => {
    const f = vi.fn().mockResolvedValueOnce(ME).mockResolvedValueOnce(pagina([], TETO_PEDIDOS_JANELA + 1));
    await expect(buscarPedidosPeriodoEstrito('tok', intervalo, f as unknown as typeof fetch))
      .rejects.toThrow(new RegExp(String(TETO_PEDIDOS_JANELA)));
  });
});

// ─── buscarMensagensPackEstrito ────────────────────────────────────────────

describe('buscarMensagensPackEstrito', () => {
  const msgs: MensagemML[] = [{ id: 'm1', text: 'oi' }];

  it('200 → parseado', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: msgs }) });
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .resolves.toEqual(msgs);
  });

  it('404 → []', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .resolves.toEqual([]);
  });

  it('403 → []', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .resolves.toEqual([]);
  });

  it('429 → rejeita', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'too many' });
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .rejects.toThrow(/429/);
  });

  it('500 → rejeita', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .rejects.toThrow(/500/);
  });

  it('rede (fetch lança) → rejeita', async () => {
    const f = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(buscarMensagensPackEstrito('tok', 'pack-1', 'seller-1', f as unknown as typeof fetch))
      .rejects.toThrow('network down');
  });
});

// ─── upsertMensagensEstrito ─────────────────────────────────────────────────

describe('upsertMensagensEstrito', () => {
  const META = {
    orderId: null, itemId: null, itemTitulo: null, compradorNome: null, compradorNick: null, orderStatus: null,
  };
  const msg: MensagemML = {
    id: 'm1', from: { user_id: 111 }, to: { user_id: 999 }, text: 'oi', message_date: { created: '2026-01-01T00:00:00Z' },
  };

  function criarAdmin(err1: { message: string } | null, err2: { message: string } | null) {
    let chamada = 0;
    const upsert = vi.fn(() => {
      chamada++;
      if (chamada === 1) {
        return { select: vi.fn().mockResolvedValue({ data: err1 ? null : [{ message_id: 'm1', direcao: 'recebida' }], error: err1 }) };
      }
      return Promise.resolve({ data: null, error: err2 });
    });
    const from = vi.fn(() => ({ upsert }));
    return { admin: { from } as unknown as Parameters<typeof upsertMensagensEstrito>[0], upsert };
  }

  it('error no 1º upsert → rejeita', async () => {
    const { admin } = criarAdmin({ message: 'falha1' }, null);
    await expect(upsertMensagensEstrito(admin, 'u1', 'org1', 'pack1', META, 999, [msg])).rejects.toThrow('falha1');
  });

  it('error no 2º upsert → rejeita', async () => {
    const { admin } = criarAdmin(null, { message: 'falha2' });
    await expect(upsertMensagensEstrito(admin, 'u1', 'org1', 'pack1', META, 999, [msg])).rejects.toThrow('falha2');
  });

  it('sem erro → mesmo novasRecebidas de upsertMensagens', async () => {
    const { admin } = criarAdmin(null, null);
    await expect(upsertMensagensEstrito(admin, 'u1', 'org1', 'pack1', META, 999, [msg]))
      .resolves.toEqual({ novasRecebidas: 1 });
  });
});

// ─── listarPacksDeVendasEstrito ─────────────────────────────────────────────

describe('listarPacksDeVendasEstrito', () => {
  function criarAdmin(data: unknown, error: { message: string } | null) {
    const limit = vi.fn().mockResolvedValue({ data, error });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { from } as unknown as Parameters<typeof listarPacksDeVendasEstrito>[0];
  }

  it('error → rejeita', async () => {
    const admin = criarAdmin(null, { message: 'database unavailable' });
    await expect(listarPacksDeVendasEstrito(admin, 'user-1')).rejects.toThrow('database unavailable');
  });

  it('sem erro → mesmo mapeamento de listarPacksDeVendas', async () => {
    const admin = criarAdmin([
      { order_id: 1, pack_id: null, status: 'paid', comprador_nome: 'Maria', comprador_nick: 'maria01', ml_vendas_itens: [{ ml_item_id: 'MLB1', titulo: 'Produto' }] },
    ], null);
    await expect(listarPacksDeVendasEstrito(admin, 'user-1')).resolves.toEqual([
      { packId: '1', orderId: '1', itemId: 'MLB1', itemTitulo: 'Produto', compradorNome: 'Maria', compradorNick: 'maria01', orderStatus: 'paid' },
    ]);
  });
});
