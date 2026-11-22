import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const criar = vi.fn();
const revogar = vi.fn();
const invalidar = vi.fn();
let lista: unknown[] = [];
let chamadas: { data?: unknown[]; isLoading?: boolean; isError?: boolean } = { data: [] };

vi.mock('@/hooks/useAgenteConexoes', () => ({
  MCP_URL: 'https://exemplo.supabase.co/functions/v1/agentes',
  useAgenteConexoes: () => ({ data: lista, isLoading: false, isError: false }),
  criarConexaoAgente: (...a: unknown[]) => criar(...a),
  useInvalidarConexoes: () => invalidar,
  useRevogarConexao: () => ({ mutate: revogar, isPending: false }),
  useChamadasConexao: (id: string | null) => (id ? chamadas : { data: undefined }),
}));
const toastErro = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastErro(...a), success: vi.fn() } }));

import { DialogNovaConexao, SecaoAgentes } from '../secao-agentes';
import { SECOES, secoesVisiveis } from '../secoes';

const CONEXAO = {
  id: 'c1', nome: 'Claude do Diego', prefixo: 'ab12cd34', criada_em: '2026-11-01T12:00:00Z',
  expira_em: '2099-01-30T12:00:00Z', revogada_em: null, ultimo_uso_em: null,
};
const CHAVE = 'pai_ab12cd34_' + 'x'.repeat(43);

describe('visibilidade da seção', () => {
  const base = { podeVerMembros: true, podeVerCanais: true, podeVerConfig: true };
  const slugs = (p: typeof base & { podeGerirAgentes: boolean }, m: string[]) => secoesVisiveis(SECOES, p, m).map((s) => s.slug);

  it('não-admin não vê a seção, mesmo com o módulo', () => {
    expect(slugs({ ...base, podeGerirAgentes: false }, ['agentes'])).not.toContain('agentes');
  });
  it('admin sem o módulo não vê', () => {
    expect(slugs({ ...base, podeGerirAgentes: true }, [])).not.toContain('agentes');
  });
  it('admin com o módulo vê', () => {
    expect(slugs({ ...base, podeGerirAgentes: true }, ['agentes'])).toContain('agentes');
  });
});

