import { describe, expect, it, vi } from 'vitest';
import { oferta } from '../../operacoes/reajuste/ofertas';
import type { OfertaVigente } from '../../operacoes/reajuste/tipos';
import { alvosPorSku, lerPrecosVivos, montarAlvo, recusasPorOferta, type DepsTravaOferta } from '../trava-oferta';

// A cadeia real de ofertasBanco puxa npm:qstash; a do token, Deno.
vi.mock('../../queue.ts', () => ({}));
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));

const INCONCLUSIVA = 'Não foi possível conferir promoções — tente de novo';
const motivoOferta = (valor: string) => `Preço igual ou abaixo da oferta de R$ ${valor} — ajuste a oferta antes`;

const deal = (preco: number | null, id = 'P1'): OfertaVigente =>
  oferta({ promocao_id: id, tipo: 'DEAL', status: 'started', preco, offer_id: null, inicio: null, fim: null });

function deps(vivos: Record<string, number | null>, over: Partial<DepsTravaOferta> = {}) {
  return {
    precosVivos: vi.fn(async () => new Map(Object.entries(vivos))),
    lerOfertas: vi.fn(async (): Promise<OfertaVigente[] | null> => []),
    ofertasBanco: vi.fn(async (ids: string[]) => new Map(ids.map((id): [string, OfertaVigente[]] => [id, []]))),
    ...over,
  };
}
const alvo = (familia_id: string, ...itens: [string, number][]) => ({
  familia_id, itens: itens.map(([ml_item_id, preco]) => ({ ml_item_id, preco })),
});

