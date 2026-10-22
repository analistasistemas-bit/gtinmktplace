import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registrarEanDaAba } from '../abas';
import { rotearMensagem } from '../roteador';
import { receberMensagemExterna } from '../sessao';
import { instalarChromeFalso } from './chrome-falso';

type Sender = chrome.runtime.MessageSender;
const PAINEL: Sender = { id: 'ext-publiai', url: 'chrome-extension://ext-publiai/src/painel/index.html' };
const CONTEUDO: Sender = { id: 'ext-publiai', tab: { id: 7 } as chrome.tabs.Tab, url: 'https://produto.mercadolivre.com.br/MLB-1' };
const OUTRA_EXT: Sender = { id: 'outra', url: 'chrome-extension://outra/x.html' };
const fetchFalso = vi.fn();

beforeEach(async () => {
  instalarChromeFalso();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  fetchFalso.mockReset();
  fetchFalso.mockImplementation(async () => new Response('{"ok":1}', { status: 200 }));
  await receberMensagemExterna(
    { tipo: 'publiai:sessao', accessToken: 'tok', expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: 'Avil' },
    { origin: 'https://app.publiai.daludi.com.br' },
  );
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const chamar = (corpo: unknown, sender: Sender) => rotearMensagem({ tipo: 'publiai:chamar', corpo }, sender);

describe('publiai:chamar', () => {
  it('painel tem o conjunto completo de ações', async () => {
    for (const acao of ['analisar_anuncio', 'buscar_sku', 'salvar_vinculo', 'remover_vinculo', 'erro_leitura']) {
      expect(await chamar({ acao }, PAINEL)).toEqual({ ok: true, dados: { ok: 1 } });
    }
    expect(fetchFalso).toHaveBeenCalledTimes(5);
  });

  it('content script só pode analisar_anuncio e erro_leitura', async () => {
    expect(await chamar({ acao: 'analisar_anuncio' }, CONTEUDO)).toMatchObject({ ok: true });
    expect(await chamar({ acao: 'erro_leitura' }, CONTEUDO)).toMatchObject({ ok: true });
    fetchFalso.mockClear();
    for (const acao of ['buscar_sku', 'salvar_vinculo', 'remover_vinculo', 'qualquer']) {
      expect(await chamar({ acao }, CONTEUDO)).toEqual({ ok: false, erro: 'payload_invalido' });
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('analisar_anuncio do content script leva o EAN da própria aba, ignorando o enviado', async () => {
    await registrarEanDaAba(7, '7899941205918');
    await registrarEanDaAba(8, '96385074');
    await chamar({ acao: 'analisar_anuncio', eanDaBusca: '96385074' }, CONTEUDO);
    expect(JSON.parse(fetchFalso.mock.calls.at(-1)![1].body)).toMatchObject({ eanDaBusca: '7899941205918' });
    await chamar({ acao: 'analisar_anuncio', eanDaBusca: '96385074' }, { ...CONTEUDO, tab: { id: 9 } as chrome.tabs.Tab });
    expect(JSON.parse(fetchFalso.mock.calls.at(-1)![1].body).eanDaBusca).toBeNull();
  });

  it('remetente sem aba e fora da extensão não chama nada', async () => {
    const semAba: Sender = { id: 'ext-publiai', url: 'https://evil.com/' };
    expect(await chamar({ acao: 'analisar_anuncio' }, semAba)).toEqual({ ok: false, erro: 'payload_invalido' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('corpo inválido → payload_invalido sem rede', async () => {
    for (const corpo of [null, 'x', [], { acao: 1 }, {}]) {
      expect(await chamar(corpo, PAINEL)).toEqual({ ok: false, erro: 'payload_invalido' });
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('outra extensão é ignorada', () => {
    expect(chamar({ acao: 'analisar_anuncio' }, OUTRA_EXT)).toBeUndefined();
  });
});

describe('EAN por aba', () => {
  it('content script registra pelo sender.tab.id; EAN inválido ignorado', async () => {
    expect(await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: '7899941205918' }, CONTEUDO)).toEqual({ ok: true });
    expect(rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: 'abc' }, CONTEUDO)).toBeUndefined();
    expect(await rotearMensagem({ tipo: 'publiai:ean-da-aba', tabId: 7 }, PAINEL)).toBe('7899941205918');
  });

  it('ean-da-aba só para páginas da extensão e com tabId numérico', async () => {
    await registrarEanDaAba(7, '7899941205918');
    expect(rotearMensagem({ tipo: 'publiai:ean-da-aba', tabId: 7 }, CONTEUDO)).toBeUndefined();
    expect(rotearMensagem({ tipo: 'publiai:ean-da-aba', tabId: '7' }, PAINEL)).toBeUndefined();
  });
});

describe('publiai:abrir-painel', () => {
  it('abre o painel da aba do content script, de forma síncrona', () => {
    expect(rotearMensagem({ tipo: 'publiai:abrir-painel' }, CONTEUDO)).toBeUndefined();
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  });
});
