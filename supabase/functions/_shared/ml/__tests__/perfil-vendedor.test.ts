import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisGet, redisSet } from '../../redis/client.ts';
import { buscarPerfilVendedor, normalizarPerfilVendedor } from '../perfil-vendedor.ts';

vi.mock('../../redis/client.ts', () => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

const redisGetMock = vi.mocked(redisGet);
const redisSetMock = vi.mocked(redisSet);
const fetchMock = vi.fn();

const perfilEmCache = {
  seller_id: 123,
  nickname: 'LOJA',
  nivel: '5_green',
  power_seller: 'platinum',
  transactions_total: 120,
  uf: 'PE',
  detalhe: {
    transactions: {
      period: '60 days',
      total: 120,
      completed: 118,
      canceled: 2,
      ratings: { positive: 0.98, neutral: 0.01, negative: 0.01 },
    },
    metrics: { claims: { rate: 0.01, value: 1 } },
  },
};

beforeEach(() => {
  redisGetMock.mockReset();
  redisSetMock.mockReset();
  redisSetMock.mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('normalizarPerfilVendedor', () => {
  it('normaliza seller_reputation aninhada', () => {
    const perfil = normalizarPerfilVendedor({
      id: 123,
      nickname: 'LOJA',
      seller_reputation: {
        level_id: '5_green',
        power_seller_status: 'platinum',
        transactions: {
          period: '60 days',
          total: 120,
          completed: 118,
          canceled: 2,
          ratings: { positive: 0.98, neutral: 0.01, negative: 0.01 },
        },
        metrics: { claims: { rate: 0.01, value: 1 } },
      },
    });

    expect(perfil?.nivel).toBe('5_green');
    expect(perfil?.power_seller).toBe('platinum');
    expect(perfil?.transactions_total).toBe(120);
    expect(perfil?.detalhe.transactions.period).toBe('60 days');
  });

  it('canoniza a UF vinda de address.state objeto ou string', () => {
    const base = {
      id: 123,
      seller_reputation: { transactions: { total: 120 } },
    };

    expect(normalizarPerfilVendedor({ ...base, address: { state: { id: 'BR-pe' } } })?.uf).toBe('PE');
    expect(normalizarPerfilVendedor({ ...base, address: { state: 'br-sp' } })?.uf).toBe('SP');
  });

  it('UF inválida vira null', () => {
    const base = {
      id: 123,
      seller_reputation: { transactions: { total: 120 } },
    };

    expect(normalizarPerfilVendedor({ ...base, address: { state: { id: 'Pernambuco' } } })?.uf).toBeNull();
    expect(normalizarPerfilVendedor({ ...base, address: { state: 'BR-' } })?.uf).toBeNull();
  });

  it('não converte payload inválido em vendedor com zero vendas', () => {
    expect(normalizarPerfilVendedor(null)).toBeNull();
    expect(normalizarPerfilVendedor({ seller_reputation: {} })).toBeNull();
  });
});

describe('buscarPerfilVendedor', () => {
  it('devolve o perfil válido salvo no cache v2 sem consultar o Mercado Livre', async () => {
    redisGetMock.mockResolvedValue(JSON.stringify(perfilEmCache));

    await expect(buscarPerfilVendedor('token', 123)).resolves.toEqual(perfilEmCache);
    expect(redisGetMock).toHaveBeenCalledWith('cache:seller:v2:123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não grava cache quando o Mercado Livre falha', async () => {
    redisGetMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(buscarPerfilVendedor('token', 123)).resolves.toBeNull();
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it('descarta cache e payload inválidos sem cachear um vendedor com zero vendas', async () => {
    redisGetMock.mockResolvedValue(JSON.stringify({ lider: false, vendas: 0 }));
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 123,
        seller_reputation: { transactions: { total: '120' } },
      }),
    });

    await expect(buscarPerfilVendedor('token', 123)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it('normaliza e grava somente o perfil válido no cache v2 por 24 horas', async () => {
    redisGetMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 123,
        nickname: 'LOJA',
        address: { state: { id: 'BR-PE' } },
        seller_reputation: {
          level_id: '5_green',
          power_seller_status: 'platinum',
          transactions: {
            period: '60 days',
            total: 120,
            completed: 118,
            canceled: 2,
            ratings: { positive: 0.98, neutral: 0.01, negative: 0.01 },
          },
          metrics: { claims: { rate: 0.01, value: 1 } },
        },
      }),
    });

    await expect(buscarPerfilVendedor('token', 123)).resolves.toEqual(perfilEmCache);
    expect(redisSetMock).toHaveBeenCalledWith(
      'cache:seller:v2:123',
      JSON.stringify(perfilEmCache),
      60 * 60 * 24,
    );
  });
});
