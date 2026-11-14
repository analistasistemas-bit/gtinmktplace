import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnexoMensagem } from '../anexo-mensagem';

const baixarReclamacaoMock = vi.fn();
const baixarPackMock = vi.fn();
vi.mock('@/lib/mensagens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mensagens')>()),
  baixarAnexoReclamacao: (...a: unknown[]) => baixarReclamacaoMock(...a),
  baixarAnexoMensagem: (...a: unknown[]) => baixarPackMock(...a),
}));

const foto = { filename: '46622406_a.jpg', original_filename: 'image.jpg', type: 'image/jpeg', size: 3685549, potential_security_threat: false };

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:teste');
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => { baixarReclamacaoMock.mockReset(); baixarPackMock.mockReset(); });

describe('AnexoMensagem em reclamação', () => {
  it('baixa pela reclamação e mostra a imagem', async () => {
    baixarReclamacaoMock.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    render(<AnexoMensagem claimId="5611317703" anexo={foto} />);
    expect(await screen.findByRole('img', { name: 'image.jpg' })).toHaveAttribute('src', 'blob:teste');
    expect(baixarReclamacaoMock).toHaveBeenCalledWith('5611317703', '46622406_a.jpg');
    expect(baixarPackMock).not.toHaveBeenCalled();
  });
  it('falha no download mostra "Arquivo indisponível"', async () => {
    baixarReclamacaoMock.mockRejectedValue(new Error('x'));
    render(<AnexoMensagem claimId="5611317703" anexo={foto} />);
    await waitFor(() => expect(screen.getByText('Arquivo indisponível')).toBeInTheDocument());
  });
});
