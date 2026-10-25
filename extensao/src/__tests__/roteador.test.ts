import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, epocaAtual, esquecerAba, esquecerEstado, lerAba, registrarEanDaAba, registrarEstado } from '../abas';
import { aoAtualizarAba, complementosPendentes, rotearMensagem as rotearBruto } from '../roteador';
import { sair } from '../credenciais';
import { definirIdentidade } from '../sessao';
import { instalarChromeFalso, local, logar } from './chrome-falso';
import { URL_APP } from '../painel/formato';

type Sender = chrome.runtime.MessageSender;
const PAINEL: Sender = { id: 'ext-publiai', url: 'chrome-extension://ext-publiai/src/painel/index.html' };
const CONTEUDO: Sender = { id: 'ext-publiai', tab: { id: 7 } as chrome.tabs.Tab, url: 'https://produto.mercadolivre.com.br/MLB-1' };
const OUTRA_EXT: Sender = { id: 'outra', url: 'chrome-extension://outra/x.html' };
// Painel em dia: manda a geração (época do SW) da última resposta — aqui, a viva. Testes de geração antiga usam rotearBruto.
const rotearMensagem = (msg: unknown, s: Sender) =>
  rotearBruto(s === PAINEL && typeof msg === 'object' && msg !== null && !('geracao' in msg) ? { geracao: epocaAtual(), ...msg } : msg, s);
const fetchFalso = vi.fn();
// Última chamada à edge (o GET do HTML do anúncio para a data de criação roda em paralelo/depois).
const ultimaEdge = () => fetchFalso.mock.calls.filter(([u]) => !String(u).startsWith('https://produto.')).at(-1)!;

// Edge no protocolo 2: o 200 de fetchFalso volta no envelope com a identidade esperada (a edge real recusa com 409
// se ela divergir; esse caminho é testado em api.test.ts).
async function edgeProtocolo2(u: string, init?: RequestInit): Promise<Response> {
  const r: Response = await fetchFalso(u, init);
  if (!String(u).endsWith('/functions/v1/extensao') || r.status !== 200 || JSON.parse(String(init?.body)).acao === 'sessao') return r;
  const texto = await r.text();
  const identidade = JSON.parse(String(init?.body)).identidadeEsperada;
  try {
    return new Response(JSON.stringify({ identidade, dados: JSON.parse(texto) }), { status: 200 });
  } catch {
    return new Response(texto, { status: 200 });
  }
}

