import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agregarMercado, posicaoNoRanking } from '../mercado-agregar';
import { buscarPerfilVendedor } from '../perfil-vendedor.ts';
import { reputacaoVendedor } from '../mercado.ts';

vi.mock('../perfil-vendedor.ts', () => ({ buscarPerfilVendedor: vi.fn() }));
vi.mock('../token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }));

const buscarPerfilVendedorMock = vi.mocked(buscarPerfilVendedor);

beforeEach(() => {
  buscarPerfilVendedorMock.mockReset();
});

describe('agregarMercado', () => {
  it('conta líderes e pega a maior reputação de vendas', () => {
    const r = agregarMercado([
      { lider: true, vendas: 52665 },
      { lider: false, vendas: 3644 },
      { lider: true, vendas: 25853 },
    ]);
    expect(r).toEqual({ lideres: 2, maior_vendas: 52665 });
  });
  it('lista vazia → zeros', () => {
    expect(agregarMercado([])).toEqual({ lideres: 0, maior_vendas: 0 });
  });
});

describe('posicaoNoRanking', () => {
  const json = { content: [
    { id: 'MLBU1', position: 1, type: 'USER_PRODUCT' },
    { id: 'MLB38054475', position: 2, type: 'PRODUCT' },
    { id: 'MLB34175726', position: 7, type: 'PRODUCT' },
  ]};
  it('acha a posição do produto', () => {
    expect(posicaoNoRanking(json, 'MLB34175726')).toBe(7);
  });
  it('produto fora do ranking → null', () => {
    expect(posicaoNoRanking(json, 'MLB999')).toBe(null);
  });
  it('payload inválido → null', () => {
    expect(posicaoNoRanking(null, 'MLB1')).toBe(null);
    expect(posicaoNoRanking({}, 'MLB1')).toBe(null);
  });
});

describe('reputacaoVendedor', () => {
  it('adapta um perfil v2 válido para a API legada', async () => {
    buscarPerfilVendedorMock.mockResolvedValue({
      seller_id: 123,
      nickname: 'LOJA',
      nivel: '5_green',
      power_seller: 'platinum',
      transactions_total: 120,
      uf: 'BR-PE',
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
    });

    await expect(reputacaoVendedor('token', 123)).resolves.toEqual({ lider: true, vendas: 120 });
  });

  it('rejeita quando o perfil não está disponível', async () => {
    buscarPerfilVendedorMock.mockResolvedValue(null);

    await expect(reputacaoVendedor('token', 123)).rejects.toThrow();
  });
});
