// Busca automática no SW (ADR-0189 emenda 2026-11-02, Task 3): registrar cards → identificar no banco → margem só dos
// vinculados elegíveis, painel aberto ou fechado, com isolamento de sessão e de página.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epocaAtual, lerAba, limparEstadosDasAbas } from '../abas';
import { aoAtualizarAba, complementosPendentes, rotearMensagem as rotearBruto } from '../roteador';
import { sair } from '../credenciais';
import { instalarChromeFalso, local, logar } from './chrome-falso';

type Sender = chrome.runtime.MessageSender;
const PAINEL: Sender = { id: 'ext-publiai', url: 'chrome-extension://ext-publiai/src/painel/index.html' };
const URL_BUSCA = 'https://lista.mercadolivre.com.br/panela';
const BUSCA: Sender = { id: 'ext-publiai', tab: { id: 7, url: URL_BUSCA } as chrome.tabs.Tab, url: URL_BUSCA };
const rotear = (msg: Record<string, unknown>, s: Sender) => rotearBruto(s === PAINEL ? { geracao: epocaAtual(), ...msg } : msg, s);
const id = (n: number) => `MLB${1000000 + n}`;
const card = (n: number, o: Record<string, unknown> = {}) =>
  ({ itemId: id(n), catalogProductId: 'MLB1000000', preco: 10, titulo: id(n), selos: [], patrocinado: false, miniaturaUrl: null, ocorrencias: [], ...o });
const cards = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => card(de + i));

// Edge falsa no protocolo 2: identificar_busca pelo conjunto `vinculados` (registrarUso true → 1 registro de uso);
// analisar_busca com cota por minuto (sem o campo, legado: 1 registro por reserva; false: nenhum).
let vinculados: Set<string>;
let cota: number;
let registros: number;
let bloqueio: Promise<void> | null;
let antesDeResponder: ((acao: string) => Promise<void> | void) | null;
let falharIdentificar: boolean;
let aoRenovar: (() => Promise<void>) | null;
const corpos: { acao: string; itens: { itemId: string; preco?: number; catalogProductId: string | null }[]; registrarUso?: boolean }[] = [];
const doTipo = (acao: string) => corpos.filter((c) => c.acao === acao);