describe('recusasPorOferta', () => {
  it('preço novo igual ou maior que o vivo não lê ofertas e não recusa', async () => {
    const d = deps({ MLB1: 100, MLB2: 100 });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 100], ['MLB2', 120])], d)).toEqual([]);
    expect(d.lerOfertas).not.toHaveBeenCalled();
    expect(d.ofertasBanco).not.toHaveBeenCalled();
  });

  it('preço novo abaixo do vivo e acima da oferta não recusa', async () => {
    const d = deps({ MLB1: 100 }, { lerOfertas: vi.fn(async () => [deal(80)]) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], d)).toEqual([]);
  });

  it('preço novo abaixo do vivo e igual ou abaixo da oferta recusa com o valor da oferta', async () => {
    const d = deps({ MLB1: 100, MLB2: 100 }, { lerOfertas: vi.fn(async () => [deal(80.5)]) });
    expect(await recusasPorOferta([alvo('igual', ['MLB1', 80.5]), alvo('abaixo', ['MLB2', 70])], d)).toEqual([
      { familia_id: 'igual', motivo: motivoOferta('80,50') },
      { familia_id: 'abaixo', motivo: motivoOferta('80,50') },
    ]);
  });

  it('oferta só no banco recusa', async () => {
    const d = deps({ MLB1: 100 }, { ofertasBanco: vi.fn(async () => new Map([['MLB1', [deal(80)]]])) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 80])], d)).toEqual([{ familia_id: 'f1', motivo: motivoOferta('80,00') }]);
  });

  it('lerOfertas null recusa como inconclusiva', async () => {
    const d = deps({ MLB1: 100 }, { lerOfertas: vi.fn(async () => null) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], d)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
  });

  it('oferta sem preço recusa como inconclusiva', async () => {
    const d = deps({ MLB1: 100 }, { lerOfertas: vi.fn(async () => [deal(null)]) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], d)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
  });

  it('preço vivo nulo recusa como inconclusiva', async () => {
    const d = deps({ MLB1: null });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], d)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
    expect(d.lerOfertas).not.toHaveBeenCalled();
  });

  it('item fora da resposta de preços recusa só a família dele', async () => {
    const d = deps({ MLB1: 100 });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 100]), alvo('f2', ['MLB2', 100])], d))
      .toEqual([{ familia_id: 'f2', motivo: INCONCLUSIVA }]);
  });

  it('2 famílias, 1 reprovada: só ela volta', async () => {
    const d = deps({ MLB1: 100, MLB2: 100 }, {
      lerOfertas: vi.fn(async (id: string) => (id === 'MLB1' ? [deal(80)] : [])),
    });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 70]), alvo('f2', ['MLB2', 70])], d))
      .toEqual([{ familia_id: 'f1', motivo: motivoOferta('80,00') }]);
  });

  it('família com 2 MLBs reprovados vira 1 recusa', async () => {
    const d = deps({ MLB1: 100, MLB2: 100 }, { lerOfertas: vi.fn(async () => [deal(80)]) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 70], ['MLB2', 70])], d)).toHaveLength(1);
  });

  it('família com 2 MLBs, 1 reprovado: 1 recusa', async () => {
    const d = deps({ MLB1: 100, MLB2: 100 }, {
      lerOfertas: vi.fn(async (id: string) => (id === 'MLB2' ? [deal(80)] : [])),
    });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 70], ['MLB2', 70])], d))
      .toEqual([{ familia_id: 'f1', motivo: motivoOferta('80,00') }]);
  });

  it('cada MLB compara com o preço do próprio item', async () => {
    const d = deps({ MLB1: 100, MLB2: 50 }, { lerOfertas: vi.fn(async () => [deal(80)]) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90], ['MLB2', 40])], d)).toEqual([{ familia_id: 'f1', motivo: motivoOferta('80,00') }]);
    expect(d.lerOfertas).toHaveBeenCalledTimes(2);
  });

  it('exceção em precosVivos recusa as famílias como inconclusivas, sem lançar', async () => {
    const d = deps({}, { precosVivos: vi.fn(async () => { throw new Error('fora do ar'); }) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90]), alvo('f2', ['MLB2', 90])], d)).toEqual([
      { familia_id: 'f1', motivo: INCONCLUSIVA },
      { familia_id: 'f2', motivo: INCONCLUSIVA },
    ]);
  });

  it('exceção em lerOfertas ou ofertasBanco não lança', async () => {
    const a = deps({ MLB1: 100 }, { lerOfertas: vi.fn(async () => { throw new Error('x'); }) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], a)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
    const b = deps({ MLB1: 100 }, { ofertasBanco: vi.fn(async () => { throw new Error('x'); }) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], b)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
  });

  it('orçamento vencido no meio: conferidas seguem a regra, não conferidas recusam, e resolve dentro do orçamento', async () => {
    const trava = new Promise<null>(() => {});
    const iniciadas: string[] = [];
    const d = deps(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`MLB${i}`, 100])), {
      lerOfertas: vi.fn((id: string) => {
        iniciadas.push(id);
        return id === 'MLB0' ? Promise.resolve([deal(50)]) : trava;
      }),
    });
    const alvos = Array.from({ length: 8 }, (_, i) => alvo(`f${i}`, [`MLB${i}`, 90]));
    const inicio = Date.now();
    const r = await recusasPorOferta(alvos, d, 60);
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(r.map((x) => x.familia_id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
    expect(new Set(r.map((x) => x.motivo))).toEqual(new Set([INCONCLUSIVA]));
    // 5 em paralelo: a vaga do MLB0 pega o MLB5; as demais travam até o orçamento e nada novo começa.
    expect(iniciadas).toEqual(['MLB0', 'MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5']);
  });

  it('precosVivos travado não passa do orçamento', async () => {
    const d = deps({}, { precosVivos: vi.fn(() => new Promise<Map<string, number | null>>(() => {})) });
    expect(await recusasPorOferta([alvo('f1', ['MLB1', 90])], d, 30)).toEqual([{ familia_id: 'f1', motivo: INCONCLUSIVA }]);
  });

  it('sem alvos não consulta nada', async () => {
    const d = deps({});
    expect(await recusasPorOferta([], d)).toEqual([]);
    expect(d.precosVivos).not.toHaveBeenCalled();
  });
});

