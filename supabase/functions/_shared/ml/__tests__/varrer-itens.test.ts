// Varredura de anúncios do seller (incidente 2026-09-10). O que estes testes travam: a paginação
// para quando cobre o total, `truncado` denuncia conta maior que o teto do ML, e o multiget ignora
// item que o ML não devolveu com 200 — tratar erro como ausência viraria "órfão" falso.
import { describe, it, expect, vi } from 'vitest';
import { listarIdsDoSeller, detalharItens, classificar } from '../varrer-itens';

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
      { code: 200, body: { id: 'MLB1', title: 'Kit 2 Un', status: 'active', permalink: 'http://x', available_quantity: 25, seller_custom_field: '00000099', catalog_listing: false } },
      { code: 404, body: { id: 'MLB2' } },
    ]));
    const r = await detalharItens(fetchMock as never, 'tok', ['MLB1', 'MLB2']);
    expect(r).toEqual([{
      id: 'MLB1', titulo: 'Kit 2 Un', status: 'active',
      permalink: 'http://x', estoque: 25, sku: '00000099', catalogo: false,
    }]);
  });

  it('quebra a consulta em blocos (multiget do ML tem limite por chamada)', async () => {
    const fetchMock = vi.fn(() => resp([]));
    await detalharItens(fetchMock as never, 'tok', Array.from({ length: 45 }, (_, i) => `MLB${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(3); // 20 + 20 + 5
  });
});

// Falso alarme de 2026-09-10: reportei 13 "anúncios fantasmas" ao operador e 10 eram anúncios de
// CATÁLOGO saudáveis — o ML cria um item próprio a partir do anúncio do app e ele HERDA o mesmo
// `seller_custom_field`. Classificar por sku sozinho não separa os dois; `catalog_listing` separa.
describe('classificar', () => {
  const item = (over: Partial<Parameters<typeof classificar>[0]> = {}) => ({
    id: 'MLB1', titulo: 't', status: 'active', permalink: null, estoque: 1,
    sku: '00000083', catalogo: false, ...over,
  });

  it('código do app + não-catálogo = saiu do app e perdeu o vínculo (o caso acionável)', () => {
    expect(classificar(item())).toBe('perdido_do_app');
  });

  it('código do app + catalog_listing = anúncio de catálogo, NUNCA "fantasma"', () => {
    expect(classificar(item({ catalogo: true }))).toBe('catalogo_sem_vinculo');
  });

  it('sem código no formato do app = nunca foi do PubliAI (os 307 do ERP antigo)', () => {
    expect(classificar(item({ sku: null }))).toBe('externo');
    expect(classificar(item({ sku: 'ABC-123' }))).toBe('externo');
    expect(classificar(item({ sku: '123' }))).toBe('externo');
  });

  it('espaço em volta do código não muda a classe', () => {
    expect(classificar(item({ sku: '  00000083 ' }))).toBe('perdido_do_app');
  });
});
