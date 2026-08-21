import { describe, expect, it, vi } from 'vitest';
import type { OfertaVendedor } from '../../concorrencia/tipos.ts';
import type { PerfilVendedor } from '../../ml/perfil-vendedor.ts';
import { criarBuscasMercadoRelevante, resolverMercadoRelevante } from '../mercado-relevante.ts';

const AGORA = new Date('2026-08-21T12:00:00.000Z');

type LinhaOfertaPulse = {
  item_id: string;
  seller_id: number;
  visitas_30d: number | null;
  visitas_30d_em: string | null;
};

type LinhaVendedorPulse = {
  seller_id: number;
  transactions_total: number | null;
  nivel: string | null;
  perfil_coletado_em: string | null;
  dia: string;
};

type Chamada = {
  tabela: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
};

type ResultadoQuery = { data: unknown; error: null };

type Query = {
  select: (colunas: string) => Query;
  eq: (coluna: string, valor: unknown) => Query;
  in: (coluna: string, valores: unknown[]) => Query;
  order: (coluna: string, opcoes?: Record<string, unknown>) => Query;
  maybeSingle: () => Promise<ResultadoQuery>;
  then: <TResult1 = ResultadoQuery, TResult2 = never>(
    onfulfilled?: ((value: ResultadoQuery) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

function dbPulse({
  produto = null,
  ofertas = [],
  vendedores = [],
}: {
  produto?: { id: string; ultimo_snapshot_em: string | null } | null;
  ofertas?: LinhaOfertaPulse[];
  vendedores?: LinhaVendedorPulse[];
} = {}) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string): Query {
      const chamada: Chamada = { tabela, eq: [], in: [] };
      chamadas.push(chamada);
      const resultado = (): ResultadoQuery => ({
        data: tabela === 'pulse_ofertas_atual'
          ? ofertas
          : tabela === 'pulse_vendedores'
            ? vendedores
            : null,
        error: null,
      });
      const query: Query = {
        select: () => query,
        eq: (coluna, valor) => {
          chamada.eq.push([coluna, valor]);
          return query;
        },
        in: (coluna, valores) => {
          chamada.in.push([coluna, valores]);
          return query;
        },
        order: () => query,
        maybeSingle: async () => ({ data: produto, error: null }),
        then: (onfulfilled, onrejected) => Promise.resolve(resultado()).then(onfulfilled, onrejected),
      };
      return query;
    },
  };
  return { db, chamadas };
}

function perfil(sellerId: number, transactions: number, nivel: string | null = '3_yellow'): PerfilVendedor {
  return {
    seller_id: sellerId,
    nickname: null,
    nivel,
    power_seller: null,
    transactions_total: transactions,
    uf: null,
    detalhe: {
      transactions: {
        period: null,
        total: transactions,
        completed: null,
        canceled: null,
        ratings: { positive: null, neutral: null, negative: null },
      },
      metrics: {},
    },
  };
}

const oferta = (itemId: string, sellerId: number, preco: number): OfertaVendedor => ({
  item_id: itemId,
  seller_id: sellerId,
  preco,
  frete_gratis: true,
  full: true,
});

