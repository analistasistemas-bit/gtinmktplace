// Varredura de anúncios do seller (incidente 2026-09-10). O que estes testes travam: a paginação
// para quando cobre o total, `truncado` denuncia conta maior que o teto do ML, e o multiget ignora
// item que o ML não devolveu com 200 — tratar erro como ausência viraria "órfão" falso.
import { describe, it, expect, vi } from 'vitest';
import { listarIdsDoSeller, detalharItens } from '../varrer-itens';

const resp = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

describe('listarIdsDoSeller', () => {
  it('para de paginar quando já cobriu o total e não marca truncado', async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(resp({ results: ['MLB1', 'MLB2'], paging: { total: 2 } }));
    const r = await listarIdsDoSeller(fetchMock as never, 'tok', '9757132', 'active');
    expect(r.ids).toEqual(['MLB1', 'MLB2']);
    expect(r.truncado).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('conta acima do teto do search marca truncado (o operador precisa saber que foi parcial)', async () => {
    // 10 páginas cheias de 100, com total declarado maior: é o cenário do limite de 1000 do ML.
    const fetchMock = vi.fn(() => resp({
      results: Array.from({ length: 100 }, (_, i) => `MLB${i}`),
      paging: { total: 5000 },
    }));
    const r = await listarIdsDoSeller(fetchMock as never, 'tok', '9757132', 'active');
    expect(r.truncado).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('passa o status pedido na URL (active e paused são varridos separados)', async () => {
    const fetchMock = vi.fn(() => resp({ results: [], paging: { total: 0 } }));
    await listarIdsDoSeller(fetchMock as never, 'tok', '9757132', 'paused');
    expect(String(fetchMock.mock.calls[0][0])).toContain('status=paused');
  });

  it('erro do ML lança em vez de devolver lista vazia — vazio viraria "nenhum órfão"', async () => {
    const fetchMock = vi.fn(() => resp({}, false, 500));
    await expect(listarIdsDoSeller(fetchMock as never, 'tok', '9757132', 'active')).rejects.toThrow(/500/);
  });
});

describe('detalharItens', () => {
  it('mapeia os campos que a tela usa e ignora entrada sem code 200', async () => {
    const fetchMock = vi.fn(() => resp([
      { code: 200, body: { id: 'MLB1', title: 'Kit 2 Un', status: 'active', permalink: 'http://x', available_quantity: 25, seller_custom_field: '00000099' } },
      { code: 404, body: { id: 'MLB2' } },
    ]));
    const r = await detalharItens(fetchMock as never, 'tok', ['MLB1', 'MLB2']);
    expect(r).toEqual([{
      id: 'MLB1', titulo: 'Kit 2 Un', status: 'active',
      permalink: 'http://x', estoque: 25, sku: '00000099',
    }]);
  });

  it('quebra a consulta em blocos (multiget do ML tem limite por chamada)', async () => {
    const fetchMock = vi.fn(() => resp([]));
    await detalharItens(fetchMock as never, 'tok', Array.from({ length: 45 }, (_, i) => `MLB${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(3); // 20 + 20 + 5
  });
});