beforeEach(async () => {
  instalarChromeFalso();
  vi.stubGlobal('fetch', edgeProtocolo2);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  fetchFalso.mockReset();
  fetchFalso.mockImplementation(async () => new Response('{"ok":1}', { status: 200 }));
  logar();
});
// Espera a busca da data em segundo plano: sem isso ela pode rodar depois de o `chrome` falso sair (CI).
afterEach(async () => { await complementosPendentes(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const chamar = (corpo: unknown, sender: Sender) => rotearMensagem({ tipo: 'publiai:chamar', corpo }, sender);

describe('publiai:chamar', () => {
  it('painel tem o conjunto completo de ações', async () => {
    for (const acao of ['analisar_anuncio', 'buscar_sku', 'salvar_vinculo', 'remover_vinculo', 'erro_leitura']) {
      expect(await chamar({ acao }, PAINEL)).toEqual({ ok: true, dados: { ok: 1 }, geracao: epocaAtual() });
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
      observado: { vendidosTexto: null, vendidosAnuncio: null, criadoEm: null, lojaOficial: null, qualidade: null },
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-atualizado', tabId: 7 });
  });

  it('observado (faixa + data de criação do gtm_event) fica no estado e não vai à edge (ADR-0189 D-9)', async () => {
    fetchFalso.mockImplementation(async (url: string) => url.startsWith('https://produto.mercadolivre.com.br/')
      ? new Response('x"subtitle_label":{"text":"Novo | 2 vendidos"} "gtm_event":{"pageId":"VIP","itemId":"MLB1","startTime":"2026-08-02T13:30:56.845Z"}x', { status: 200 })
      : new Response('{"ok":1}', { status: 200 }));
    await chamar({ ...ANUNCIO, vendidosTexto: '+1000 vendidos' }, CONTEUDO);
    await vi.waitFor(async () => expect(await estado(7)).toMatchObject({ observado: { vendidosTexto: '+1000 vendidos', vendidosAnuncio: '2 vendidos', criadoEm: '2026-08-02T13:30:56.845Z' } }));
    expect(fetchFalso).toHaveBeenCalledWith('https://produto.mercadolivre.com.br/MLB-1', expect.objectContaining({ credentials: 'include' }));
    const corpoEdge = fetchFalso.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.body).find((b) => typeof b === 'string');
    expect(corpoEdge).not.toContain('vendidos');
    // Cache por item: segunda análise não busca de novo (nem depois de falha).
    fetchFalso.mockClear();
    await chamar(ANUNCIO, CONTEUDO);
    expect(fetchFalso.mock.calls.some(([u]) => String(u).startsWith('https://produto.'))).toBe(false);
  });

  it('loja oficial fica no estado (painel) e não vai à edge; forma inválida vira null', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"ok":1}', { status: 200 }));
    await chamar({ ...ANUNCIO, lojaOficial: { nome: 'Tramontina' } }, CONTEUDO);
    expect(await estado(7)).toMatchObject({ observado: { lojaOficial: { nome: 'Tramontina' } } });
    const corpos = fetchFalso.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.body).filter((b) => typeof b === 'string');
    expect(corpos.join()).not.toContain('Tramontina');
    await chamar({ ...ANUNCIO, lojaOficial: { nome: 42 } }, CONTEUDO);
    expect(await estado(7)).toMatchObject({ observado: { lojaOficial: null } });
    await chamar({ ...ANUNCIO, lojaOficial: { nome: null } }, CONTEUDO);
    expect(await estado(7)).toMatchObject({ observado: { lojaOficial: { nome: null } } });
  });

  it('qualidade fica no estado (painel) e não vai à edge (D-1)', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"ok":1}', { status: 200 }));
    const qualidade = { fotos: [{ id: '670304-MLB90067766444_082025', largura: 521, altura: 749 }], clips: 1, descricao: 415, garantia: 'Sem garantia', disponivel: 16 };
    await chamar({ ...ANUNCIO, qualidade }, CONTEUDO);
    expect(await estado(7)).toMatchObject({ observado: { qualidade } });
    const corpos = fetchFalso.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.body).filter((b) => typeof b === 'string').join();
    for (const vazado of ['670304', 'Sem garantia', 'descricao', 'disponivel', 'qualidade']) expect(corpos).not.toContain(vazado);
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
    expect(await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL)).toEqual({ ok: true, dados: { novo: 1 }, geracao: epocaAtual() });
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
  const PERFIL = { nome: null, email: null, orgNome: null };
  const ANUNCIO = { acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100 };
  // Credenciais do usuário da identidade (como depois de entrar) + resposta da ação `sessao`.
  const conectar = async (identidade: string, accessToken = `tok-${identidade}`) => {
    logar({ accessToken, userId: identidade.split(':')[0], identidade: (local.credenciais as { identidade?: string } | undefined)?.identidade ?? null });
    return definirIdentidade(identidade, PERFIL);
  };
  const refreshRecusado = () => fetchFalso.mockImplementation(async (u: string) => String(u).includes('/auth/v1/token')
    ? new Response('{"error_code":"refresh_token_not_found"}', { status: 400 })
    : new Response('{"custo":"da org A"}', { status: 200 }));
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
    await sair();
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

  it('access vencido com refresh válido (Chrome reaberto): renova e a análise continua', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 3600_000); // access de 1 h já venceu
    try {
      fetchFalso.mockImplementation(async (u: string) => String(u).includes('/auth/v1/token')
        ? new Response(JSON.stringify({ access_token: 'acc-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'uA' } }), { status: 200 })
        : new Response('{"custo":"da org A"}', { status: 200 }));
      expect(await estado()).not.toBeNull();
      expect(await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL)).toEqual({ ok: true, dados: { custo: 'da org A' }, geracao: epocaAtual() });
      expect(ultimaEdge()[1].headers).toMatchObject({ Authorization: 'Bearer acc-novo' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('access vencido e refresh recusado, sem nenhuma chamada: o painel que pede o estado não recebe a análise e o selo sai', async () => {
    refreshRecusado();
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

  it('access vencido e refresh recusado, descoberto numa chamada: limpa antes de responder (painel: geracao_antiga, a sessão acabou durante o comando)', async () => {
    refreshRecusado();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 3600_000);
    try {
      expect(await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL)).toEqual({ ok: false, erro: 'geracao_antiga', geracao: epocaAtual() });
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
    expect(await chamar({ ...ANUNCIO, preco: 150 }, PAINEL)).toEqual({ ok: false, erro: 'geracao_antiga', geracao: epocaAtual() });
  });

  // Troca de identidade com a resposta da edge já recebida, enquanto o corpo é lido (fix round 3: o api.ts não lê
  // mais o storage depois da resposta — confere a época em memória —, então a janela é a leitura do corpo).
  const trocarDepoisDaChecagem = (troca: () => Promise<unknown>) => {
    fetchFalso.mockImplementation(async () => ({
      ok: true, status: 200,
      text: async () => { await troca(); return '{"custo":"da org A"}'; },
    }));
  };

  it('Grok ALTO (a): troca A → B entre a checagem e a gravação → sem_sessao, nada gravado, painel sem A', async () => {
    trocarDepoisDaChecagem(() => conectar('uB:orgB:'));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(await estado()).toBeNull();
  });

  it('Grok ALTO (b): 1ª análise numa aba sem chave prévia + logout no meio → painel vazio e a aba é avisada', async () => {
    vi.mocked(chrome.tabs.query).mockImplementation((async () => [{ id: 9 }]) as never);
    const aba9: Sender = { ...CONTEUDO, tab: { id: 9 } as chrome.tabs.Tab };
    trocarDepoisDaChecagem(() => sair());
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

  it('Grok ALTO (d): sem troca, a análise segue gravada e respondida', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"custo":"da org A 2"}', { status: 200 }));
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: true, dados: { custo: 'da org A 2' } });
    expect(await estado()).toMatchObject({ resposta: { ok: true, dados: { custo: 'da org A 2' } } });
  });

  it('identidade malformada é recusada (e não limpa nada)', async () => {
    for (const identidade of ['', ':orgA:', 'uA:orgA', 'uA:org A:', 1, undefined]) {
      expect(await definirIdentidade(identidade as never, PERFIL)).toBe(false);
    }
    expect(await estado()).not.toBeNull();
  });
});

describe('busca no SW (Task 22)', () => {
  const BUSCA: Sender = { id: 'ext-publiai', tab: { id: 7, url: 'https://lista.mercadolivre.com.br/panela' } as chrome.tabs.Tab, url: 'https://lista.mercadolivre.com.br/panela' };
  const card = (itemId: string, o: Record<string, unknown> = {}) => ({ itemId, catalogProductId: 'MLB100', preco: 10, titulo: itemId, selos: [], patrocinado: false, ...o });
  const URL_EAN = 'https://lista.mercadolivre.com.br/7899941205918_NoIndex_True';
  const BUSCA_EAN: Sender = { ...BUSCA, tab: { id: 7, url: URL_EAN } as chrome.tabs.Tab, url: URL_EAN };
  const analisesNaEdge = () => fetchFalso.mock.calls.filter(([, init]) => String((init as { body?: unknown })?.body ?? '').includes('analisar_busca'));
  const respostaEdge = (itens: object[]) => new Response(JSON.stringify({ itens, limiteAtingido: false }), { status: 200 });
  const estado = () => rotearMensagem({ tipo: 'publiai:estado-da-aba', tabId: 7 }, PAINEL) as Promise<{ observado: { cards: { itemId: string }[] }; resposta: { resultados: Record<string, { estado: string }> } } | null>;

  it('content script registra os cards da própria aba (validados); os do scroll somam', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001'), { itemId: 'X' }, card('MLB1000002')], ocorrencias: 3 }, BUSCA);
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000003')], ocorrencias: 4 }, BUSCA);
    expect((await estado())!.observado.cards.map((c) => c.itemId)).toEqual(['MLB1000001', 'MLB1000002', 'MLB1000003']);
  });

  it('painel analisa os pendentes (até 50) com o EAN da URL da busca e o content script recebe os resultados', async () => {
    await registrarEanDaAba(7, '96385074'); // EAN de outra busca da mesma aba: não vale
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001'), card('MLB1000002', { preco: null })], ocorrencias: 2 }, BUSCA_EAN);
    fetchFalso.mockImplementation(async () => new Response(JSON.stringify({ itens: [{ itemId: 'MLB1000001', estado: 'sem_vinculo' }], limiteAtingido: false }), { status: 200 }));
    const r = await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    expect(r).toMatchObject({ ok: true });
    const corpo = JSON.parse(ultimaEdge()[1].body);
    expect(corpo).toMatchObject({ acao: 'analisar_busca', eanDaBusca: '7899941205918', itens: [{ itemId: 'MLB1000001', preco: 10 }] });
    expect((await estado())!.resposta.resultados.MLB1000001.estado).toBe('sem_vinculo');
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ tipo: 'publiai:busca-resultados' }));
  });

  it('só o painel pede análise e destaque; content script não analisa a busca', async () => {
    expect(rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, BUSCA)).toBeUndefined();
    expect(rotearMensagem({ tipo: 'publiai:destacar-card', tabId: 7, itemId: 'MLB1000001' }, BUSCA)).toBeUndefined();
    expect(rotearMensagem({ tipo: 'publiai:busca-cards', cards: [] }, PAINEL)).toBeUndefined();
  });

  it('Grok: busca textual na mesma aba não herda o EAN guardado de busca anterior', async () => {
    await registrarEanDaAba(7, '7899941205918');
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')], ocorrencias: 1 }, BUSCA);
    fetchFalso.mockImplementation(async () => respostaEdge([{ itemId: 'MLB1000001', estado: 'sem_vinculo' }]));
    await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    expect(JSON.parse(ultimaEdge()[1].body).eanDaBusca).toBeNull();
  });

  it('Grok: cards do scroll durante a análise não apagam o resultado que chega', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')], ocorrencias: 1 }, BUSCA);
    fetchFalso.mockImplementation(async () => {
      await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000002')], ocorrencias: 2 }, BUSCA);
      return respostaEdge([{ itemId: 'MLB1000001', estado: 'sem_vinculo' }]);
    });
    await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000003')], ocorrencias: 3 }, BUSCA);
    const e = (await estado())!;
    expect(e.resposta.resultados.MLB1000001.estado).toBe('sem_vinculo');
    expect(e.observado.cards.map((c) => c.itemId)).toEqual(['MLB1000001', 'MLB1000002', 'MLB1000003']);
  });

  it('Grok: duas análises sobrepostas mandam o card à edge uma vez só (cota debitada uma vez)', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')], ocorrencias: 1 }, BUSCA);
    fetchFalso.mockImplementation(async () => respostaEdge([{ itemId: 'MLB1000001', estado: 'ok' }]));
    await Promise.all([
      rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL),
      rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL),
    ]);
    expect(analisesNaEdge()).toHaveLength(1);
  });

  it('Grok: card reenviado com preço novo perde o resultado e volta a pendente', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001', { preco: null })], ocorrencias: 1 }, BUSCA);
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')], ocorrencias: 1 }, BUSCA);
    fetchFalso.mockImplementation(async () => respostaEdge([{ itemId: 'MLB1000001', estado: 'sem_categoria' }]));
    await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001', { preco: 12, catalogProductId: 'MLB2000000' })], ocorrencias: 1 }, BUSCA);
    expect((await estado())!.resposta.resultados.MLB1000001).toBeUndefined();
    await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    expect(JSON.parse(ultimaEdge()[1].body).itens).toMatchObject([{ itemId: 'MLB1000001', catalogProductId: 'MLB2000000', preco: 12 }]);
  });

  it('Grok: só o hash mudou na busca → mantém cards; outra URL de busca → começa do zero', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')], ocorrencias: 1 }, BUSCA);
    await aoAtualizarAba(7, { url: 'https://lista.mercadolivre.com.br/panela#D[A:panela]' });
    expect((await estado())!.observado.cards).toHaveLength(1);
    await aoAtualizarAba(7, { url: 'https://lista.mercadolivre.com.br/frigideira' });
    expect(await estado()).toBeNull();
    const OUTRA: Sender = { ...BUSCA, tab: { id: 7, url: 'https://lista.mercadolivre.com.br/frigideira' } as chrome.tabs.Tab };
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000002')], ocorrencias: 1 }, OUTRA);
    expect((await estado())!.observado.cards.map((c) => c.itemId)).toEqual(['MLB1000002']);
  });

  it('cards de página que não é a busca do ML são ignorados', async () => {
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [card('MLB1000001')] }, { ...BUSCA, tab: { id: 7, url: 'https://evil.com/' } as chrome.tabs.Tab, url: 'https://evil.com/' });
    expect(await estado()).toBeNull();
  });
});

