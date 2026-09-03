// ADR-0151 (fix round pós-revisão-final, achado da re-revisão): o botão "Reenviar" (I-1)
// re-dispara publicarFamilias([familiaId]) — uma publicação real no ML — a partir de um
// ponto de entrada de UI novo. Cobre: visibilidade condicional a status='erro', o payload do
// clique, o aviso de falso-positivo (enfileiradas===0) e o dedupe por criadoEm mais recente
// (M-1) que decide qual linha manda no botão.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogCriarKit } from '../dialog-criar-kit';
import type { KitVinculado } from '@/lib/queries';
import type { BaseParaKit } from '@/lib/kit';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const publicarFamiliasMock = vi.fn();
vi.mock('@/lib/publicar', () => ({
  publicarFamilias: (...args: unknown[]) => publicarFamiliasMock(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BASE: BaseParaKit = {
  codigoPai: '00000010',
  titulo: 'Fita Adesiva Transparente 45mm',
  descricao: 'Fita de boa qualidade.',
  preco: 19.9,
  custo: 5.5,
  pesoGramas: 120,
  alturaCm: 10,
  larguraCm: 8,
  comprimentoCm: 3,
  fotoPath: null,
  estoque: 30,
};

function kit(multiplicador: number, status: KitVinculado['status'], criadoEm: string, overrides: Partial<KitVinculado> = {}): KitVinculado {
  return {
    familiaId: `fam-${multiplicador}-${status}-${criadoEm}`,
    codigoPai: BASE.codigoPai,
    multiplicador,
    status,
    mlPermalink: null,
    mlItemId: null,
    criadoEm,
    ...overrides,
  };
}

function renderDialog(kitsExistentes: KitVinculado[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <DialogCriarKit
        familiaBaseId="familia-base-1"
        base={BASE}
        kitsExistentes={kitsExistentes}
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('DialogCriarKit — botão Reenviar (I-1)', () => {
  it('só aparece para o tamanho com status erro; os outros ficam "já criado" sem o botão', () => {
    renderDialog([
      kit(2, 'erro', '2026-08-01T00:00:00Z'),
      kit(3, 'pronto', '2026-08-01T00:00:00Z'),
    ]);

    expect(screen.getByRole('button', { name: /Reenviar/i })).toBeInTheDocument();

    const checkbox3 = screen.getByLabelText('Kit de 3 unidades');
    expect(checkbox3).toBeDisabled();
    expect(screen.getByText('já criado')).toBeInTheDocument();
    expect(screen.getByText('falhou ao publicar')).toBeInTheDocument();
  });

  it('clicar em Reenviar chama publicarFamilias com o familiaId do kit em erro', async () => {
    publicarFamiliasMock.mockResolvedValue({ enfileiradas: 1 });
    const erro = kit(4, 'erro', '2026-08-01T00:00:00Z');
    renderDialog([erro]);

    await userEvent.click(screen.getByRole('button', { name: /Reenviar/i }));

    await waitFor(() => expect(publicarFamiliasMock).toHaveBeenCalledWith([erro.familiaId]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kit reenviado para publicação'));
  });

  it('enfileiradas === 0 mostra o aviso de falso-positivo, não o toast de sucesso', async () => {
    publicarFamiliasMock.mockResolvedValue({ enfileiradas: 0 });
    const erro = kit(5, 'erro', '2026-08-01T00:00:00Z');
    renderDialog([erro]);

    await userEvent.click(screen.getByRole('button', { name: /Reenviar/i }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Kit não foi reenviado',
      expect.objectContaining({ description: expect.stringContaining('Nenhuma família foi enfileirada') }),
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('dedupe: com duas linhas do mesmo multiplicador, só a mais recente por criadoEm decide o botão', () => {
    // Mais recente (pronto) deve vencer a mais antiga (erro) — sem Reenviar pra esse tamanho.
    renderDialog([
      kit(6, 'pronto', '2026-08-02T00:00:00Z', { familiaId: 'fam-mais-recente' }),
      kit(6, 'erro', '2026-08-01T00:00:00Z', { familiaId: 'fam-mais-antiga' }),
    ]);

    expect(screen.queryByRole('button', { name: /Reenviar/i })).not.toBeInTheDocument();
    expect(screen.getByText('já criado')).toBeInTheDocument();
    expect(screen.queryByText('falhou ao publicar')).not.toBeInTheDocument();
  });
});
