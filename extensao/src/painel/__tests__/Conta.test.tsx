// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conta } from '../Conta';
import type { EstadoExt } from '../formato';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const EXT: EstadoExt = { ativa: true, logado: true, perfil: { nome: 'Ana', orgNome: 'Loja X' }, versao: '0.3.0', geracao: 5 };

describe('Conta', () => {
  it('mostra nome, organização, chave e ações', () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    render(<Conta estado={EXT} onEstado={vi.fn()} onRefazer={vi.fn()} />);
    screen.getByText('Ana');
    screen.getByText('Loja X');
    expect(screen.getByRole('switch', { name: 'Extensão ativa' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('link', { name: 'Abrir o PubliAI' }).getAttribute('href')).toBe('https://app.publiai.daludi.com.br/');
    screen.getByRole('button', { name: 'Sair' });
  });

  it('desligar envia definir-ativa false com a geração e aplica o estado devolvido', async () => {
    const novo = { ...EXT, ativa: false, geracao: 6 };
    const sendMessage = vi.fn(async () => ({ ok: true, ...novo }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const onEstado = vi.fn();
    render(<Conta estado={EXT} onEstado={onEstado} onRefazer={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Extensão ativa' })); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:definir-ativa', ativa: false, geracao: 5 });
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ ativa: false, geracao: 6 }));
  });

  it('ligar (estado desligado) envia definir-ativa true', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, ...EXT }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    render(<Conta estado={{ ...EXT, ativa: false }} onEstado={vi.fn()} onRefazer={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Extensão ativa' })); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:definir-ativa', ativa: true, geracao: 5 });
  });

  it('Sair envia sair com a geração', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, ...EXT, logado: false, perfil: null, geracao: 6 }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const onEstado = vi.fn();
    render(<Conta estado={EXT} onEstado={onEstado} onRefazer={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair' })); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:sair', geracao: 5 });
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ logado: false }));
  });

  it('geracao_antiga pede para reler o estado', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: false, erro: 'geracao_antiga', geracao: 9 })) } });
    const onEstado = vi.fn();
    const onRefazer = vi.fn();
    render(<Conta estado={EXT} onEstado={onEstado} onRefazer={onRefazer} />);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Extensão ativa' })); });
    expect(onRefazer).toHaveBeenCalled();
    expect(onEstado).not.toHaveBeenCalled();
  });
});
