import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FotoCombinacao } from '../foto-combinacao';

vi.mock('@/lib/kit-variacao-edge', () => ({ gerarFotoKitEdge: vi.fn() }));
import { gerarFotoKitEdge } from '@/lib/kit-variacao-edge';

const itensOk = [
  { campo: 'comprimento', rotulo: 'Comprimento', ok: true, nota: 'igual à original' },
  { campo: 'cor', rotulo: 'Cor', ok: true, nota: 'igual à original' },
];
const originais = [
  { cor: 'Bege Cru', urls: ['https://x/bege-frente.jpg', 'https://x/bege-costas.jpg'] },
  { cor: 'Cinza Escuro', urls: ['https://x/cinza.jpg'] },
];
const aprovada = (id: string, tentativa = 1) => ({
  ok: true as const, request_id: id, tentativa, aprovado: true, proxima: false, path: `ORG/kit-variacao-ia/${id}.png`,
  url: `https://x/${id}.png`, verificacao: { aprovado: true, itens: itensOk, motivos: [] }, originais,
});
const reprovada = (id: string, tentativa: number) => ({
  ok: true as const, request_id: id, tentativa, aprovado: false, proxima: tentativa < 3,
  verificacao: {
    aprovado: false,
    itens: [{ campo: 'comprimento', rotulo: 'Comprimento', ok: false, nota: 'Bege Cru: termina no joelho; a original termina no meio da coxa' }],
    motivos: ['Comprimento: Bege Cru: termina no joelho; a original termina no meio da coxa'],
  },
  motivos: ['Comprimento: Bege Cru: termina no joelho; a original termina no meio da coxa'],
  previa_url: `https://x/${id}-t${tentativa}.png`, originais,
});

function abrir(onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FotoCombinacao rotulo="Bege Cru e Cinza Escuro" cores={['Bege Cru', 'Cinza Escuro']} familiaBaseId="FAM" temImagemIA valor={undefined} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}
const ids = () => vi.mocked(gerarFotoKitEdge).mock.calls.map((c) => c[0].requestId);

describe('FotoCombinacao: verificação e prévia ampliada', () => {
  beforeEach(() => vi.mocked(gerarFotoKitEdge).mockReset());

  it('reprovada com nova tentativa: repete sozinho o mesmo request_id até aprovar', async () => {
    vi.mocked(gerarFotoKitEdge)
      .mockImplementationOnce(async (p) => reprovada(p.requestId, 1))
      .mockImplementationOnce(async (p) => aprovada(p.requestId, 2));
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: 'Gerar foto Bege Cru e Cinza Escuro' }));
    await screen.findByRole('button', { name: 'Usar foto gerada Bege Cru e Cinza Escuro' });
    expect(ids()).toHaveLength(2);
    expect(ids()[0]).toBe(ids()[1]);
  });

  it('3 reprovações: mostra "A IA não conseguiu uma foto fiel" com os motivos e nunca oferece "Usar esta foto"', async () => {
    vi.mocked(gerarFotoKitEdge)
      .mockImplementationOnce(async (p) => reprovada(p.requestId, 1))
      .mockImplementationOnce(async (p) => reprovada(p.requestId, 2))
      .mockImplementationOnce(async (p) => reprovada(p.requestId, 3));
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: 'Gerar foto Bege Cru e Cinza Escuro' }));
    expect(await screen.findByText('A IA não conseguiu uma foto fiel')).toBeInTheDocument();
    expect(screen.getAllByText(/termina no joelho/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Envie uma foto própria/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar foto gerada/ })).toBeNull();
    // Nem na prévia ampliada.
    await user.click(screen.getByRole('button', { name: 'Ampliar Bege Cru e Cinza Escuro' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).queryByRole('button', { name: /Usar/ })).toBeNull();
    expect(within(d).getByText('Reprovada')).toBeInTheDocument();
    expect(ids()).toHaveLength(3);
    expect(new Set(ids()).size).toBe(1);
  });

  it('"Ampliar" abre a gerada em tamanho real com as originais de cada cor e os itens conferidos; aprova dali', async () => {
    vi.mocked(gerarFotoKitEdge).mockImplementationOnce(async (p) => aprovada(p.requestId));
    const user = userEvent.setup();
    const onChange = abrir();
    await user.click(screen.getByRole('button', { name: 'Gerar foto Bege Cru e Cinza Escuro' }));
    fireEvent.load(await screen.findByAltText('Foto gerada Bege Cru e Cinza Escuro'));
    await user.click(screen.getByRole('button', { name: 'Ampliar Bege Cru e Cinza Escuro' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByAltText('Foto gerada Bege Cru e Cinza Escuro, ampliada')).toBeInTheDocument();
    expect(within(d).getByRole('img', { name: 'Original Bege Cru 1' })).toHaveAttribute('src', 'https://x/bege-frente.jpg');
    expect(within(d).getByRole('img', { name: 'Original Bege Cru 2' })).toBeInTheDocument();
    expect(within(d).getByRole('img', { name: 'Original Cinza Escuro 1' })).toBeInTheDocument();
    expect(within(d).getByText('Comprimento')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Aproximar' }));
    expect(within(d).getByRole('button', { name: 'Afastar' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.load(within(d).getByAltText('Foto gerada Bege Cru e Cinza Escuro, ampliada'));
    await user.click(within(d).getByRole('button', { name: 'Usar esta foto' }));
    expect(onChange).toHaveBeenCalledWith({ path: `ORG/kit-variacao-ia/${ids()[0]}.png`, url: `https://x/${ids()[0]}.png` });
  });

  it('"Gerar de novo" na prévia ampliada pede uma geração nova (outro request_id)', async () => {
    vi.mocked(gerarFotoKitEdge)
      .mockImplementationOnce(async (p) => aprovada(p.requestId))
      .mockImplementationOnce(async (p) => aprovada(p.requestId));
    const user = userEvent.setup();
    abrir();
    await user.click(screen.getByRole('button', { name: 'Gerar foto Bege Cru e Cinza Escuro' }));
    await user.click(await screen.findByRole('button', { name: 'Ampliar Bege Cru e Cinza Escuro' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Gerar de novo' }));
    await vi.waitFor(() => expect(ids()).toHaveLength(2));
    expect(ids()[0]).not.toBe(ids()[1]);
  });
});
