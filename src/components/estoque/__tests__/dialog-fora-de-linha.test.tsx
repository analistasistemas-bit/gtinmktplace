import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const acoes = { foraDeLinha: vi.fn(), removerNaoRepor: vi.fn() };
const estado = { pendente: false };
vi.mock('@/hooks/useReposicao', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useReposicao')>()),
  useReposicao: () => ({ pendente: estado.pendente, ...acoes }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { DialogForaDeLinha } from '../dialog-fora-de-linha';

type Info = React.ComponentProps<typeof DialogForaDeLinha>['info'];
const info = (p: Partial<Info> = {}): Info => ({
  familiaId: null,
  cores: [{ cor: 'Preto', corHex: '#000000', marcaId: null }, { cor: 'Azul', corHex: '#0000ff', marcaId: 'm-azul' }],
  rascunho: (escopo, cor) => (escopo === 'cor' && cor === 'Preto' ? { unidades: 12, rascunhos: 1 } : { unidades: 30, rascunhos: 2 }),
  ...p,
});
function abrir(i: Info = info(), onOpenChange = vi.fn()) {
  render(<DialogForaDeLinha open onOpenChange={onOpenChange} codigoPai="P1" nome="Short Bermuda" info={i} />);
  return onOpenChange;
}

beforeEach(() => {
  acoes.foraDeLinha.mockReset().mockResolvedValue({});
  acoes.removerNaoRepor.mockReset().mockResolvedValue({});
  estado.pendente = false;
  vi.mocked(toast.success).mockClear();
});
afterEach(cleanup);

describe('DialogForaDeLinha', () => {
  it('título, foco inicial nele e uma linha por cor', async () => {
    abrir();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fora de linha · Short Bermuda' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Marcar o produto inteiro fora de linha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar a cor Preto fora de linha' })).toBeInTheDocument();
  });

  it('marcar cor: confirmação mostra as unidades do rascunho; Confirmar chama foraDeLinha e avisa', async () => {
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar a cor Preto fora de linha' }));
    const conf = screen.getByRole('group', { name: 'Confirmar fora de linha' });
    expect(conf).toHaveTextContent('Preto sai das sugestões de compra, e 12 un. saem do rascunho de pedido.');
    expect(conf).toHaveTextContent('O estoque que sobra continua à venda; o anúncio no Mercado Livre não muda.');
    expect(conf).toHaveTextContent('As quantidades das outras cores serão recalculadas.');
    expect(acoes.foraDeLinha).not.toHaveBeenCalled();
    await userEvent.click(within(conf).getByRole('button', { name: 'Confirmar' }));
    expect(acoes.foraDeLinha).toHaveBeenCalledWith({ escopo: 'cor', codigoPai: 'P1', cor: 'Preto' });
    expect(toast.success).toHaveBeenCalledWith('Preto marcado como fora de linha');
  });

  it('produto inteiro: sem frase das outras cores; rascunho 0 omite a parte do rascunho', async () => {
    abrir(info({ rascunho: () => ({ unidades: 0, rascunhos: 0 }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar o produto inteiro fora de linha' }));
    const conf = screen.getByRole('group', { name: 'Confirmar fora de linha' });
    expect(conf.textContent).toMatch(/^O produto inteiro sai das sugestões de compra\. O estoque/);
    expect(conf).not.toHaveTextContent('outras cores');
    await userEvent.click(within(conf).getByRole('button', { name: 'Confirmar' }));
    expect(acoes.foraDeLinha).toHaveBeenCalledWith({ escopo: 'familia', codigoPai: 'P1' });
  });

  it('cancelar não chama nada', async () => {
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar a cor Preto fora de linha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('group', { name: 'Confirmar fora de linha' })).not.toBeInTheDocument();
    expect(acoes.foraDeLinha).not.toHaveBeenCalled();
  });

  it('cor já marcada: selo e "Voltar à linha" chama removerNaoRepor(id)', async () => {
    abrir();
    expect(screen.getByText('Fora de linha')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar a cor Azul à linha' }));
    expect(acoes.removerNaoRepor).toHaveBeenCalledWith('m-azul');
    expect(toast.success).toHaveBeenCalledWith('Azul voltou à linha');
  });

  it('produto inteiro marcado desabilita as cores', () => {
    abrir(info({ familiaId: 'f1' }));
    expect(screen.getByRole('button', { name: 'Voltar o produto inteiro à linha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar a cor/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('O produto inteiro já está fora de linha')).toHaveLength(2);
  });

  it('erro: mostra a mensagem e oferece tentar de novo', async () => {
    acoes.foraDeLinha.mockRejectedValueOnce(new Error('Falhou no servidor.'));
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar a cor Preto fora de linha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou no servidor.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(acoes.foraDeLinha).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('carregando: botões desabilitados', () => {
    estado.pendente = true;
    abrir();
    expect(screen.getByRole('button', { name: 'Marcar a cor Preto fora de linha' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voltar a cor Azul à linha' })).toBeDisabled();
  });

  it('Esc fecha', async () => {
    const fechar = abrir();
    await userEvent.keyboard('{Escape}');
    expect(fechar).toHaveBeenCalledWith(false);
  });
});
