import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisGet, redisSet } from '../../redis/client.ts';
import { buscarVisitas30d } from '../visitas-item.ts';

vi.mock('../../redis/client.ts', () => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

const redisGetMock = vi.mocked(redisGet);
const redisSetMock = vi.mocked(redisSet);
const fetchMock = vi.fn();

beforeEach(() => {
  redisGetMock.mockReset();
  redisSetMock.mockReset();
  redisSetMock.mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('buscarVisitas30d', () => {
  it('devolve zero salvo no cache sem consultar o Mercado Livre', async () => {
    redisGetMock.mockResolvedValue('0');

    await expect(buscarVisitas30d('token', 'MLB123')).resolves.toBe(0);
    expect(redisGetMock).toHaveBeenCalledWith('cache:item-visits30d:v1:MLB123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta a janela de 30 dias e cacheia o total numérico por seis horas', async () => {
    redisGetMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total_visits: 42 }),
    });

    await expect(buscarVisitas30d('token', 'MLB123')).resolves.toBe(42);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.mercadolibre.com/items/MLB123/visits/time_window?last=30&unit=day',
    );
    expect(redisSetMock).toHaveBeenCalledWith('cache:item-visits30d:v1:MLB123', '42', 6 * 60 * 60);
  });

  it('cacheia zero retornado pelo Mercado Livre', async () => {
    redisGetMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total_visits: 0 }),
    });

    await expect(buscarVisitas30d('token', 'MLB123')).resolves.toBe(0);
    expect(redisSetMock).toHaveBeenCalledWith('cache:item-visits30d:v1:MLB123', '0', 6 * 60 * 60);
  });

  it('falha de leitura ou total inválido devolve null e não grava cache', async () => {
    redisGetMock.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce({ ok: false });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ total_visits: '42' }),
    });

    await expect(buscarVisitas30d('token', 'MLB123')).resolves.toBeNull();
    await expect(buscarVisitas30d('token', 'MLB456')).resolves.toBeNull();
    expect(redisSetMock).not.toHaveBeenCalled();
  });
});