async function edge(u: string, init?: RequestInit): Promise<Response> {
  if (String(u).includes('/auth/v1/token')) {
    if (aoRenovar) { const f = aoRenovar; aoRenovar = null; await f(); }
    return new Response(JSON.stringify({ access_token: 'tok-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } }), { status: 200 });
  }
  const b = JSON.parse(String(init?.body));
  const env = (dados: unknown) => new Response(JSON.stringify({ identidade: b.identidadeEsperada, dados }), { status: 200 });
  if (b.acao === 'sessao') return new Response(JSON.stringify({ identidade: 'u1:org1:', dados: {} }), { status: 200 });
  corpos.push(b);
  if (bloqueio) await bloqueio;
  if (antesDeResponder) await antesDeResponder(b.acao);
  if (b.acao === 'identificar_busca') {
    if (falharIdentificar) return new Response(JSON.stringify({ erro: 'interno' }), { status: 500 });
    if (b.registrarUso === true) registros++;
    return env({ itens: b.itens.map((i: { itemId: string }) => ({ itemId: i.itemId, proprio: false, vinculo: vinculados.has(i.itemId) ? { fonte: 'catalogo', codigo: `SKU-${i.itemId}` } : null })) });
  }
  if (b.acao === 'analisar_busca') {
    let limiteAtingido = false, usoRegistrado = false;
    const itens = b.itens.map((i: { itemId: string }) => {
      if (!vinculados.has(i.itemId)) return { itemId: i.itemId, estado: 'sem_vinculo' };
      const base = { itemId: i.itemId, fonte: 'catalogo', codigo: `SKU-${i.itemId}` };
      if (limiteAtingido || cota <= 0) { limiteAtingido = true; return { ...base, estado: 'limite' }; }
      cota--;
      if (b.registrarUso === undefined || (b.registrarUso && !usoRegistrado)) registros++;
      usoRegistrado ||= b.registrarUso !== false;
      return { ...base, estado: 'ok', margem: { preco: 10 }, custo: { fonte: 'catalogo' } };
    });
    return env({ itens, limiteAtingido, usoRegistrado });
  }
  return env({});
}

beforeEach(() => {
  instalarChromeFalso();
  vi.stubGlobal('fetch', vi.fn(edge));
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-publica');
  logar();
  vinculados = new Set();
  cota = Infinity;
  registros = 0;
  bloqueio = null;
  antesDeResponder = null;
  falharIdentificar = false;
  aoRenovar = null;
  geracaoCs = null;
  corpos.length = 0;
});
afterEach(async () => { await complementosPendentes(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// Geração da página como o content script a conhece: começa sem; o SW responde geracao_antiga com a atual e ele reenvia.
let geracaoCs: string | null;
const enviarCards = async (lista: object[], s: Sender = BUSCA) => {
  const msg = { tipo: 'publiai:busca-cards', url: s.url, cards: lista, ocorrencias: lista.length };
  let r = await rotear({ ...msg, geracao: geracaoCs }, s) as { ok?: boolean; erro?: string; geracao?: string } | undefined;
  if (r?.erro === 'geracao_antiga') { geracaoCs = r.geracao!; r = await rotear({ ...msg, geracao: geracaoCs }, s) as typeof r; }
  return r;
};
const registrar = async (lista: object[], s: Sender = BUSCA) => {
  await enviarCards(lista, s);
  await complementosPendentes();
};
const pulso = async (s: Sender = BUSCA, geracao = geracaoCs) => { await rotear({ tipo: 'publiai:busca-pulso', geracao }, s); await complementosPendentes(); };
type Estado = { resposta: { resultados: Record<string, { estado: string }>; metadados: Record<string, { vinculo: unknown }>; precoDaMargem: Record<string, number>; limiteEm: number | null; usoRegistrado: boolean } };
const estado = async () => (await lerAba(7)).estado as unknown as Estado | null;
const mensagensPagina = (tipo: string) => vi.mocked(chrome.tabs.sendMessage).mock.calls.filter(([t, m]) => t === 7 && (m as { tipo: string }).tipo === tipo).map(([, m]) => m as Record<string, unknown>);

describe('análise automática da busca (painel fechado)', () => {
  it('60 cards: identificação em lotes 50+10; margem só dos vinculados com preço; sem vínculo vira sem_vinculo sem cota', async () => {
    vinculados = new Set([id(1), id(2), id(55), id(3)]);
    await registrar(cards(1, 60).map((c) => (c.itemId === id(3) ? card(3, { preco: null }) : c)));
    expect(doTipo('identificar_busca').map((c) => c.itens.length)).toEqual([50, 10]);
    expect(doTipo('analisar_busca')).toHaveLength(1);
    expect(doTipo('analisar_busca')[0].itens.map((i) => i.itemId)).toEqual([id(1), id(2), id(55)]);
    const e = (await estado())!;
    expect(Object.keys(e.resposta.metadados)).toHaveLength(60);
    expect(e.resposta.metadados[id(1)].vinculo).toEqual({ fonte: 'catalogo', codigo: `SKU-${id(1)}` });
    expect(e.resposta.resultados[id(1)].estado).toBe('ok');
    expect(e.resposta.precoDaMargem[id(1)]).toBe(10);
    expect(e.resposta.resultados[id(4)].estado).toBe('sem_vinculo');
    // Resultado vai à página com a geração e a URL (o content script descarta o de outra página).
    const ultima = mensagensPagina('publiai:busca-resultados').at(-1)!;
    expect(ultima).toMatchObject({ url: URL_BUSCA, geracao: geracaoCs });
    expect(Object.keys(ultima.metadados as object)).toHaveLength(60);
  });

  it('card vinculado sem preço não vai à margem', async () => {
    vinculados = new Set([id(1)]);
    await registrar([card(1, { preco: null })]);
    expect(doTipo('identificar_busca')).toHaveLength(1);
    expect(doTipo('analisar_busca')).toHaveLength(0);
  });

  it('abrir o painel durante o processamento não duplica chamadas', async () => {
    vinculados = new Set([id(1), id(2)]);
    let soltar!: () => void;
    bloqueio = new Promise((r) => { soltar = r; });
    const reg = registrar(cards(1, 60));
    await vi.waitFor(() => expect(corpos).toHaveLength(1));
    const painel = rotear({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    const estadoPainel = rotear({ tipo: 'publiai:estado-da-aba', tabId: 7 }, PAINEL);
    soltar();
    bloqueio = null;
    await Promise.all([reg, painel, estadoPainel]);
    await complementosPendentes();
    expect(doTipo('identificar_busca')).toHaveLength(2);
    expect(doTipo('analisar_busca')).toHaveLength(1);
    expect(await painel).toMatchObject({ ok: true });
  });

  it('cards novos do scroll são identificados sem repetir os já identificados', async () => {
    await registrar(cards(1, 20));
    await registrar(cards(21, 40));
    expect(doTipo('identificar_busca').map((c) => c.itens[0].itemId)).toEqual([id(1), id(21)]);
    expect(doTipo('identificar_busca').map((c) => c.itens.length)).toEqual([20, 20]);
  });

  it('pulso sem nada pendente não faz nenhuma chamada', async () => {
    await registrar(cards(1, 3));
    const antes = corpos.length;
    await pulso();
    expect(corpos.length).toBe(antes);
  });
});

describe('invalidação por item', () => {
  it('só a miniatura mudou: nada é refeito', async () => {
    vinculados = new Set([id(1)]);
    await registrar([card(1)]);
    await registrar([card(1, { miniaturaUrl: 'https://http2.mlstatic.com/D_1.jpg' })]);
    expect(doTipo('identificar_busca')).toHaveLength(1);
    expect(doTipo('analisar_busca')).toHaveLength(1);
    expect((await estado())!.resposta.resultados[id(1)].estado).toBe('ok');
  });

  it('preço mudou: margem refeita ao preço novo, vínculo mantido (sem nova identificação)', async () => {
    vinculados = new Set([id(1), id(2)]);
    await registrar([card(1), card(2)]);
    await registrar([card(1, { preco: 12 })]);
    expect(doTipo('identificar_busca')).toHaveLength(1);
    expect(doTipo('analisar_busca').at(-1)!.itens).toEqual([{ itemId: id(1), catalogProductId: 'MLB1000000', preco: 12 }]);
    expect((await estado())!.resposta.precoDaMargem[id(1)]).toBe(12);
  });

  it('catálogo mudou: vínculo e margem refeitos', async () => {
    vinculados = new Set([id(1)]);
    await registrar([card(1)]);
    await registrar([card(1, { catalogProductId: 'MLB2000000' })]);
    expect(doTipo('identificar_busca').at(-1)!.itens).toEqual([{ itemId: id(1), catalogProductId: 'MLB2000000' }]);
    expect(doTipo('analisar_busca').at(-1)!.itens[0]).toMatchObject({ catalogProductId: 'MLB2000000' });
  });

  it('preço mudou durante a margem: a resposta (do preço antigo) não é gravada', async () => {
    vinculados = new Set([id(1)]);
    antesDeResponder = async (acao) => {
      if (acao !== 'analisar_busca') return;
      antesDeResponder = null;
      void rotear({ tipo: 'publiai:busca-cards', geracao: geracaoCs, cards: [card(1, { preco: 15 })], ocorrencias: 1 }, BUSCA);
      await vi.waitFor(async () => expect(((await lerAba(7)).estado as { observado: { cards: { preco: number }[] } }).observado.cards[0].preco).toBe(15));
    };
    await registrar([card(1)]);
    await complementosPendentes();
    const e = (await estado())!;
    expect(doTipo('analisar_busca').map((c) => c.itens[0].preco)).toEqual([10, 15]);
    expect(e.resposta.precoDaMargem[id(1)]).toBe(15);
  });
});

describe('cota e telemetria', () => {
  it('60 cards em 3 lotes + retomada da cota = 1 registro de uso', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:10Z'));
    vinculados = new Set(cards(1, 60).map((c) => c.itemId));
    cota = 30;
    await registrar(cards(1, 20));
    await registrar(cards(21, 40));
    await registrar(cards(41, 60));
    const e = (await estado())!;
    // Minha margem aguardando cota: os que não couberam ficam 'limite' no estado (também os nunca enviados).
    expect(Object.values(e.resposta.resultados).filter((r) => r.estado === 'limite')).toHaveLength(30);
    expect(e.resposta.limiteEm).not.toBeNull();
    expect(mensagensPagina('publiai:busca-retomar').at(-1)).toMatchObject({ url: URL_BUSCA });
    // Pulso na mesma janela: nenhuma chamada (a cota não voltou).
    const antes = corpos.length;
    await pulso();
    expect(corpos.length).toBe(antes);
    // Próxima janela: retoma sem painel aberto.
    vi.setSystemTime(new Date('2026-11-02T12:01:05Z'));
    cota = 30;
    await pulso();
    const f = (await estado())!;
    expect(Object.values(f.resposta.resultados).filter((r) => r.estado === 'ok')).toHaveLength(60);
    expect(registros).toBe(1);
    expect(doTipo('identificar_busca').map((c) => c.registrarUso)).toEqual([true, false, false]);
    expect(doTipo('analisar_busca').every((c) => c.registrarUso === false)).toBe(true);
  });

  it('achado 3: busca sem nenhum vinculado também conta (1 registro, no 1º lote da identificação)', async () => {
    await registrar(cards(1, 60));
    expect(doTipo('analisar_busca')).toHaveLength(0);
    expect(doTipo('identificar_busca').map((c) => c.registrarUso)).toEqual([true, false]);
    expect(registros).toBe(1);
    expect((await estado())!.resposta.usoRegistrado).toBe(true);
  });

  it('achado 3: identificação falhou no 1º lote → o próximo (retomada) pede o registro de novo', async () => {
    falharIdentificar = true;
    await registrar([card(1)]);
    falharIdentificar = false;
    await pulso();
    expect(doTipo('identificar_busca').map((c) => c.registrarUso)).toEqual([true, true]);
    expect(registros).toBe(1);
  });

  it('nova URL de busca (nova geração) conta de novo', async () => {
    vinculados = new Set([id(1)]);
    await registrar([card(1)]);
    const OUTRA = 'https://lista.mercadolivre.com.br/frigideira';
    await aoAtualizarAba(7, { url: OUTRA });
    await registrar([card(1)], { ...BUSCA, tab: { id: 7, url: OUTRA } as chrome.tabs.Tab, url: OUTRA });
    expect(registros).toBe(2);
  });

  it('identificar_busca falhou (500): metadados ficam desconhecidos (nunca "não próprio") e o pulso tenta de novo', async () => {
    falharIdentificar = true;
    await registrar([card(1)]);
    const e = (await estado())!;
    expect(e.resposta.metadados[id(1)]).toBeUndefined();
    expect(e.resposta.resultados[id(1)]).toBeUndefined();
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(1);
    falharIdentificar = false;
    await pulso();
    expect((await estado())!.resposta.metadados[id(1)]).toMatchObject({ proprio: false });
  });
});

describe('isolamento de sessão e de página', () => {
  it('navegação durante a identificação: resposta descartada e a fila da página antiga para', async () => {
    vinculados = new Set([id(1)]);
    antesDeResponder = async () => { antesDeResponder = null; await aoAtualizarAba(7, { url: 'https://lista.mercadolivre.com.br/frigideira' }); };
    await registrar(cards(1, 60));
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(1);
    expect(mensagensPagina('publiai:busca-resultados')).toHaveLength(0);
  });

  it('pausa durante a identificação: nada gravado, nenhuma chamada a mais', async () => {
    vinculados = new Set([id(1)]);
    antesDeResponder = async () => {
      antesDeResponder = null;
      await rotear({ tipo: 'publiai:definir-ativa', ativa: false }, PAINEL);
    };
    await registrar(cards(1, 60));
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(1);
    await pulso();
    expect(corpos).toHaveLength(1);
  });

  it('logout durante a margem: nada gravado nem transmitido', async () => {
    vinculados = new Set([id(1)]);
    antesDeResponder = async (acao) => { if (acao === 'analisar_busca') { antesDeResponder = null; await sair(); } };
    await registrar([card(1)]);
    expect(await estado()).toBeNull();
    expect(mensagensPagina('publiai:busca-resultados').some((m) => (m.resultados as Record<string, { estado: string }>)[id(1)]?.estado === 'ok')).toBe(false);
  });

  it('suporte expirado na identificação: abas limpas e nenhuma chamada a mais', async () => {
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const b = JSON.parse(String(init?.body));
      if (b.acao === 'identificar_busca') { corpos.push(b); return new Response(JSON.stringify({ erro: 'sessao_suporte_expirada' }), { status: 403 }); }
      return edge(String(u), init);
    });
    await registrar(cards(1, 60));
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(1);
  });

  it('cards lidos numa URL e chegando depois de a aba ir para outra busca são ignorados', async () => {
    await enviarCards([card(2)]); // aprende a geração
    await complementosPendentes();
    corpos.length = 0;
    await rotear({ tipo: 'publiai:busca-cards', geracao: geracaoCs, url: 'https://lista.mercadolivre.com.br/antiga', cards: [card(1)], ocorrencias: 1 }, BUSCA);
    await complementosPendentes();
    expect(corpos).toHaveLength(0);
    await rotear({ tipo: 'publiai:busca-cards', geracao: geracaoCs, url: `${URL_BUSCA}#D[A:panela]`, cards: [card(1)], ocorrencias: 1 }, BUSCA);
    await complementosPendentes();
    expect(doTipo('identificar_busca').map((c) => c.itens[0].itemId)).toEqual([id(1)]);
  });

  it('identidade descoberta no meio (recém-logado): gravação recusada pede retomada e o pulso conclui', async () => {
    logar({ identidade: null });
    await registrar([card(1)]);
    expect((await estado())!.resposta.metadados[id(1)]).toBeUndefined();
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(1);
    await pulso();
    expect((await estado())!.resposta.metadados[id(1)]).toBeDefined();
  });

  it('achado 1: cards sem a geração da página (ou de outra) não entram; a resposta traz a atual', async () => {
    const r = await rotear({ tipo: 'publiai:busca-cards', url: URL_BUSCA, cards: [card(1)], ocorrencias: 1 }, BUSCA) as { erro: string; geracao: string };
    expect(r).toMatchObject({ ok: false, erro: 'geracao_antiga' });
    expect(typeof r.geracao).toBe('string');
    await complementosPendentes();
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(0);
  });

  it('achado 1: mensagem atrasada da sessão anterior, mesma URL, é descartada', async () => {
    await registrar([card(1)]);
    const velha = geracaoCs;
    await limparEstadosDasAbas(); // troca de sessão
    corpos.length = 0;
    const r = await rotear({ tipo: 'publiai:busca-cards', geracao: velha, url: URL_BUSCA, cards: [card(2)], ocorrencias: 1 }, BUSCA);
    await complementosPendentes();
    expect(r).toMatchObject({ erro: 'geracao_antiga' });
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(0);
    await pulso(BUSCA, velha);
    expect(corpos).toHaveLength(0);
  });

  it('achado 1: navegação (recarga, mesma URL) enquanto a mensagem espera na fila de escrita → descartada', async () => {
    await registrar([card(1)]);
    const velha = geracaoCs;
    corpos.length = 0;
    const msg = rotear({ tipo: 'publiai:busca-cards', geracao: velha, url: URL_BUSCA, cards: [card(2)], ocorrencias: 1 }, BUSCA);
    await aoAtualizarAba(7, { status: 'loading' });
    expect(await msg).toMatchObject({ erro: 'geracao_antiga' });
    await complementosPendentes();
    expect(await estado()).toBeNull();
    expect(corpos).toHaveLength(0);
  });

  it('achado 1: resultados e retomada vão à página com a geração que ela conhece', async () => {
    falharIdentificar = true;
    await registrar([card(1)]);
    expect(mensagensPagina('publiai:busca-retomar').at(-1)).toMatchObject({ geracao: geracaoCs, url: URL_BUSCA });
    falharIdentificar = false;
    await pulso();
    expect(mensagensPagina('publiai:busca-resultados').at(-1)).toMatchObject({ geracao: geracaoCs, url: URL_BUSCA });
  });

  it('achado 2: navegação durante a preparação da chamada (renovação do token) → nenhum fetch à edge', async () => {
    await registrar([card(1)]);
    corpos.length = 0;
    local.credenciais = { ...(local.credenciais as object), expiresAt: 1 };
    aoRenovar = () => aoAtualizarAba(7, { status: 'loading' });
    await registrar([card(2)]);
    expect(corpos).toHaveLength(0);
  });

  it('achado 2: preço mudou durante a preparação da margem → a chamada com o preço velho não sai', async () => {
    vinculados = new Set([id(1)]);
    antesDeResponder = (acao) => {
      if (acao !== 'identificar_busca') return;
      antesDeResponder = null;
      local.credenciais = { ...(local.credenciais as object), expiresAt: 1 }; // a margem vai renovar o token antes
      aoRenovar = async () => { await rotear({ tipo: 'publiai:busca-cards', geracao: geracaoCs, url: URL_BUSCA, cards: [card(1, { preco: 15 })], ocorrencias: 1 }, BUSCA); };
    };
    await registrar([card(1)]);
    await complementosPendentes();
    expect(doTipo('analisar_busca').map((c) => c.itens[0].preco)).toEqual([15]);
    expect((await estado())!.resposta.precoDaMargem[id(1)]).toBe(15);
  });

  it('desligada: cards e pulso não chamam nada', async () => {
    await chrome.storage.local.set({ ativa: false });
    await registrar(cards(1, 3));
    await pulso();
    expect(corpos).toHaveLength(0);
  });

  it('pulso de outra página (URL diferente da busca guardada) é ignorado; painel não manda pulso', async () => {
    falharIdentificar = true;
    await registrar([card(1)]);
    falharIdentificar = false;
    const antes = corpos.length;
    await pulso({ ...BUSCA, tab: { id: 7, url: 'https://lista.mercadolivre.com.br/outra' } as chrome.tabs.Tab, url: 'https://lista.mercadolivre.com.br/outra' });
    expect(corpos.length).toBe(antes);
    expect(rotear({ tipo: 'publiai:busca-pulso' }, PAINEL)).toBeUndefined();
  });

  it('reinício do SW: o estado guardado sobrevive e a próxima mensagem reconstrói o processamento', async () => {
    falharIdentificar = true;
    await registrar([card(1)]);
    falharIdentificar = false;
    vi.resetModules(); // SW novo: filas e época em memória zeradas; storage.session continua
    const novo = await import('../roteador');
    await novo.rotearMensagem({ tipo: 'publiai:busca-pulso', geracao: geracaoCs }, BUSCA);
    await novo.complementosPendentes();
    expect((await estado())!.resposta.metadados[id(1)]).toBeDefined();
  });
});
