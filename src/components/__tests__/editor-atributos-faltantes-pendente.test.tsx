// Revisão Codex (15/11): Reenviar do kit não pode correr antes do atributo escolhido estar gravado.
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { salvarMock } = vi.hoisted(() => ({ salvarMock: vi.fn() }));
vi.mock('@/lib/queries', () => ({
  listarFaltantesAtributos: async () => [{ id: 'PRODUCT_CONSERVATION', nome: 'Conservação do produto', tipo: 'closed', valores: [{ id: '10792872', nome: 'Temperatura ambiente' }] }],
}));
vi.mock('@/hooks/useFamiliaMutations', () => ({ useSalvarAtributo: () => ({ mutateAsync: salvarMock }) }));

import { EditorAtributosFaltantes } from '../editor-atributos-faltantes';

describe('EditorAtributosFaltantes — onPendenteChange', () => {
  it('avisa pendente enquanto houver campo não salvo', async () => {
    const onPendente = vi.fn();
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><EditorAtributosFaltantes familiaId="f1" onPendenteChange={onPendente} /></QueryClientProvider>);
    await waitFor(() => expect(onPendente).toHaveBeenLastCalledWith(true));
  });
});
