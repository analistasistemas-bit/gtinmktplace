import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({
  buscarCampanhasAds: vi.fn(), buscarCodigosMlbs: vi.fn(),
  catQ: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/lib/ads-campanhas-dados', () => ({ buscarCampanhasAds: m.buscarCampanhasAds }));
vi.mock('@/lib/sku-dossie-dados', () => ({ buscarCodigosMlbs: m.buscarCodigosMlbs }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => m.catQ }));

const { useAdsCampanhas } = await import('../useAdsCampanhas');

const item = { status: 'active', subStatus: [], estoque: 3, preco: 10 };
const anuncio = (mlb: string) => ({ mlb, campanhaId: 1, grupoId: null, statusAds: 'active', catalogo: false, titulo: null,
  thumbnail: null, permalink: null, item, equilibrio: { acosPct: 20, motivo: null } });
const campanha = { id: 1, nome: 'C1', status: 'active', estrategia: null, roasObjetivo: null, acosObjetivo: null, orcamentoDiario: null };
const ok = (mlbs: string[]) => ({ ok: true, estado: 'ok', lidoEm: 'x', aliquotasConfirmadas: true, projecaoLimitada: false,
  publicadosPorFamilia: null, campanhas: [campanha], anuncios: mlbs.map(anuncio) });

function render(habilitado = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useAdsCampanhas(habilitado), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.catQ.data = [{ codigo: 'A1', codigoPai: 'P1', nomeFamilia: 'Fam' }];
  m.buscarCodigosMlbs.mockResolvedValue(new Map([['MLB1', ['A1']]]));
});

describe('useAdsCampanhas', () => {
  it('desabilitado não busca nada', () => {
    const { result } = render(false);
    expect(m.buscarCampanhasAds).not.toHaveBeenCalled();
    expect(result.current.campanhas).toBeNull();
  });

  it('estado ok: busca códigos e monta campanhas por família', async () => {
    m.buscarCampanhasAds.mockResolvedValue(ok(['MLB1']));
    const { result } = render();
    await waitFor(() => expect(result.current.campanhas).not.toBeNull());
    expect(m.buscarCampanhasAds).toHaveBeenCalledWith(false);
    expect(m.buscarCodigosMlbs).toHaveBeenCalledWith(['MLB1']);
    expect(result.current.campanhas![0].familias[0]).toMatchObject({ codigoPai: 'P1', nome: 'Fam' });
    expect(result.current.isLoading).toBe(false);
  });

  it('estado não-ok: campanhas [] e estado exposto, sem buscar códigos', async () => {
    m.buscarCampanhasAds.mockResolvedValue({ ok: true, estado: 'sem_conexao' });
    const { result } = render();
    await waitFor(() => expect(result.current.resposta?.estado).toBe('sem_conexao'));
    expect(result.current.campanhas).toEqual([]);
    expect(m.buscarCodigosMlbs).not.toHaveBeenCalled();
  });

  it('erro da edge vira isError/erro', async () => {
    m.buscarCampanhasAds.mockRejectedValue(new Error('falhou'));
    const { result } = render();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.erro?.message).toBe('falhou');
  });

  it('atualizar() chama com fresco=true e troca o cache', async () => {
    m.buscarCampanhasAds.mockResolvedValueOnce(ok(['MLB1']));
    const { result } = render();
    await waitFor(() => expect(result.current.campanhas).not.toBeNull());
    m.buscarCampanhasAds.mockResolvedValueOnce({ ...ok(['MLB1']), lidoEm: 'novo' });
    await act(async () => { await result.current.atualizar(); });
    expect(m.buscarCampanhasAds).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(result.current.resposta).toMatchObject({ lidoEm: 'novo' }));
    expect(result.current.atualizando).toBe(false);
  });
});
