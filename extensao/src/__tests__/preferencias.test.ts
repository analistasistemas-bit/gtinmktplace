import { beforeEach, describe, expect, it, vi } from 'vitest';
import { epocaAtual, estadoDaAba, lerAba, registrarEstado } from '../abas';
import { definirAtiva, estaAtiva } from '../preferencias';
import { instalarChromeFalso, local, logar } from './chrome-falso';

beforeEach(() => {
  instalarChromeFalso();
  logar();
});

describe('preferência ativa', () => {
  it('padrão: ativa; só false desliga', async () => {
    expect(await estaAtiva()).toBe(true);
    local.ativa = false;
    expect(await estaAtiva()).toBe(false);
    local.ativa = true;
    expect(await estaAtiva()).toBe(true);
  });

  it('definirAtiva(false) limpa abas e transmite a todas as abas do ML', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 3 }, { id: 4 }] as never);
    const { geracao, sessao } = await lerAba(3);
    await registrarEstado(3, { geracao, sessao, entrada: { mlItemId: 'MLB1' }, resposta: { ok: true } });
    expect(await estadoDaAba(3)).not.toBeNull();
    const antes = epocaAtual();
    const p = definirAtiva(false);
    expect(epocaAtual()).not.toBe(antes); // síncrona: pedido em voo já é descartado
    await p;
    expect(local.ativa).toBe(false);
    expect(await estadoDaAba(3)).toBeNull();
    const msg = { tipo: 'publiai:ativacao', ativa: false, logado: true, geracao: epocaAtual() };
    expect(chrome.tabs.query).toHaveBeenCalledWith({ url: 'https://*.mercadolivre.com.br/*' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(3, msg);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(4, msg);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(msg);
  });

  it('religar grava e transmite ativa:true sem limpar as abas', async () => {
    local.ativa = false;
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 3 }] as never);
    const { geracao, sessao } = await lerAba(3);
    await registrarEstado(3, { geracao, sessao, entrada: {}, resposta: 1 });
    const antes = epocaAtual();
    await definirAtiva(true);
    expect(local.ativa).toBe(true);
    expect(epocaAtual()).toBe(antes);
    expect(await estadoDaAba(3)).not.toBeNull();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(3, { tipo: 'publiai:ativacao', ativa: true, logado: true, geracao: antes });
  });

  it('aba ou painel fechados (sendMessage rejeita) não derrubam', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 3 }] as never);
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('no receiver'));
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error('no receiver'));
    await expect(definirAtiva(false)).resolves.toBeUndefined();
  });
});