describe('montagem dos alvos', () => {
  const FAMILIA = { id: 'f1', ml_item_id: 'MLB-F' };
  const v = (codigo: string, preco_publicacao: number | string | null) => ({ codigo, preco_publicacao });
  const linha = (particao: number, item_externo_id: string | null, ...skus: string[]) => ({
    particao, item_externo_id, variacoes_externas: Object.fromEntries(skus.map((s) => [s, {}])),
  });
  const item = (sku: string, item_externo_id: string | null) => ({ sku, item_externo_id });

  it('Legacy sem linha em anuncios_externos: ml_item_id com o preço da família', () => {
    expect(montarAlvo(FAMILIA, [v('A', '50.00'), v('B', '50.00')], [], []))
      .toEqual({ familia_id: 'f1', itens: [{ ml_item_id: 'MLB-F', preco: 50 }] });
  });

  it('Legacy com 1 linha: ml_item_id da família, mesmo com mapa vazio', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50)], [linha(0, 'MLB-OUTRO')], []))
      .toEqual({ familia_id: 'f1', itens: [{ ml_item_id: 'MLB-F', preco: 50 }] });
  });

  it('Legacy com cor nova mais barata: a cor nova não entra no anúncio publicado', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50), v('NOVA', 10)], [linha(0, 'MLB-F', 'A')], []).itens)
      .toEqual([{ ml_item_id: 'MLB-F', preco: 50 }]);
  });

  it('Legacy sem preço: sem alvo', () => {
    expect(montarAlvo(FAMILIA, [v('A', null)], [], []).itens).toEqual([]);
  });

  it('UP: um alvo por item, com o preço da cor, qualquer que seja o status do filho', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50), v('B', 60)], [linha(0, null)], [item('A', 'MLB1'), item('B', 'MLB2')]).itens)
      .toEqual([{ ml_item_id: 'MLB1', preco: 50 }, { ml_item_id: 'MLB2', preco: 60 }]);
  });

  it('UP: preço nulo, item sem id e item que sai da composição não entram', () => {
    expect(montarAlvo(FAMILIA, [v('A', null), v('B', 60), v('C', 70)], [linha(0, null)], [
      item('A', 'MLB1'), item('B', null), item('C', 'MLB3'), item('SAIU', 'MLB4'),
    ]).itens).toEqual([{ ml_item_id: 'MLB3', preco: 70 }]);
  });

  it('UP só com filhos reservados: sem alvo (o worker recusa)', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50)], [linha(0, null)], [item('A', null)]).itens).toEqual([]);
  });

  it('partições: um alvo por anúncio, com o menor preço das cores dele', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50), v('B', 40), v('C', 90), v('NOVA', 1)], [
      linha(0, 'MLB-P0', 'A', 'B'), linha(1, 'MLB-P1', 'C'),
    ], []).itens).toEqual([{ ml_item_id: 'MLB-P0', preco: 40 }, { ml_item_id: 'MLB-P1', preco: 90 }]);
  });

  it('partições: a 0 herda o ml_item_id; partição sem item ou sem cor incluída não entra', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50), v('C', 90)], [
      linha(0, null, 'A'), linha(1, null, 'C'), linha(2, 'MLB-P2', 'EXCLUIDA'),
    ], []).itens).toEqual([{ ml_item_id: 'MLB-F', preco: 50 }]);
  });

  it('partições vencem os itens UP: quem escreve é o split', () => {
    expect(montarAlvo(FAMILIA, [v('A', 50), v('C', 90)], [linha(0, 'MLB-P0', 'A'), linha(1, 'MLB-P1', 'C')], [item('A', 'MLB1')]).itens)
      .toEqual([{ ml_item_id: 'MLB-P0', preco: 50 }, { ml_item_id: 'MLB-P1', preco: 90 }]);
  });

  it('alvosPorSku: identifica o alvo pelo SKU', () => {
    expect(alvosPorSku([v('A', 50)], [item('A', 'MLB1')])).toEqual([{ familia_id: 'A', itens: [{ ml_item_id: 'MLB1', preco: 50 }] }]);
  });
});

describe('lerPrecosVivos', () => {
  const linha = (id: string, price: number | null, status = 'active') => ({ status_code: 200, body: { id, price, status } });
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

  it('lê em blocos de 20 pelo /items/bulk', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `MLB${i}`);
    const f = vi.fn(async (url: string) => {
      const pedidos = new URL(url).searchParams.get('ids')!.split(',');
      return resposta(pedidos.map((id) => linha(id, 10)));
    });
    const m = await lerPrecosVivos('tok', ids, f as never);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[0]![0])).toContain('/items/bulk?');
    expect(m.get('MLB24')).toBe(10);
  });

  it('encerrado, 404 e preço ausente ficam nulos', async () => {
    const f = vi.fn(async () => resposta([linha('MLB1', 10, 'closed'), { status_code: 404 }, linha('MLB3', null), linha('MLB4', 20, 'paused')]));
    const m = await lerPrecosVivos('tok', ['MLB1', 'MLB2', 'MLB3', 'MLB4'], f as never);
    expect([...m]).toEqual([['MLB1', null], ['MLB2', null], ['MLB3', null], ['MLB4', 20]]);
  });

  it('bloco com erro ou exceção deixa nulos só os itens dele', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB${i}`);
    const f = vi.fn(async (url: string) => {
      const pedidos = new URL(url).searchParams.get('ids')!.split(',');
      if (pedidos.includes('MLB0')) return resposta({ message: 'limite' }, 429);
      if (pedidos.includes('MLB20')) throw new Error('rede');
      return resposta(pedidos.map((id) => linha(id, 10)));
    });
    const m = await lerPrecosVivos('tok', ids, f as never);
    expect(m.get('MLB0')).toBeNull();
    expect(m.get('MLB20')).toBeNull();
    expect(m.get('MLB40')).toBe(10);
  });
});
