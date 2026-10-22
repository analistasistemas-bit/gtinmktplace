import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, esquecerAba, esquecerEstado, lerAba, registrarEanDaAba, registrarEstado } from '../abas';
import { aoAtualizarAba, rotearMensagem } from '../roteador';
import { aoAlarme, receberMensagemExterna } from '../sessao';
import { instalarChromeFalso } from './chrome-falso';

type Sender = chrome.runtime.MessageSender;
const PAINEL: Sender = { id: 'ext-publiai', url: 'chrome-extension://ext-publiai/src/painel/index.html' };
const CONTEUDO: Sender = { id: 'ext-publiai', tab: { id: 7 } as chrome.tabs.Tab, url: 'https://produto.mercadolivre.com.br/MLB-1' };
const OUTRA_EXT: Sender = { id: 'outra', url: 'chrome-extension://outra/x.html' };
const fetchFalso = vi.fn();
// Última chamada à edge (o GET do HTML do anúncio para a data de criação roda em paralelo/depois).
const ultimaEdge = () => fetchFalso.mock.calls.filter(([u]) => !String(u).startsWith('https://produto.')).at(-1)!;

beforeEach(async () => {
  instalarChromeFalso();
  vi.stubGlobal('fetch', fetchFalso);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  fetchFalso.mockReset();
  fetchFalso.mockImplementation(async () => new Response('{"ok":1}', { status: 200 }));
  await receberMensagemExterna(
    { tipo: 'publiai:sessao', accessToken: 'tok', expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: 'Avil', identidade: 'u1:org1:' },
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
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1', eanDaBusca: '96385074' }, CONTEUDO);
    expect(JSON.parse(ultimaEdge()[1].body)).toMatchObject({ eanDaBusca: '7899941205918' });
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1', eanDaBusca: '96385074' }, { ...CONTEUDO, tab: { id: 9 } as chrome.tabs.Tab });
    expect(JSON.parse(ultimaEdge()[1].body).eanDaBusca).toBeNull();
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

  it('busca com termo textual (ean null) limpa a aba; anúncio seguinte vai com eanDaBusca null', async () => {
    await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: '7899941205918' }, CONTEUDO);
    expect(await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: null }, CONTEUDO)).toEqual({ ok: true });
    expect(await rotearMensagem({ tipo: 'publiai:ean-da-aba', tabId: 7 }, PAINEL)).toBeNull();
    await chamar({ acao: 'analisar_anuncio' }, CONTEUDO);
    expect(JSON.parse(ultimaEdge()[1].body).eanDaBusca).toBeNull();
  });

  it('limpar só afeta a aba do remetente; sem aba é ignorado', async () => {
    await registrarEanDaAba(8, '96385074');
    await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: null }, CONTEUDO); // aba 7
    expect(await eanDaAba(8)).toBe('96385074');
    expect(rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: null }, PAINEL)).toBeUndefined();
  });

  it('EAN vale só para o 1º anúncio aberto depois da busca: A usa → B sem EAN → volta a A usa', async () => {
    const eanEnviado = () => JSON.parse(ultimaEdge()[1].body).eanDaBusca;
    await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: '7899941205918' }, CONTEUDO);
    await aoAtualizarAba(7, { status: 'loading' }); // lista → ficha A
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1' }, CONTEUDO);
    expect(eanEnviado()).toBe('7899941205918');
    await aoAtualizarAba(7, { status: 'loading' }); // A → B (recomendado, sem nova busca)
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB2' }, CONTEUDO);
    expect(eanEnviado()).toBeNull();
    await aoAtualizarAba(7, { status: 'loading' }); // volta / refresh de A
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1' }, CONTEUDO);
    expect(eanEnviado()).toBe('7899941205918');
  });

  it('nova busca troca o EAN e solta o vínculo com o anúncio anterior', async () => {
    const eanEnviado = () => JSON.parse(ultimaEdge()[1].body).eanDaBusca;
    await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: '7899941205918' }, CONTEUDO);
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1' }, CONTEUDO);
    await rotearMensagem({ tipo: 'publiai:ean-da-busca', ean: '96385074' }, CONTEUDO);
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB2' }, CONTEUDO);
    expect(eanEnviado()).toBe('96385074');
    await chamar({ acao: 'analisar_anuncio', mlItemId: 'MLB1' }, CONTEUDO);
    expect(eanEnviado()).toBeNull();
  });

  it('esquecerAba (usado no tabs.onRemoved) limpa a aba', async () => {
    await registrarEanDaAba(7, '7899941205918');
    await esquecerAba(7);
    expect(await eanDaAba(7)).toBeNull();
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

describe('estado da aba (painel)', () => {
  const ANUNCIO = { acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100 };
  const estado = (tabId: unknown, sender: Sender = PAINEL) => rotearMensagem({ tipo: 'publiai:estado-da-aba', tabId }, sender);

  it('guarda {entrada, resposta} da análise do content script e avisa o painel', async () => {
    await registrarEanDaAba(7, '7899941205918');
    await chamar(ANUNCIO, CONTEUDO);
    expect(await estado(7)).toEqual({
      entrada: { tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100, eanDaBusca: '7899941205918' },
      resposta: { ok: true, dados: { ok: 1 } },
      observado: { vendidosTexto: null, criadoEm: null },
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
  });

  it('observado (faixa + data de criação do gtm_event) fica no estado e não vai à edge (ADR-0189 D-9)', async () => {
    fetchFalso.mockImplementation(async (url: string) => url.startsWith('https://produto.mercadolivre.com.br/')
      ? new Response('x"gtm_event":{"pageId":"VIP","itemId":"MLB1","startTime":"2026-08-02T13:30:56.845Z"}x', { status: 200 })
      : new Response('{"ok":1}', { status: 200 }));
    await chamar({ ...ANUNCIO, vendidosTexto: '+1000 vendidos' }, CONTEUDO);
    await vi.waitFor(async () => expect(await estado(7)).toMatchObject({ observado: { vendidosTexto: '+1000 vendidos', criadoEm: '2026-08-02T13:30:56.845Z' } }));
    expect(fetchFalso).toHaveBeenCalledWith('https://produto.mercadolivre.com.br/MLB-1', expect.objectContaining({ credentials: 'include' }));
    const corpoEdge = fetchFalso.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.body).find((b) => typeof b === 'string');
    expect(corpoEdge).not.toContain('vendidos');
    // Cache por item: segunda análise não busca de novo (nem depois de falha).
    fetchFalso.mockClear();
    await chamar(ANUNCIO, CONTEUDO);
    expect(fetchFalso.mock.calls.some(([u]) => String(u).startsWith('https://produto.'))).toBe(false);
  });

  it('Codex: HTML lento não segura a resposta (selo); a data entra no estado depois', async () => {
    let soltar!: (r: Response) => void;
    fetchFalso.mockImplementation(async (url: string) => url.startsWith('https://produto.')
      ? new Promise<Response>((r) => { soltar = r; })
      : new Response('{"ok":1}', { status: 200 }));
    const r = await chamar({ ...ANUNCIO, mlItemId: 'MLB8' }, CONTEUDO);
    expect(r).toEqual({ ok: true, dados: { ok: 1 } });
    expect(await estado(7)).toMatchObject({ observado: { criadoEm: null } });
    soltar(new Response('"gtm_event":{"itemId":"MLB8","startTime":"2026-01-01T00:00:00Z"}', { status: 200 }));
    await vi.waitFor(async () => expect(await estado(7)).toMatchObject({ observado: { criadoEm: '2026-01-01T00:00:00Z' } }));
  });

  it('Codex: data que chega depois de a aba navegar não ressuscita o anúncio anterior', async () => {
    let soltar!: (r: Response) => void;
    fetchFalso.mockImplementation(async (url: string) => url.startsWith('https://produto.')
      ? new Promise<Response>((r) => { soltar = r; })
      : new Response('{"ok":1}', { status: 200 }));
    await chamar({ ...ANUNCIO, mlItemId: 'MLB9' }, CONTEUDO);
    await aoAtualizarAba(7, { status: 'loading' });
    soltar(new Response('"gtm_event":{"itemId":"MLB9","startTime":"2026-01-01T00:00:00Z"}', { status: 200 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(await estado(7)).toBeNull();
  });

  it('erro também é guardado (o painel mostra sem_sessao/modulo_desligado)', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"erro":"modulo_desligado"}', { status: 403 }));
    await chamar(ANUNCIO, CONTEUDO);
    expect(await estado(7)).toMatchObject({ resposta: { ok: false, erro: 'modulo_desligado' } });
  });

  it('análise vinda do painel não sobrescreve o estado da aba', async () => {
    await chamar({ ...ANUNCIO, preco: 150 }, PAINEL);
    expect(await estado(7)).toBeNull();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('só páginas da extensão leem; tabId numérico; esquecerEstado limpa', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    expect(estado(7, CONTEUDO)).toBeUndefined();
    expect(estado('7')).toBeUndefined();
    await esquecerEstado(7);
    expect(await estado(7)).toBeNull();
  });

  it('reanalisar-aba refaz a análise com a entrada guardada e atualiza o estado', async () => {
    await registrarEanDaAba(7, '7899941205918');
    await chamar(ANUNCIO, CONTEUDO);
    fetchFalso.mockImplementation(async () => new Response('{"novo":1}', { status: 200 }));
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    expect(await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL)).toEqual({ ok: true, dados: { novo: 1 } });
    expect(JSON.parse(ultimaEdge()[1].body)).toMatchObject({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', preco: 100, eanDaBusca: '7899941205918' });
    expect(await estado(7)).toMatchObject({ resposta: { ok: true, dados: { novo: 1 } } });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
    expect(await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 8 }, PAINEL)).toBeNull();
    expect(rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, CONTEUDO)).toBeUndefined();
  });

  it('análise de catálogo guarda tipoPagina e a reanálise do painel o reenvia', async () => {
    await chamar({ ...ANUNCIO, tipoPagina: 'catalogo' }, CONTEUDO);
    await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL);
    expect(JSON.parse(ultimaEdge()[1].body)).toMatchObject({ acao: 'analisar_anuncio', tipoPagina: 'catalogo' });
  });

  it('aba começou a carregar outra página (tabs.onUpdated loading) → esquece o estado e avisa o painel', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    await aoAtualizarAba(7, { status: 'complete' });
    expect(await estado(7)).not.toBeNull();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    await aoAtualizarAba(7, { status: 'loading' });
    expect(await estado(7)).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
  });

  it('navegação só com url (pushState, sem status loading) também esquece o estado', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    await aoAtualizarAba(7, { url: 'https://produto.mercadolivre.com.br/MLB-2' });
    expect(await estado(7)).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
  });

  describe('mesma página de anúncio com outra URL (variação, hash, redirecionamento) mantém o painel', () => {
    const A = 'https://produto.mercadolivre.com.br/MLB-1-garrafa-_JM';
    const mantem = async (url: string) => {
      await aoAtualizarAba(7, { status: 'loading', url: A });
      await chamar(ANUNCIO, CONTEUDO);
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      await aoAtualizarAba(7, { url });
      expect(await estado(7)).not.toBeNull();
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    };
    it('troca de variação (query) no mesmo MLB', () => mantem(`${A}?variation=123`));
    it('só o hash', () => mantem(`${A}#polycard_client=search`));
    it('redirecionamento para /up/ com pdp_filters do mesmo item', () =>
      mantem('https://www.mercadolivre.com.br/garrafa/up/MLBU99?pdp_filters=item_id:MLB1'));
    it('pdp_filters codificado (item_id%3A)', () =>
      mantem('https://www.mercadolivre.com.br/garrafa/up/MLBU99?pdp_filters=item_id%3AMLB1'));

    const limpa = async (url: string) => {
      await aoAtualizarAba(7, { status: 'loading', url: A });
      await chamar(ANUNCIO, CONTEUDO);
      await aoAtualizarAba(7, { url });
      expect(await estado(7)).toBeNull();
    };
    it('outro MLB → limpa', () => limpa('https://produto.mercadolivre.com.br/MLB-2-outro-_JM'));
    it('catálogo com outro vencedor → limpa', () => limpa('https://www.mercadolivre.com.br/x/p/MLB5?pdp_filters=item_id:MLB7'));
    it('página sem anúncio (lista) → limpa', () => limpa('https://lista.mercadolivre.com.br/garrafa'));
    it('Codex: busca com MLB- na URL não é o mesmo anúncio → limpa', () => limpa('https://lista.mercadolivre.com.br/MLB-1'));
    it('Codex: busca com pdp_filters do mesmo item não é anúncio → limpa', () =>
      limpa('https://lista.mercadolivre.com.br/garrafa?pdp_filters=item_id:MLB1'));
    it('Codex: catálogo sem item explícito (vencedor pode ter mudado) → limpa, mesmo repetindo a URL', async () => {
      const C = 'https://www.mercadolivre.com.br/garrafa/p/MLB777';
      await aoAtualizarAba(7, { status: 'loading', url: C });
      await chamar(ANUNCIO, CONTEUDO);
      await aoAtualizarAba(7, { url: `${C}#reviews` });
      expect(await estado(7)).toBeNull();
    });
    it('recarga ou saída do ML (loading sem url) → limpa e esquece a chave', async () => {
      await aoAtualizarAba(7, { status: 'loading', url: A });
      await chamar(ANUNCIO, CONTEUDO);
      await aoAtualizarAba(7, { status: 'loading' });
      expect(await estado(7)).toBeNull();
      await chamar(ANUNCIO, CONTEUDO);
      await aoAtualizarAba(7, { url: A }); // voltou: chave esquecida → trata como página nova
      expect(await estado(7)).toBeNull();
    });
  });

  it('estado gravado com geração antiga é descartado na leitura (escrita atrasada não ressuscita o anúncio)', async () => {
    await aoAtualizarAba(7, { status: 'loading' });
    const { geracao: atual, sessao } = await lerAba(7);
    await registrarEstado(7, { geracao: 'geracao-velha', sessao, entrada: { mlItemId: 'MLB0' }, resposta: { ok: true } });
    expect(await estado(7)).toBeNull();
    await registrarEstado(7, { geracao: atual, sessao, entrada: { mlItemId: 'MLB1' }, resposta: { ok: true } });
    expect(await estado(7)).toEqual({ entrada: { mlItemId: 'MLB1' }, resposta: { ok: true } });
  });

  it('análise do content script em voo → aba navega (loading) → resposta atrasada não regrava o anúncio anterior', async () => {
    fetchFalso.mockImplementation(async () => {
      await aoAtualizarAba(7, { status: 'loading' });
      return new Response('{"ok":1}', { status: 200 });
    });
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: true, dados: { ok: 1 } }); // o selo ainda recebe
    expect(await estado(7)).toBeNull();
    // A página nova analisa normalmente (geração capturada depois do loading).
    fetchFalso.mockImplementation(async () => new Response('{"ok":2}', { status: 200 }));
    await chamar(ANUNCIO, CONTEUDO);
    expect(await estado(7)).toMatchObject({ resposta: { ok: true, dados: { ok: 2 } } });
  });

  it('reanalisar-aba não regrava se a aba navegou durante a chamada', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    fetchFalso.mockImplementation(async () => {
      await aoAtualizarAba(7, { status: 'loading' });
      return new Response('{"novo":1}', { status: 200 });
    });
    await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL);
    expect(await estado(7)).toBeNull();
  });

  it('falha ao guardar o estado não derruba a análise', async () => {
    vi.mocked(chrome.storage.session.set).mockRejectedValueOnce(new Error('quota'));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: true, dados: { ok: 1 } });
  });

  it('painel fechado (sendMessage rejeita) não derruba a análise', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValueOnce(new Error('Receiving end does not exist'));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: true, dados: { ok: 1 } });
  });
});

