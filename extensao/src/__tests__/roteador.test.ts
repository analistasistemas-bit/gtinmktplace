import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eanDaAba, esquecerAba, esquecerEstado, lerAba, registrarEanDaAba, registrarEstado } from '../abas';
import { aoAtualizarAba, complementosPendentes, rotearMensagem } from '../roteador';
import { sair } from '../credenciais';
import { definirIdentidade } from '../sessao';
import { instalarChromeFalso, local, logar } from './chrome-falso';

type Sender = chrome.runtime.MessageSender;
const PAINEL: Sender = { id: 'ext-publiai', url: 'chrome-extension://ext-publiai/src/painel/index.html' };
const CONTEUDO: Sender = { id: 'ext-publiai', tab: { id: 7 } as chrome.tabs.Tab, url: 'https://produto.mercadolivre.com.br/MLB-1' };
const OUTRA_EXT: Sender = { id: 'outra', url: 'chrome-extension://outra/x.html' };
const fetchFalso = vi.fn();
// Última chamada à edge (o GET do HTML do anúncio para a data de criação roda em paralelo/depois).
const ultimaEdge = () => fetchFalso.mock.calls.filter(([u]) => !String(u).startsWith('https://produto.')).at(-1)!;

// Edge no protocolo 2: o 200 de fetchFalso volta no envelope com a identidade esperada (a edge real recusa com 409
// se ela divergir; esse caminho é testado em api.test.ts).
async function edgeProtocolo2(u: string, init?: RequestInit): Promise<Response> {
  const r: Response = await fetchFalso(u, init);
  if (!String(u).endsWith('/functions/v1/extensao') || r.status !== 200) return r;
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
      expect(await chamar({ acao: 'buscar_sku', termo: 'x' }, PAINEL)).toEqual({ ok: true, dados: { custo: 'da org A' } });
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

  it('access vencido e refresh recusado, descoberto numa chamada: limpa antes de responder sem_sessao', async () => {
    refreshRecusado();
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
