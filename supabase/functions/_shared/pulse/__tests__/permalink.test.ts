import { describe, expect, it, vi } from 'vitest';
import { enrichPulsePermalinks } from '../permalink.ts';

interface OfertaTeste {
  item_id: string;
  permalink: string | null;
}

const oferta = (item_id: string, permalink: string | null = null): OfertaTeste => ({ item_id, permalink });

function respostaMultiget(ids: string[], semResposta: string[] = []) {
  return new Response(JSON.stringify(ids.map((id) => (
    semResposta.includes(id)
      ? { code: 404, body: { id } }
      : { code: 200, body: { id, permalink: `https://produto.mercadolivre.com.br/${id}` } }
  ))), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('enrichPulsePermalinks', () => {
  it('consulta 41 IDs ausentes em lotes de 20, deduplica e aceita envelopes code/body', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB-${String(i + 1).padStart(2, '0')}`);
    const ofertas = [...ids.map((id) => oferta(id)), oferta(ids[0]), oferta('MLB-CONHECIDO', 'https://ml.existente/MLB-CONHECIDO')];
    const chamadas: string[][] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const lote = url.searchParams.get('ids')?.split(',') ?? [];
      chamadas.push(lote);
      return respostaMultiget(lote, ['MLB-41']);
    });

    const resultado = await enrichPulsePermalinks(ofertas, fetcher);

    expect(chamadas).toHaveLength(3);
    expect(chamadas.every((lote) => lote.length <= 20)).toBe(true);
    expect(chamadas.flat()).toHaveLength(41);
    expect(new Set(chamadas.flat()).size).toBe(41);
    expect(resultado.find((o) => o.item_id === 'MLB-01')?.permalink).toBe('https://produto.mercadolivre.com.br/MLB-01');
    expect(resultado.find((o) => o.item_id === 'MLB-41')?.permalink).toBeNull();
    expect(resultado.find((o) => o.item_id === 'MLB-CONHECIDO')?.permalink).toBe('https://ml.existente/MLB-CONHECIDO');
  });

  it('tolera falha parcial de um lote e continua enriquecendo os demais', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB-PARTIAL-${i + 1}`);
    let chamada = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      chamada += 1;
      if (chamada === 2) throw new Error('ML indisponível neste lote');
      const url = new URL(String(input));
      const lote = url.searchParams.get('ids')?.split(',') ?? [];
      return respostaMultiget(lote);
    });

    const resultado = await enrichPulsePermalinks(ids.map((id) => oferta(id)), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(resultado.find((o) => o.item_id === ids[0])?.permalink).toContain(ids[0]);
    expect(resultado.find((o) => o.item_id === ids[20])?.permalink).toBeNull();
    expect(resultado.find((o) => o.item_id === ids[40])?.permalink).toContain(ids[40]);
  });

  it('preserva permalink anterior quando a API não retorna link ou falha, mas aceita link novo', async () => {
    const resultadoSemLink = await enrichPulsePermalinks(
      [oferta('MLB-SEM-LINK'), oferta('MLB-NOVO')],
      async () => respostaMultiget(['MLB-SEM-LINK', 'MLB-NOVO'], ['MLB-SEM-LINK']),
      new Map([
        ['MLB-SEM-LINK', 'https://ml.existente/MLB-SEM-LINK'],
        ['MLB-NOVO', 'https://ml.existente/MLB-NOVO'],
      ]),
    );

    expect(resultadoSemLink.find((o) => o.item_id === 'MLB-SEM-LINK')?.permalink).toBe(
      'https://ml.existente/MLB-SEM-LINK',
    );
    expect(resultadoSemLink.find((o) => o.item_id === 'MLB-NOVO')?.permalink).toBe(
      'https://produto.mercadolivre.com.br/MLB-NOVO',
    );

    const resultadoComErro = await enrichPulsePermalinks(
      [oferta('MLB-ERRO')],
      async () => {
        throw new Error('ML indisponível');
      },
      new Map([['MLB-ERRO', 'https://ml.existente/MLB-ERRO']]),
    );

    expect(resultadoComErro[0].permalink).toBe('https://ml.existente/MLB-ERRO');
  });
});