describe('SecaoAgentes', () => {
  beforeEach(() => {
    criar.mockReset(); revogar.mockReset(); invalidar.mockReset();
    lista = [CONEXAO];
    chamadas = { data: [] };
  });

  it('lista nome, prefixo e último uso, e nunca a palavra hash', () => {
    lista = [{ ...CONEXAO, hash: 'segredo' }];
    const { container } = render(<SecaoAgentes />);
    expect(screen.getByText('Claude do Diego')).toBeInTheDocument();
    expect(screen.getByText(/ab12cd34/)).toBeInTheDocument();
    expect(screen.getByText(/Último uso/)).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain('hash');
    expect(container.textContent).not.toContain('segredo');
  });

  it('lista vazia mostra estado vazio', () => {
    lista = [];
    render(<SecaoAgentes />);
    expect(screen.getByText(/Nenhuma conexão/)).toBeInTheDocument();
  });

  it('após criar, a chave aparece uma vez e some ao fechar o diálogo', async () => {
    criar.mockResolvedValue({ id: 'c2', chave: CHAVE, prefixo: 'ab12cd34', expira_em: '2027-02-20T12:00:00Z' });
    render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova conexão' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Meu agente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(screen.getByDisplayValue(CHAVE)).toBeInTheDocument());
    expect(criar).toHaveBeenCalledWith('Meu agente', 90);
    expect(invalidar).toHaveBeenCalled();
    expect(screen.getByText('Esta chave não será exibida de novo.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://exemplo.supabase.co/functions/v1/agentes')).toBeInTheDocument();
    expect(screen.getByDisplayValue(CHAVE)).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(screen.queryByDisplayValue(CHAVE)).not.toBeInTheDocument());

    // Reabrir não traz a chave de volta.
    fireEvent.click(screen.getByRole('button', { name: 'Nova conexão' }));
    expect(screen.queryByDisplayValue(CHAVE)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('');
  });

  it('erro ao criar aparece no diálogo e não mostra chave', async () => {
    criar.mockRejectedValue(new Error('Limite de 10 conexões ativas.'));
    render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Nova conexão' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(screen.getByText('Limite de 10 conexões ativas.')).toBeInTheDocument());
  });

  it('revogar pede confirmação antes de chamar a edge', async () => {
    render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
    const alerta = await screen.findByRole('alertdialog');
    expect(revogar).not.toHaveBeenCalled();
    fireEvent.click(within(alerta).getByRole('button', { name: 'Revogar' }));
    expect(revogar).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('conexão revogada não oferece Revogar', () => {
    lista = [{ ...CONEXAO, revogada_em: '2026-11-20T12:00:00Z' }];
    render(<SecaoAgentes />);
    expect(screen.queryByRole('button', { name: 'Revogar' })).not.toBeInTheDocument();
    expect(screen.getByText('Revogada')).toBeInTheDocument();
  });

  it('Ver chamadas lista a auditoria; vazio e erro tratados', async () => {
    chamadas = { data: [
      { criado_em: '2026-11-22T10:00:00Z', ferramenta: 'publiai_margem_anuncio', alvo: 'MLB123', resultado: 'ok' },
      { criado_em: '2026-11-22T09:00:00Z', ferramenta: 'publiai_simular_margem', alvo: null, resultado: 'limite_tarifas' },
      { criado_em: '2026-11-22T08:00:00Z', ferramenta: 'ferramenta_nova', alvo: null, resultado: 'estado_novo' },
    ] };
    const { unmount } = render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver chamadas' }));
    expect(await screen.findByText('Margem do anúncio')).toBeInTheDocument();
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.getByText('Simulação de preço')).toBeInTheDocument();
    expect(screen.getByText('Limite diário atingido')).toBeInTheDocument();
    expect(screen.getByText('ferramenta_nova')).toBeInTheDocument();
    expect(screen.getByText('estado_novo')).toBeInTheDocument();
    expect(screen.getByText('MLB123')).toBeInTheDocument();
    unmount();

    chamadas = { data: [] };
    const r2 = render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver chamadas' }));
    expect(await screen.findByText(/Nenhuma chamada/)).toBeInTheDocument();
    r2.unmount();

    chamadas = { isError: true };
    render(<SecaoAgentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver chamadas' }));
    expect(await screen.findByText(/Não foi possível carregar as chamadas/)).toBeInTheDocument();
  });
});

describe('DialogNovaConexao: a chave nunca fica presa', () => {
  const RESPOSTA = { id: 'c2', chave: CHAVE, prefixo: 'ab12cd34', expira_em: '2027-02-20T12:00:00Z' };
  let resolver: (v: unknown) => void;
  beforeEach(() => {
    criar.mockReset(); invalidar.mockReset(); toastErro.mockReset();
    criar.mockImplementation(() => new Promise((r) => { resolver = r; }));
  });
  const enviar = () => {
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Meu agente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
  };

  it('durante o envio, Esc não fecha e Cancelar fica desabilitado', async () => {
    const onFechar = vi.fn();
    render(<DialogNovaConexao aberto onFechar={onFechar} />);
    enviar();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('resposta que chega com o diálogo já fechado não grava a chave', async () => {
    const { rerender } = render(<DialogNovaConexao aberto onFechar={vi.fn()} />);
    enviar();
    rerender(<DialogNovaConexao aberto={false} onFechar={vi.fn()} />);
    resolver(RESPOSTA);
    await waitFor(() => expect(invalidar).toHaveBeenCalled());
    rerender(<DialogNovaConexao aberto onFechar={vi.fn()} />);
    expect(screen.queryByDisplayValue(CHAVE)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
  });

  it('com a chave na tela, Esc não fecha; só Concluir', async () => {
    const onFechar = vi.fn();
    render(<DialogNovaConexao aberto onFechar={onFechar} />);
    enviar();
    resolver(RESPOSTA);
    await waitFor(() => expect(screen.getByDisplayValue(CHAVE)).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onFechar).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(CHAVE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('falha ao copiar avisa por toast', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('negado')) }, configurable: true,
    });
    render(<DialogNovaConexao aberto onFechar={vi.fn()} />);
    enviar();
    resolver(RESPOSTA);
    await waitFor(() => expect(screen.getByDisplayValue(CHAVE)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não foi possível copiar. Selecione o texto e copie manualmente.'));
    expect(screen.queryByRole('button', { name: 'Copiado' })).not.toBeInTheDocument();
  });
});
