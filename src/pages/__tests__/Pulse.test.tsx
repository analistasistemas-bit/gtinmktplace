import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Pulse from '../Pulse';
import type { PulseProduto, PulseResumoOfertas } from '@/lib/pulse';

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['pulse'], isLoading: false }),
}));

const produtos = vi.hoisted(() => ({ lista: [] as PulseProduto[] }));
const resumos = vi.hoisted(() => ({ mapa: new Map<string, PulseResumoOfertas>() }));

vi.mock('@/lib/pulse', async () => {
  const real = await vi.importActual<typeof import('@/lib/pulse')>('@/lib/pulse');
  return {
    ...real,
    fetchPulseProdutos: vi.fn(async () => produtos.lista),
    fetchPulseResumoOfertas: vi.fn(async () => resumos.mapa),
    contarPulseAlertas: vi.fn(async () => 0),
    // A coluna "Sobra hoje" lê o contexto de margem da página inteira: sem mock, o `...real` levaria
    // a query ao Supabase de verdade (os produtos do teste têm `codigo_pai`, então ela é habilitada).
    fetchContextoMargemEmLote: vi.fn(async () => new Map()),
    // Mesma razão: a coluna de tendência dispara uma query própria assim que o resumo chega.
    fetchPulseHistoricoOfertas: vi.fn(async () => new Map()),
  };
});

const produto = (over: Partial<PulseProduto> = {}): PulseProduto => ({
  id: 'produto-1', catalog_product_id: 'MLB123456', codigo_pai: 'APTAMIL-1800',
  titulo: 'Aptamil', gtin: null, origem: 'auto', status: 'ativo', catalogo_status: 'vinculado',
  ptw_status: null, ptw_preco_sugerido: null, ptw_aplicavel: null, ptw_custos: null,
  ultimo_snapshot_em: null, meu_preco: 100, meu_preco_em: null, anuncio_status: 'active',
  anuncio_sub_status: [], anuncio_status_em: null, comissao_pct: null, comissao_fixa: null,
  comissao_preco: null, comissao_em: null, ...over,
});

const resumo = (menorRelevante: number | null): PulseResumoOfertas => ({
  menorPreco: menorRelevante, menorObservado: menorRelevante, menorRelevante,
  maiorRelevante: menorRelevante, nOfertas: 1, nOfertasRelevantes: menorRelevante == null ? 0 : 1,
  precosRelevantes: menorRelevante == null ? [] : [menorRelevante], abaixoDaReferencia: null,
});

export async function renderPulse(lista: PulseProduto[], mapa: Map<string, PulseResumoOfertas>) {
  produtos.lista = lista;
  resumos.mapa = mapa;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <MemoryRouter>
      <QueryClientProvider client={client}><Pulse /></QueryClientProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('No radar')).toBeInTheDocument());
  return r;
}

// "Você é o menor preço: 0" em verde lê como parabéns por nada. Zero aqui não é bom nem ruim.
describe('Pulse — tom dos KPIs do Radar', () => {
  it('zero em "Você é o menor preço" não é verde', async () => {
    await renderPulse([produto({ meu_preco: 200 })], new Map([['produto-1', resumo(100)]]));
    expect(screen.getByText('Você é o menor preço')).toHaveClass('text-info');
    expect(screen.getByText('Você é o menor preço')).not.toHaveClass('text-success');
  });

  it('com pelo menos um produto no menor preço o card fica verde', async () => {
    await renderPulse([produto({ meu_preco: 50 })], new Map([['produto-1', resumo(100)]]));
    // waitFor: `resumoOfertas` é uma query dependente que só habilita depois de `produtos`
    // resolver — "No radar" já aparece antes dela carregar, então a asserção precisa esperar
    // o próprio recorte, não só a lista.
    await waitFor(() => expect(screen.getByText('Você é o menor preço')).toHaveClass('text-success'));
  });
});
