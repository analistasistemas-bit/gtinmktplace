// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { Entrar } from '../Entrar';
import type { EstadoExt } from '../formato';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const EXT: EstadoExt = { ativa: true, logado: true, perfil: { nome: 'Ana', orgNome: 'Loja X' }, versao: '0.3.0', geracao: 2 };
const preencher = (email = 'ana@x.com', senha = 'segredo-123') => {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
};

describe('Entrar', () => {
  it('envia publiai:entrar e limpa o campo senha após a resposta', async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, erro: 'credenciais_invalidas', ...EXT, logado: false }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    render(<Entrar onEstado={vi.fn()} />);
    screen.getByRole('heading', { name: 'Entrar no PubliAI' });
    screen.getByText('Use o mesmo e-mail e senha do app');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).type).toBe('password');
    expect(document.activeElement).toBe(screen.getByLabelText('E-mail'));
    preencher();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:entrar', email: 'ana@x.com', senha: 'segredo-123' });
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('ana@x.com');
    expect(screen.getByRole('alert').textContent).toBe('E-mail ou senha incorretos.');
  });

  it('Enter envia; botão fica desabilitado durante o envio', async () => {
    let resolver!: (v: unknown) => void;
    const sendMessage = vi.fn(() => new Promise((r) => { resolver = r; }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const onEstado = vi.fn();
    render(<Entrar onEstado={onEstado} />);
    preencher();
    await act(async () => { fireEvent.submit(screen.getByLabelText('Senha').closest('form')!); });
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolver({ ok: true, ...EXT }); });
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ logado: true, geracao: 2 }));
  });

  it.each([
    ['rede', 'Sem conexão. Tente de novo.'],
    ['sem_acesso', 'Seu usuário está inativo ou sem empresa no PubliAI.'],
    ['modulo_desligado', 'A extensão não está habilitada para sua empresa'],
  ])('erro %s', async (erro, texto) => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: false, erro, ...EXT, logado: false })) } });
    render(<Entrar onEstado={vi.fn()} />);
    preencher();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })); });
    expect(screen.getByRole('alert').textContent).toBe(texto);
  });

  it('sem resposta do SW: erro genérico e senha limpa', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } });
    render(<Entrar onEstado={vi.fn()} />);
    preencher();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })); });
    screen.getByRole('alert');
    expect((screen.getByLabelText('Senha') as HTMLInputElement).value).toBe('');
  });
});

describe('senha no painel', () => {
  it('não aparece em gravação de chrome.storage nem em mensagem além de publiai:entrar', async () => {
    const SENHA = 'senha-super-secreta-777';
    const mensagens: Array<{ tipo: string }> = [];
    const gravacoes: unknown[] = [];
    const sendMessage = vi.fn(async (m: { tipo: string }) => {
      mensagens.push(m);
      if (m.tipo === 'publiai:estado-extensao') return { ...EXT, logado: false, perfil: null };
      if (m.tipo === 'publiai:entrar') return { ok: true, ...EXT };
      if (m.tipo === 'publiai:estado-da-aba') return null;
      return undefined;
    });
    const set = vi.fn(async (o: unknown) => { gravacoes.push(o); });
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), onActivated: { addListener: vi.fn(), removeListener: vi.fn() } },
      storage: { local: { set }, session: { set } },
      runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
    await act(async () => { render(<App />); });
    preencher('ana@x.com', SENHA);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Entrar' })); });
    expect(JSON.stringify(gravacoes)).not.toContain(SENHA);
    expect(mensagens.filter((m) => JSON.stringify(m).includes(SENHA)).map((m) => m.tipo)).toEqual(['publiai:entrar']);
    expect(document.body.innerHTML).not.toContain(SENHA);
  });
});