describe('resolverMercadoRelevante', () => {
  it('usa apenas dados Pulse frescos da mesma organização e qualifica o mercado atual', async () => {
    const { db, chamadas } = dbPulse({
      produto: { id: 'pulse-1', ultimo_snapshot_em: '2026-08-21T11:00:00.000Z' },
      ofertas: [
        { item_id: 'MLB36', seller_id: 1, visitas_30d: 12, visitas_30d_em: '2026-08-21T11:00:00.000Z' },
        { item_id: 'MLB70', seller_id: 2, visitas_30d: null, visitas_30d_em: null },
      ],
      vendedores: [
        { seller_id: 1, transactions_total: 0, nivel: '3_yellow', perfil_coletado_em: '2026-08-21T11:00:00.000Z', dia: '2026-08-21' },
        { seller_id: 2, transactions_total: 1, nivel: '1_red', perfil_coletado_em: '2026-08-20T11:00:00.000Z', dia: '2026-08-20' },
      ],
    });
    const buscarPerfil = vi.fn(async (sellerId: number) => perfil(sellerId, 10));
    const buscarVisitas = vi.fn(async () => 4);

    const resultado = await resolverMercadoRelevante({
      db: db as never,
      orgId: 'org-a',
      productId: 'MCO123',
      ofertas: [oferta('MLB36', 1, 36), oferta('MLB70', 2, 70.19)],
      agora: AGORA,
      buscas: criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas }),
    });

    expect(resultado.menor).toBe(70.19);
    expect(resultado.maior).toBe(70.19);
    expect(resultado.observado.menor).toBe(36);
    expect(resultado.vendedores).toBe(1);
    expect(resultado.freteGratis).toBe(1);
    expect(resultado.full).toBe(1);
    expect(resultado.observado.vendedores).toBe(2);
    expect(resultado.ofertas).toBe(1);
    expect(resultado.observado.ofertas).toBe(2);
    expect(buscarPerfil).toHaveBeenCalledExactlyOnceWith(2);
    expect(buscarVisitas).toHaveBeenCalledExactlyOnceWith('MLB70');

    for (const tabela of ['pulse_produtos', 'pulse_ofertas_atual', 'pulse_vendedores']) {
      const chamada = chamadas.find((atual) => atual.tabela === tabela);
      expect(chamada?.eq).toContainEqual(['org_id', 'org-a']);
    }
  });

  it('mantém o observado e não usa snapshot vencido quando todas as buscas falham', async () => {
    const { db } = dbPulse({
      produto: { id: 'pulse-antigo', ultimo_snapshot_em: '2026-08-20T11:59:59.999Z' },
      ofertas: [
        { item_id: 'MLB36', seller_id: 1, visitas_30d: 12, visitas_30d_em: '2026-08-21T11:00:00.000Z' },
      ],
      vendedores: [
        { seller_id: 1, transactions_total: 100, nivel: '5_green', perfil_coletado_em: '2026-08-21T11:00:00.000Z', dia: '2026-08-21' },
      ],
    });
    const buscarPerfil = vi.fn(async () => null);
    const buscarVisitas = vi.fn(async () => null);

    const resultado = await resolverMercadoRelevante({
      db: db as never,
      orgId: 'org-a',
      productId: 'MCO123',
      ofertas: [oferta('MLB36', 1, 36), oferta('MLB80', 2, 80)],
      agora: AGORA,
      buscas: criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas }),
    });

    expect(resultado).toMatchObject({
      menor: null,
      maior: null,
      vendedores: 0,
      ofertas: 0,
      observado: { menor: 36, maior: 80, vendedores: 2, ofertas: 2 },
    });
    expect(buscarPerfil).toHaveBeenCalledTimes(2);
    expect(buscarVisitas).toHaveBeenCalledTimes(2);
  });

  it('preserva o perfil fresco quando há um snapshot legado mais novo', async () => {
    const { db } = dbPulse({
      produto: { id: 'pulse-1', ultimo_snapshot_em: '2026-08-21T11:00:00.000Z' },
      ofertas: [
        { item_id: 'MLB70', seller_id: 2, visitas_30d: 4, visitas_30d_em: '2026-08-21T11:00:00.000Z' },
      ],
      vendedores: [
        { seller_id: 2, transactions_total: 10, nivel: '3_yellow', perfil_coletado_em: '2026-08-20T12:01:00.000Z', dia: '2026-08-20' },
        { seller_id: 2, transactions_total: 0, nivel: '1_red', perfil_coletado_em: null, dia: '2026-08-21' },
      ],
    });
    const buscarPerfil = vi.fn(async (sellerId: number) => perfil(sellerId, 0, '1_red'));
    const buscarVisitas = vi.fn(async () => 0);

    const resultado = await resolverMercadoRelevante({
      db: db as never,
      orgId: 'org-a',
      productId: 'MCO123',
      ofertas: [oferta('MLB70', 2, 70.19)],
      agora: AGORA,
      buscas: criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas }),
    });

    expect(buscarPerfil).not.toHaveBeenCalled();
    expect(buscarVisitas).not.toHaveBeenCalled();
    expect(resultado.menor).toBe(70.19);
  });

  it('deduplica busca de perfil por vendedor e visitas por item', async () => {
    const { db } = dbPulse();
    const buscarPerfil = vi.fn(async (sellerId: number) => perfil(sellerId, 10));
    const buscarVisitas = vi.fn(async () => 3);

    const resultado = await resolverMercadoRelevante({
      db: db as never,
      orgId: 'org-a',
      productId: 'MCO123',
      ofertas: [oferta('MLB1', 1, 70), oferta('MLB1', 1, 71), oferta('MLB2', 1, 72)],
      agora: AGORA,
      buscas: criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas }),
    });

    expect(resultado.ofertas).toBe(3);
    expect(buscarPerfil).toHaveBeenCalledExactlyOnceWith(1);
    expect(buscarVisitas.mock.calls.map(([itemId]) => itemId).sort()).toEqual(['MLB1', 'MLB2']);
  });

  it('limita a seis as consultas paralelas de perfil e visita', async () => {
    const { db } = dbPulse();
    let emVoo = 0;
    let maximoEmVoo = 0;
    let sinalizarSeis: (() => void) | undefined;
    let liberar: (() => void) | undefined;
    const seisEmVoo = new Promise<void>((resolve) => { sinalizarSeis = resolve; });
    const bloqueio = new Promise<void>((resolve) => { liberar = resolve; });
    const buscarPerfil = vi.fn(async (sellerId: number) => {
      emVoo += 1;
      maximoEmVoo = Math.max(maximoEmVoo, emVoo);
      if (emVoo === 6) sinalizarSeis?.();
      await bloqueio;
      emVoo -= 1;
      return perfil(sellerId, 10);
    });
    const buscarVisitas = vi.fn(async () => 2);

    const resolucao = resolverMercadoRelevante({
      db: db as never,
      orgId: 'org-a',
      productId: 'MCO123',
      ofertas: Array.from({ length: 7 }, (_, indice) => oferta(`MLB${indice}`, indice, 70 + indice)),
      agora: AGORA,
      buscas: criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas }),
    });

    await seisEmVoo;
    expect(maximoEmVoo).toBe(6);
    liberar?.();
    await resolucao;
    expect(maximoEmVoo).toBe(6);
    expect(buscarPerfil).toHaveBeenCalledTimes(7);
    expect(buscarVisitas).toHaveBeenCalledTimes(7);
  });

  it('compartilha um único limite e dedupe entre os cinco itens do lote', async () => {
    let emVoo = 0;
    let maximoEmVoo = 0;
    let sinalizarSeis: (() => void) | undefined;
    let liberar: (() => void) | undefined;
    const seisEmVoo = new Promise<void>((resolve) => { sinalizarSeis = resolve; });
    const bloqueio = new Promise<void>((resolve) => { liberar = resolve; });
    const medir = async <T,>(valor: T): Promise<T> => {
      emVoo += 1;
      maximoEmVoo = Math.max(maximoEmVoo, emVoo);
      if (emVoo === 6) sinalizarSeis?.();
      await bloqueio;
      emVoo -= 1;
      return valor;
    };
    const buscarPerfil = vi.fn((sellerId: number) => medir(perfil(sellerId, 10)));
    const buscarVisitas = vi.fn((itemId: string) => medir(itemId.length));
    const buscas = criarBuscasMercadoRelevante({ buscarPerfil, buscarVisitas });

    const resolucoes = Array.from({ length: 5 }, (_, indice) => {
      const { db } = dbPulse();
      return resolverMercadoRelevante({
        db: db as never,
        orgId: 'org-a',
        productId: `MCO${indice}`,
        ofertas: [
          oferta('MLB-COMPARTILHADO', 1, 70.19),
          oferta(`MLB-${indice}`, 10 + indice, 71 + indice),
        ],
        agora: AGORA,
        buscas,
      });
    });

    await seisEmVoo;
    expect(maximoEmVoo).toBeLessThanOrEqual(6);
    liberar?.();
    await Promise.all(resolucoes);

    expect(maximoEmVoo).toBeLessThanOrEqual(6);
    expect(buscarPerfil).toHaveBeenCalledTimes(6);
    expect(buscarPerfil.mock.calls.filter(([sellerId]) => sellerId === 1)).toHaveLength(1);
    expect(buscarVisitas).toHaveBeenCalledTimes(6);
    expect(buscarVisitas.mock.calls.filter(([itemId]) => itemId === 'MLB-COMPARTILHADO')).toHaveLength(1);
  });
});
