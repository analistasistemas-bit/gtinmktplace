import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CampoFaltante } from '@/lib/tipos-dominio';

// Mocka só as funções de rede da edge; mantém o resto de queries (QK etc.) para os hooks.
vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return { ...actual, listarFaltantesAtributos: vi.fn(), salvarAtributoFamilia: vi.fn() };
});

import { EditorAtributosFaltantes } from '@/components/editor-atributos-faltantes';
import { listarFaltantesAtributos, salvarAtributoFamilia } from '@/lib/queries';

const CAMPOS: CampoFaltante[] = [
  { id: 'MODEL', nome: 'Modelo', tipo: 'texto', valores: [] },
  { id: 'VOLTAGE', nome: 'Voltagem', tipo: 'closed', valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }] },
];

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditorAtributosFaltantes familiaId="f1" loteId="l1" />
    </QueryClientProvider>,
  );
}

describe('EditorAtributosFaltantes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renderiza um campo editável por faltante (Input p/ texto, Select p/ closed-set)', async () => {
    vi.mocked(listarFaltantesAtributos).mockResolvedValue(CAMPOS);
    renderEditor();
    expect(await screen.findByText('Modelo')).toBeInTheDocument();
    expect(screen.getByText('Voltagem')).toBeInTheDocument();
    expect(screen.getByText(/Complete para publicar/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('texto')).toBeInTheDocument(); // Input do texto-livre
  });

  it('salva o texto-livre no onBlur', async () => {
    vi.mocked(listarFaltantesAtributos).mockResolvedValue([CAMPOS[0]]);
    vi.mocked(salvarAtributoFamilia).mockResolvedValue([]);
    renderEditor();
    const input = await screen.findByPlaceholderText('texto');
    fireEvent.change(input, { target: { value: 'Barbante 4/6' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(salvarAtributoFamilia).toHaveBeenCalledWith('f1', 'MODEL', 'Barbante 4/6'),
    );
  });

  it('não renderiza nada quando não há faltantes', async () => {
    vi.mocked(listarFaltantesAtributos).mockResolvedValue([]);
    const { container } = renderEditor();
    await waitFor(() => expect(listarFaltantesAtributos).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra erro quando a busca de faltantes falha (não some silenciosamente)', async () => {
    vi.mocked(listarFaltantesAtributos).mockRejectedValue(new Error('sem credencial ML'));
    renderEditor();
    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
  });
});