describe('conta, chave ativa e geração (Task 5)', () => {
  const PERFIL = { nome: null, email: null, orgNome: null };
  const ANUNCIO = { acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100 };
  const acoesNaEdge = () => fetchFalso.mock.calls
    .filter(([u]) => String(u).endsWith('/functions/v1/extensao'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)).acao);
  const estadoAba = () => rotearMensagem({ tipo: 'publiai:estado-da-aba', tabId: 7 }, PAINEL);
  const sessaoNaEdge = (identidade: string, dados: object) => fetchFalso.mockImplementation(async (_u: string, init?: RequestInit) =>
    JSON.parse(String(init?.body ?? '{}')).acao === 'sessao'
      ? new Response(JSON.stringify({ identidade, dados }), { status: 200 })
      : new Response('{"ok":1}', { status: 200 }));
  const ANTIGA = { ok: false, erro: 'geracao_antiga' };
  // Troca de org disparada dentro da leitura da chave `ativa` (o comando já passou pela conferência da geração).
  const trocarOrgAoLerAtiva = () => {
    const original = vi.mocked(chrome.storage.local.get).getMockImplementation()!;
    const armado = { sim: true };
    vi.mocked(chrome.storage.local.get).mockImplementation(async (k) => {
      if (armado.sim && k === 'ativa') { armado.sim = false; await definirIdentidade('u1:org2:', PERFIL); }
      return (original as (k: unknown) => Promise<Record<string, unknown>>)(k);
    });
    return armado;
  };

  it('comando com geração antiga (ex.: remover_vinculo pedido antes da troca de org) é recusado sem chamar a edge', async () => {
    const g = epocaAtual();
    await definirIdentidade('u1:org2:', PERFIL); // troca de org: época nova
    expect(epocaAtual()).not.toBe(g);
    fetchFalso.mockClear();
    expect(await rotearBruto({ tipo: 'publiai:chamar', corpo: { acao: 'remover_vinculo', vinculoId: 'v1' }, geracao: g }, PAINEL))
      .toEqual({ ...ANTIGA, geracao: epocaAtual() });
    for (const msg of [{ tipo: 'publiai:reanalisar-aba', tabId: 7 }, { tipo: 'publiai:analisar-busca', tabId: 7 }, { tipo: 'publiai:definir-ativa', ativa: false }, { tipo: 'publiai:sair' }]) {
      expect(await rotearBruto({ ...msg, geracao: g }, PAINEL)).toEqual({ ...ANTIGA, geracao: epocaAtual() });
    }
    for (const msg of [{ tipo: 'publiai:definir-ativa', ativa: false }, { tipo: 'publiai:sair' }]) {
      expect(await rotearBruto({ ...msg, geracao: g }, CONTEUDO)).toEqual({ ...ANTIGA, geracao: epocaAtual() });
    }
    // Sem geração (ou de outro tipo) = antiga: fail closed.
    expect(await rotearBruto({ tipo: 'publiai:chamar', corpo: { acao: 'buscar_sku' } }, PAINEL)).toMatchObject(ANTIGA);
    expect(await rotearBruto({ tipo: 'publiai:sair', geracao: String(epocaAtual()) }, CONTEUDO)).toMatchObject(ANTIGA);
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(local.credenciais).toBeDefined();
    expect(local.ativa).toBeUndefined();
  });

  it('troca de org durante a leitura da chave ativa: o comando (geração certa na chegada) não chega à edge', async () => {
    const armado = trocarOrgAoLerAtiva();
    fetchFalso.mockClear();
    expect(await rotearMensagem({ tipo: 'publiai:chamar', corpo: { acao: 'remover_vinculo', vinculoId: 'v1' } }, PAINEL)).toMatchObject(ANTIGA);
    expect(armado.sim).toBe(false);
    expect(acoesNaEdge()).toEqual([]);
  });

  it('troca de org durante a leitura da chave ativa: análise do content script e reanálise também não chegam à edge', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    let armado = trocarOrgAoLerAtiva();
    fetchFalso.mockClear();
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(armado.sim).toBe(false);
    expect(acoesNaEdge()).toEqual([]);
    logar({ identidade: 'u1:org1:' });
    await chamar(ANUNCIO, CONTEUDO);
    armado = trocarOrgAoLerAtiva();
    fetchFalso.mockClear();
    expect(await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL)).toMatchObject(ANTIGA);
    expect(armado.sim).toBe(false);
    expect(acoesNaEdge()).toEqual([]);
  });

  it('estado-extensao do painel chama sessao e, com identidade nova, limpa abas e transmite conta-mudou', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 7 }] as never);
    await chamar(ANUNCIO, CONTEUDO);
    expect(await estadoAba()).not.toBeNull();
    sessaoNaEdge('u1:org2:', { nome: 'Diego', email: 'd@x.com', orgNome: 'Org 2' });
    fetchFalso.mockClear();
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    const r = await rotearBruto({ tipo: 'publiai:estado-extensao', abrindo: true }, PAINEL);
    expect(r).toEqual({ ativa: true, logado: true, perfil: { nome: 'Diego', orgNome: 'Org 2' }, versao: '0.3.0', geracao: epocaAtual() });
    expect(acoesNaEdge()).toEqual(['sessao']);
    expect(await estadoAba()).toBeNull();
    const conta = { tipo: 'publiai:conta-mudou', logado: true, ativa: true, geracao: epocaAtual() };
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(conta);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, conta);
  });

  it('estado-extensao sem abrindo (selos lendo a chave) não vai à edge; menu do cabeçalho com abrindo vai', async () => {
    fetchFalso.mockClear();
    expect(await rotearBruto({ tipo: 'publiai:estado-extensao' }, CONTEUDO))
      .toEqual({ ativa: true, logado: true, perfil: { nome: 'Diego', orgNome: 'Avil' }, versao: '0.3.0', geracao: epocaAtual() });
    expect(fetchFalso).not.toHaveBeenCalled();
    sessaoNaEdge('u1:org1:', { nome: 'Diego', email: 'd@x.com', orgNome: 'Avil' });
    const antes = epocaAtual();
    await rotearBruto({ tipo: 'publiai:estado-extensao', abrindo: true }, CONTEUDO);
    expect(acoesNaEdge()).toEqual(['sessao']);
    expect(epocaAtual()).toBe(antes); // mesma identidade: nada limpo
  });

  it('estado-extensao sem login → logado:false, perfil:null (sem rede)', async () => {
    delete local.credenciais;
    local.ativa = false;
    fetchFalso.mockClear();
    for (const s of [PAINEL, CONTEUDO]) {
      expect(await rotearBruto({ tipo: 'publiai:estado-extensao', abrindo: true }, s))
        .toEqual({ ativa: false, logado: false, perfil: null, versao: '0.3.0', geracao: epocaAtual() });
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('estado-extensao: sem_acesso na abertura desloga localmente', async () => {
    fetchFalso.mockImplementation(async () => new Response('{"erro":"sem_acesso"}', { status: 403 }));
    expect(await rotearBruto({ tipo: 'publiai:estado-extensao', abrindo: true }, PAINEL)).toMatchObject({ logado: false, perfil: null });
    expect(local.credenciais).toBeUndefined();
  });

  it('estado da aba com mais de 10 min é reanalisado antes de chegar ao painel', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    const regravar = async (muda: (v: Record<string, unknown>) => Record<string, unknown>) => {
      const v = (await chrome.storage.session.get('estado:7'))['estado:7'] as Record<string, unknown>;
      await chrome.storage.session.set({ 'estado:7': muda(v) });
    };
    fetchFalso.mockImplementation(async () => new Response('{"novo":1}', { status: 200 }));
    fetchFalso.mockClear();
    expect(await estadoAba()).toMatchObject({ resposta: { ok: true, dados: { ok: 1 } } }); // fresco: sem reanálise
    expect(acoesNaEdge()).toEqual([]);
    await regravar((v) => ({ ...v, gravadoEm: Date.now() - 11 * 60_000 }));
    expect(await estadoAba()).toMatchObject({ resposta: { ok: true, dados: { novo: 1 } }, entrada: { mlItemId: 'MLB1' } });
    expect(acoesNaEdge()).toEqual(['analisar_anuncio']);
    // Sem gravadoEm (estado de antes da 0.3.0) = velho.
    await regravar(({ gravadoEm: _g, ...v }) => ({ ...v, resposta: { ok: true, dados: { ok: 1 } } }));
    expect(await estadoAba()).toMatchObject({ resposta: { ok: true, dados: { novo: 1 } } });
    expect(acoesNaEdge()).toEqual(['analisar_anuncio', 'analisar_anuncio']);
    // Desligada: o velho não chega ao painel nem vai à edge.
    await regravar((v) => ({ ...v, gravadoEm: 0 }));
    local.ativa = false;
    fetchFalso.mockClear();
    expect(await estadoAba()).toBeNull();
    expect(acoesNaEdge()).toEqual([]);
  });

  it('estado de busca não é reanalisado pela idade', async () => {
    const BUSCA: Sender = { id: 'ext-publiai', tab: { id: 7, url: 'https://lista.mercadolivre.com.br/panela' } as chrome.tabs.Tab, url: 'https://lista.mercadolivre.com.br/panela' };
    await rotearMensagem({ tipo: 'publiai:busca-cards', cards: [{ itemId: 'MLB1000001', catalogProductId: null, preco: 10, titulo: 'x', selos: [], patrocinado: false }], ocorrencias: 1 }, BUSCA);
    const v = (await chrome.storage.session.get('estado:7'))['estado:7'] as Record<string, unknown>;
    await chrome.storage.session.set({ 'estado:7': { ...v, gravadoEm: 0 } });
    fetchFalso.mockClear();
    expect(await estadoAba()).toMatchObject({ entrada: { tipoPagina: 'busca' } });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('entrar recusado quando o remetente é content script', async () => {
    delete local.credenciais;
    fetchFalso.mockClear();
    expect(rotearBruto({ tipo: 'publiai:entrar', email: 'a@x.com', senha: 'segredo-123' }, CONTEUDO)).toBeUndefined();
    expect(rotearBruto({ tipo: 'publiai:entrar', email: 'a@x.com', senha: 'segredo-123' }, OUTRA_EXT)).toBeUndefined();
    expect(rotearBruto({ tipo: 'publiai:entrar', email: 'a@x.com', senha: 1 }, PAINEL)).toBeUndefined();
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(local.credenciais).toBeUndefined();
  });

  it('entrar do painel: loga, busca o perfil, devolve o estado completo e a senha não fica em lugar nenhum', async () => {
    delete local.credenciais;
    fetchFalso.mockImplementation(async (u: string) => String(u).includes('/auth/v1/token')
      ? new Response(JSON.stringify({ access_token: 'tok-n', refresh_token: 'ref-n', expires_in: 3600, user: { id: 'u9' } }), { status: 200 })
      : new Response(JSON.stringify({ identidade: 'u9:org9:', dados: { nome: 'Ana', email: 'a@x.com', orgNome: 'Org 9' } }), { status: 200 }));
    const r = await rotearBruto({ tipo: 'publiai:entrar', email: 'a@x.com', senha: 'segredo-123' }, PAINEL);
    expect(r).toEqual({ ok: true, ativa: true, logado: true, perfil: { nome: 'Ana', orgNome: 'Org 9' }, versao: '0.3.0', geracao: epocaAtual() });
    expect(acoesNaEdge()).toEqual(['sessao']);
    expect(JSON.stringify(local)).not.toContain('segredo-123');
    expect(JSON.stringify(await chrome.storage.session.get(null))).not.toContain('segredo-123');
    expect(JSON.stringify(vi.mocked(chrome.runtime.sendMessage).mock.calls)).not.toContain('segredo-123');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:conta-mudou', logado: true, ativa: true, geracao: epocaAtual() });
  });

  it('entrar com senha errada → credenciais_invalidas, segue deslogado', async () => {
    delete local.credenciais;
    fetchFalso.mockImplementation(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await rotearBruto({ tipo: 'publiai:entrar', email: 'a@x.com', senha: 'errada' }, PAINEL))
      .toMatchObject({ ok: false, erro: 'credenciais_invalidas', logado: false, perfil: null });
  });

  it('desligada → chamar, reanalisar e analisar-busca não tocam a edge', async () => {
    await chamar(ANUNCIO, CONTEUDO);
    local.ativa = false;
    fetchFalso.mockClear();
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'inativa' });
    expect(await chamar({ acao: 'erro_leitura' }, CONTEUDO)).toEqual({ ok: false, erro: 'inativa' });
    expect(await chamar({ acao: 'buscar_sku' }, PAINEL)).toEqual({ ok: false, erro: 'inativa', geracao: epocaAtual() });
    expect(await rotearMensagem({ tipo: 'publiai:reanalisar-aba', tabId: 7 }, PAINEL)).toEqual({ ok: false, erro: 'inativa', geracao: epocaAtual() });
    expect(await rotearMensagem({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL)).toEqual({ ok: false, erro: 'inativa', geracao: epocaAtual() });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('deslogado → sem_sessao sem tocar a edge', async () => {
    delete local.credenciais;
    fetchFalso.mockClear();
    expect(await chamar({ acao: 'buscar_sku' }, PAINEL)).toEqual({ ok: false, erro: 'sem_sessao', geracao: epocaAtual() });
    expect(await chamar(ANUNCIO, CONTEUDO)).toEqual({ ok: false, erro: 'sem_sessao' });
    expect(acoesNaEdge()).toEqual([]); // (o HTML do anúncio, para a data, não é a edge)
  });

  it('menu do cabeçalho: definir-ativa, sair e abrir-app (com a geração atual)', async () => {
    const g = epocaAtual();
    const r = await rotearBruto({ tipo: 'publiai:definir-ativa', ativa: false, geracao: g }, CONTEUDO);
    expect(local.ativa).toBe(false);
    expect(epocaAtual()).not.toBe(g); // pausa abre época nova
    expect(r).toEqual({ ok: true, ativa: false, logado: true, perfil: { nome: 'Diego', orgNome: 'Avil' }, versao: '0.3.0', geracao: epocaAtual() });
    expect(rotearBruto({ tipo: 'publiai:definir-ativa', ativa: 'sim', geracao: epocaAtual() }, CONTEUDO)).toBeUndefined();
    expect(await rotearBruto({ tipo: 'publiai:definir-ativa', ativa: true, geracao: epocaAtual() }, PAINEL)).toMatchObject({ ok: true, ativa: true });
    expect(local.ativa).toBe(true);
    expect(await rotearBruto({ tipo: 'publiai:sair', geracao: epocaAtual() }, CONTEUDO)).toMatchObject({ ok: true, logado: false, perfil: null });
    expect(local.credenciais).toBeUndefined();
    // Deslogado: a chave não existe.
    expect(await rotearBruto({ tipo: 'publiai:definir-ativa', ativa: false, geracao: epocaAtual() }, PAINEL))
      .toEqual({ ok: false, erro: 'sem_sessao', geracao: epocaAtual() });
    expect(local.ativa).toBe(true);
    expect(rotearBruto({ tipo: 'publiai:abrir-app' }, CONTEUDO)).toBeUndefined();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: URL_APP });
    expect(rotearBruto({ tipo: 'publiai:abrir-app' }, PAINEL)).toBeUndefined();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
});