describe('identidade da sessão (ADR-0189: dado financeiro de uma org nunca aparece para outra)', () => {
  const APP = { origin: 'https://app.publiai.daludi.com.br' } as Sender;
  const ANUNCIO = { acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100 };
  const conectar = (identidade: unknown, accessToken = `tok-${identidade}`) => receberMensagemExterna(
    { tipo: 'publiai:sessao', accessToken, expiresAt: Math.floor(Date.now() / 1000) + 3600, orgNome: '', identidade }, APP,
  );
  const estado = () => rotearMensagem({ tipo: 'publiai:estado-da-aba', tabId: 7 }, PAINEL);
  const ean = () => rotearMensagem({ tipo: 'publiai:ean-da-aba', tabId: 7 }, PAINEL);

  beforeEach(async () => {
    await conectar('uA:orgA:');
    fetchFalso.mockImplementation(async () => new Response('{"custo":"da org A"}', { status: 200 }));
    await registrarEanDaAba(7, '7899941205918');
    await chamar(ANUNCIO, CONTEUDO);
    expect(await estado()).not.toBeNull();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
  });

  it('A → logout → B na mesma aba do ML: nada de A (estado, EAN), painel avisado e selo retirado', async () => {
    await receberMensagemExterna({ tipo: 'publiai:desconectar' }, APP);
    expect(await estado()).toBeNull();
    expect(await ean()).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { tipo: 'publiai:sessao-mudou' });
    await conectar('uB:orgB:');
    expect(await estado()).toBeNull();
    expect(await ean()).toBeNull();
  });

  it('troca direta A → B (sem logout) limpa tudo', async () => {
    await conectar('uB:orgB:');
    expect(await estado()).toBeNull();
    expect(await ean()).toBeNull();
  });

  it('início/fim de suporte (mesmo usuário, outro contexto) limpa tudo', async () => {
    await conectar('uA:orgS:req1');
    expect(await estado()).toBeNull();
  });

  it('renovação do token na mesma identidade mantém a análise', async () => {
    await conectar('uA:orgA:', 'tok-renovado');
    expect(await estado()).toMatchObject({ resposta: { ok: true, dados: { custo: 'da org A' } } });
  });

  it('org vazia (perfil carregando no app) não limpa nem apaga a org conhecida: A → vazio → outra org limpa', async () => {
    await conectar('uA::');
    expect(await estado()).not.toBeNull();
    await conectar('uA:orgX:');
    expect(await estado()).toBeNull();
  });

  it('expiração passiva (chrome.alarms): sessão de 120 s, relógio +180 s, alarme dispara SEM pedir estado → tudo apagado', async () => {
    const curta = Math.floor(Date.now() / 1000) + 120;
    await receberMensagemExterna({ tipo: 'publiai:sessao', accessToken: 'tok-curto', expiresAt: curta, orgNome: '', identidade: 'uA:orgA:' }, APP);
    expect(chrome.alarms.create).toHaveBeenLastCalledWith('sessao-expira', { when: curta * 1000 - 30_000 });
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 180_000);
    try {
      await aoAlarme({ name: 'sessao-expira' } as chrome.alarms.Alarm);
    } finally {
      vi.useRealTimers();
    }
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { tipo: 'publiai:sessao-mudou' });
    expect(chrome.alarms.clear).toHaveBeenCalledWith('sessao-expira');
    expect(await ean()).toBeNull();
    expect(await estado()).toBeNull();
    expect(await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL)).toEqual({ ok: false, erro: 'sem_sessao' });
  });

  it('alarme de outro nome ou sessão ainda válida não apaga nada', async () => {
    await aoAlarme({ name: 'outro' } as chrome.alarms.Alarm);
    await aoAlarme({ name: 'sessao-expira' } as chrome.alarms.Alarm); // token de 1 h ainda vale
    expect(await estado()).not.toBeNull();
  });

  it('desconectar limpa o alarme; sessão nova reagenda', async () => {
    await receberMensagemExterna({ tipo: 'publiai:desconectar' }, APP);
    expect(chrome.alarms.clear).toHaveBeenCalledWith('sessao-expira');
    vi.mocked(chrome.alarms.create).mockClear();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await receberMensagemExterna({ tipo: 'publiai:sessao', accessToken: 't2', expiresAt: exp, orgNome: '', identidade: 'uB:orgB:' }, APP);
    expect(chrome.alarms.create).toHaveBeenCalledWith('sessao-expira', { when: exp * 1000 - 30_000 });
  });

  it('sessão vencida sem nenhuma chamada: o painel que pede o estado não recebe a análise e o selo sai', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 3600_000); // token de 1 h já venceu
    try {
      expect(await estado()).toBeNull();
      expect(await ean()).toBeNull();
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { tipo: 'publiai:sessao-mudou' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sessão vencida descoberta numa chamada: limpa antes de responder sem_sessao', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 3600_000);
    try {
      expect(await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL)).toEqual({ ok: false, erro: 'sem_sessao' });
    } finally {
      vi.useRealTimers();
    }
    expect(await estado()).toBeNull();
  });

  it('sessão expirada (401) limpa as abas', async () => {
    fetchFalso.mockImplementation(async () => new Response('', { status: 401 }));
    await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL);
    expect(await estado()).toBeNull();
  });

  it('sessão de suporte expirada limpa as abas (o token segue)', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"erro":"sessao_suporte_expirada"}', { status: 403 }));
    await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL);
    expect(await estado()).toBeNull();
  });

  it('análise em voo de A responde depois da troca para B: descartada (sem_sessao) e não volta para a aba', async () => {
    fetchFalso.mockImplementation(async () => {
      await conectar('uB:orgB:');
      return new Response('{"custo":"da org A, atrasado"}', { status: 200 });
    });
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(JSON.stringify((await estado()) ?? null)).not.toContain('org A');
    // Confirmação de preço do painel em voo também é descartada.
    fetchFalso.mockImplementation(async () => {
      await conectar('uC:orgC:');
      return new Response('{"custo":"da org B, atrasado"}', { status: 200 });
    });
    expect(await chamar({ ...ANUNCIO, preco: 150 }, PAINEL)).toEqual({ ok: false, erro: 'sem_sessao' });
  });

  // Troca de identidade logo depois da checagem do api.ts (identidadeAtual) e antes de gravar/responder.
  const trocarDepoisDaChecagem = (troca: () => Promise<unknown>) => {
    const get = chrome.storage.session.get;
    let armado = false;
    chrome.storage.session.get = vi.fn(async (k: string | string[] | null) => {
      const v = await get(k);
      if (armado && k === 'sessao') { armado = false; await troca(); }
      return v;
    }) as never;
    fetchFalso.mockImplementation(async () => { armado = true; return new Response('{"custo":"da org A"}', { status: 200 }); });
  };

  it('Grok ALTO (a): troca A → B entre a checagem e a gravação → sem_sessao, nada gravado, painel sem A', async () => {
    trocarDepoisDaChecagem(() => conectar('uB:orgB:'));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(await estado()).toBeNull();
  });

  it('Grok ALTO (b): 1ª análise numa aba sem chave prévia + logout no meio → painel vazio e a aba é avisada', async () => {
    vi.mocked(chrome.tabs.query).mockImplementation((async () => [{ id: 9 }]) as never);
    const aba9: Sender = { ...CONTEUDO, tab: { id: 9 } as chrome.tabs.Tab };
    trocarDepoisDaChecagem(() => receberMensagemExterna({ tipo: 'publiai:desconectar' }, APP));
    expect(await chamar(ANUNCIO, aba9)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(await rotearMensagem({ tipo: 'publiai:estado-da-aba', tabId: 9 }, PAINEL)).toBeNull();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, { tipo: 'publiai:sessao-mudou' });
  });

  it('Grok ALTO (c): estado com geração de sessão antiga ou ausente é descartado por lerAba', async () => {
    const { geracao, sessao } = await lerAba(7);
    await registrarEstado(7, { geracao, sessao: sessao - 1, entrada: {}, resposta: 1 });
    expect((await lerAba(7)).estado).toBeNull();
    await registrarEstado(7, { geracao, entrada: {}, resposta: 1 } as never);
    expect((await lerAba(7)).estado).toBeNull();
    await registrarEstado(7, { geracao, sessao, entrada: {}, resposta: 1 });
    expect((await lerAba(7)).estado).toEqual({ entrada: {}, resposta: 1 });
  });

  it('Codex: sessão vence com a análise em voo e o alarme atrasado → sem_sessao, nada gravado, selo retirado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      fetchFalso.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 2 * 3600_000); // token de 1 h venceu; alarme não disparou
        return new Response('{"custo":"da org A"}', { status: 200 });
      });
      vi.mocked(chrome.tabs.sendMessage).mockClear();
      expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
      expect((await lerAba(7)).estado).toBeNull();
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { tipo: 'publiai:sessao-mudou' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Grok ALTO (d): sem troca, a análise segue gravada e respondida', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"custo":"da org A 2"}', { status: 200 }));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: true, dados: { custo: 'da org A 2' } });
    expect(await estado()).toMatchObject({ resposta: { ok: true, dados: { custo: 'da org A 2' } } });
  });

  it('identidade malformada é recusada (e não limpa nada)', async () => {
    for (const identidade of ['', ':orgA:', 'uA:orgA', 'uA:org A:', 1, undefined]) {
      expect(await conectar(identidade)).toEqual({ ok: false });
    }
    expect(await estado()).not.toBeNull();
  });
});
