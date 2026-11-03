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
let statusSessao: number;
// Enriquecimento (Task 10): cota por catálogo, conta ML, falha de rede e trava próprias; pedidos à parte de `corpos`.
let enrCota: number;
let enrConta: string;
let falharEnr: boolean;
let bloqueioEnr: Promise<void> | null;
let antesDeEnriquecer: (() => Promise<void> | void) | null;
let sellerPorItem: boolean;
let perfisConsultados: number;
type PedidoEnr = { catalogos: { catalogProductId: string; componentes: string[]; itens: { itemId: string; preco: number }[] }[]; perfis: number[]; perfisEmCache: number[]; perfisRestantes?: number };
const sellerDe = (itemId: string) => (sellerPorItem ? Number(itemId.slice(3)) : 7);
const pedidosEnr: PedidoEnr[] = [];
const isoDe = (ms: number) => new Date(ms).toISOString();
function respostaEnr(b: PedidoEnr) {
  const agora = Date.now();
  const catalogos = b.catalogos.map((c) => {
    if (enrCota <= 0) return { catalogProductId: c.catalogProductId, estado: 'aguardando', retomarEm: isoDe((Math.floor(agora / 60_000) + 1) * 60_000), consultadoEm: null };
    enrCota--;
    return {
      catalogProductId: c.catalogProductId, estado: 'ok', retomarEm: null, consultadoEm: isoDe(agora),
      ...(c.componentes.includes('produto') ? { produto: { estado: 'ok', criadoEm: '2026-06-01T00:00:00Z', expiraEm: isoDe(agora + 6 * 3600_000) } } : {}),
      ...(c.componentes.includes('ofertas') ? { ofertas: { estado: 'ok', expiraEm: isoDe(agora + 60_000), total: 2, lidas: 2, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true,
        exatas: c.itens.map((i) => ({ itemId: i.itemId, estado: 'ok', categoriaId: 'MLB5', sellerId: sellerDe(i.itemId), tipo: 'gold_special', perfil: 'carregado', comissaoNaSuaConta: { estado: 'ok', valor: { percentual: 14, fixa: 0 } } })) } } : {}),
    };
  });
  // Como a edge: explícitos + vendedores das ofertas exatas, menos os em cache; até 5 e até o saldo da busca.
  const sellers = [...new Set([...b.perfis, ...b.catalogos.filter((c) => c.componentes.includes('ofertas') && enrCota >= 0).flatMap((c) => c.itens.map((i) => sellerDe(i.itemId)))])]
    .filter((x) => !b.perfisEmCache.includes(x));
  const teto = Math.min(5, b.perfisRestantes ?? 5);
  perfisConsultados += Math.min(sellers.length, teto);
  const vendedores = [
    ...sellers.slice(0, teto).map((x) => ({ sellerId: x, estado: 'ok', nome: `V${x}`, medalha: 'gold', uf: 'SP', expiraEm: isoDe(agora + 24 * 3600_000) })),
    ...sellers.slice(teto).map((x) => (teto < 5 ? { sellerId: x, estado: 'indisponivel', motivo: 'limite de perfis da busca' } : { sellerId: x, estado: 'aguardando', retomarEm: null, motivo: 'limite de perfis por pedido' })),
  ];
  return { estado: 'ok', valor: { consultadoEm: isoDe(agora), catalogos, conta: enrConta, custo: { comandosRedis: 1, chamadasMl: 1 }, vendedores } };
}
const corpos: { acao: string; itens: { itemId: string; preco?: number; catalogProductId: string | null }[]; registrarUso?: boolean }[] = [];
const doTipo = (acao: string) => corpos.filter((c) => c.acao === acao);

async function edge(u: string, init?: RequestInit): Promise<Response> {
  if (String(u).includes('/auth/v1/token')) {
    if (aoRenovar) { const f = aoRenovar; aoRenovar = null; await f(); }
    return new Response(JSON.stringify({ access_token: 'tok-novo', refresh_token: 'ref-novo', expires_in: 3600, user: { id: 'u1' } }), { status: 200 });
  }
  const b = JSON.parse(String(init?.body));
  const env = (dados: unknown) => new Response(JSON.stringify({ identidade: b.identidadeEsperada, dados }), { status: 200 });
  if (b.acao === 'sessao') {
    if (statusSessao !== 200) { const st = statusSessao; statusSessao = 200; corpos.push(b); return new Response(JSON.stringify({ erro: 'x' }), { status: st }); }
    return new Response(JSON.stringify({ identidade: 'u1:org1:', dados: {} }), { status: 200 });
  }
  if (b.acao === 'enriquecer_catalogos_busca') {
    pedidosEnr.push(b);
    if (bloqueioEnr) await bloqueioEnr;
    if (antesDeEnriquecer) { const f = antesDeEnriquecer; antesDeEnriquecer = null; await f(); }
    if (falharEnr) return new Response(JSON.stringify({ erro: 'interno' }), { status: 500 });
    return env(respostaEnr(b));
  }
  corpos.push(b);
  if (bloqueio) await bloqueio;
  if (antesDeResponder) await antesDeResponder(b.acao);
  if (b.acao === 'identificar_busca') {
    if (falharIdentificar) return new Response(JSON.stringify({ erro: 'interno' }), { status: 500 });
    if (b.registrarUso === true) registros++;
    return env({ contaMl: enrConta, itens: b.itens.map((i: { itemId: string }) => ({ itemId: i.itemId, proprio: false, vinculo: vinculados.has(i.itemId) ? { fonte: 'catalogo', codigo: `SKU-${i.itemId}` } : null })) });
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
  statusSessao = 200;
  enrCota = Infinity;
  enrConta = 'conta-a';
  falharEnr = false;
  bloqueioEnr = null;
  antesDeEnriquecer = null;
  sellerPorItem = false;
  perfisConsultados = 0;
  pedidosEnr.length = 0;
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
    expect(pedidosEnr).toHaveLength(0);
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
    expect(pedidosEnr).toHaveLength(0);
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
    expect(pedidosEnr).toHaveLength(0);
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

  it('identidade desconhecida (recém-logado): resolvida antes da rodada → identifica de primeira e registra o uso UMA vez', async () => {
    logar({ identidade: null });
    await registrar([card(1)]);
    expect((await estado())!.resposta.metadados[id(1)]).toBeDefined();
    expect((await estado())!.resposta.usoRegistrado).toBe(true);
    await pulso();
    await registrar([card(2)]);
    expect(registros).toBe(1);
    expect(doTipo('identificar_busca').map((c) => c.registrarUso)).toEqual([true, false]);
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

  it('identidade desconhecida + sessão com falha transitória (503): pede retomada; o pulso conclui com 1 registro', async () => {
    logar({ identidade: null });
    statusSessao = 503;
    await registrar([card(1)]);
    expect(doTipo('identificar_busca')).toHaveLength(0);
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(1);
    await pulso();
    expect((await estado())!.resposta.metadados[id(1)]).toBeDefined();
    expect(registros).toBe(1);
  });

  it('identidade desconhecida + sessão recusada (401): para sem retomada', async () => {
    logar({ identidade: null });
    statusSessao = 401;
    await registrar([card(1)]);
    expect(doTipo('identificar_busca')).toHaveLength(0);
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
  });

  it('desligada: cards e pulso não chamam nada', async () => {
    await chrome.storage.local.set({ ativa: false });
    await registrar(cards(1, 3));
    await pulso();
    expect(corpos).toHaveLength(0);
    expect(pedidosEnr).toHaveLength(0);
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

// Task 10: fila progressiva do enriquecimento (plano, Revisão 03/11, regras 1-3, 5, 6 e 10).
type EstadoEnr = { catalogos: Record<string, { aguardandoJanela?: boolean; produto?: { estado: string }; ofertas?: { estado: string } }>; vendedores: Record<string, { estado: string; medalha?: string }>; retomarEm: number | null; falhou: boolean };
const enr = async () => ((await lerAba(7)).estado as unknown as { resposta: { enriquecimento?: EstadoEnr } } | null)?.resposta.enriquecimento;
const CAT = 'MLB1000000';

describe('enriquecimento dos catálogos (fila progressiva)', () => {
  it('dez cards do mesmo catálogo → um pedido com uma entrada; scroll e painel juntos não duplicam', async () => {
    let soltar!: () => void;
    bloqueioEnr = new Promise((r) => { soltar = r; });
    await enviarCards(cards(1, 10));
    await vi.waitFor(() => expect(pedidosEnr).toHaveLength(1));
    await enviarCards(cards(1, 10).map((c) => ({ ...c, miniaturaUrl: 'https://http2.mlstatic.com/x.jpg' })));
    const painel = rotear({ tipo: 'publiai:analisar-busca', tabId: 7 }, PAINEL);
    soltar();
    await painel;
    await complementosPendentes();
    expect(pedidosEnr).toHaveLength(1);
    expect(pedidosEnr[0].catalogos).toEqual([{ catalogProductId: CAT, componentes: ['produto', 'ofertas'], itens: cards(1, 10).map((c) => ({ itemId: c.itemId, preco: 10 })) }]);
    const e = (await enr())!;
    expect(e.catalogos[CAT]).toMatchObject({ produto: { estado: 'ok' }, ofertas: { estado: 'ok' } });
    expect(e.vendedores['7']).toMatchObject({ estado: 'ok', medalha: 'gold' });
    expect(mensagensPagina('publiai:busca-resultados').at(-1)!.enriquecimento).toMatchObject({ catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
  });

  it('catálogo em cache válido (outra busca) não vai à edge nem gasta cota', async () => {
    await registrar([card(1)]);
    expect(pedidosEnr).toHaveLength(1);
    const OUTRA = 'https://lista.mercadolivre.com.br/frigideira';
    await aoAtualizarAba(7, { url: OUTRA });
    geracaoCs = null;
    await registrar([card(1)], { ...BUSCA, tab: { id: 7, url: OUTRA } as chrome.tabs.Tab, url: OUTRA });
    expect(pedidosEnr).toHaveLength(1);
    expect((await enr())!.catalogos[CAT]).toMatchObject({ ofertas: { estado: 'ok' } });
    expect((await enr())!.vendedores['7']).toMatchObject({ estado: 'ok' });
  });

  it('janela esgotada: aguardando + pulso; pulso antes da janela não chama; depois retoma', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:10Z'));
    enrCota = 0;
    await registrar([card(1)]);
    expect((await enr())!.catalogos[CAT]).toEqual({ aguardandoJanela: true });
    expect((await enr())!.retomarEm).toBe(Date.parse('2026-11-03T12:01:00Z'));
    expect(mensagensPagina('publiai:busca-retomar').length).toBeGreaterThan(0);
    await pulso();
    expect(pedidosEnr).toHaveLength(1);
    vi.setSystemTime(Date.parse('2026-11-03T12:01:11Z'));
    enrCota = 10;
    await pulso();
    expect(pedidosEnr).toHaveLength(2);
    expect((await enr())!.catalogos[CAT]).toMatchObject({ ofertas: { estado: 'ok' } });
  });

  it('reinício do SW com catálogo pendente: o pulso seguinte retoma do estado guardado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:10Z'));
    enrCota = 0;
    await registrar([card(1)]);
    vi.resetModules();
    const novo = await import('../roteador');
    vi.setSystemTime(Date.parse('2026-11-03T12:01:11Z'));
    enrCota = 10;
    await novo.rotearMensagem({ tipo: 'publiai:busca-pulso', geracao: geracaoCs }, BUSCA);
    await novo.complementosPendentes();
    expect(pedidosEnr).toHaveLength(2);
    expect((await enr())!.catalogos[CAT]).toMatchObject({ produto: { estado: 'ok' } });
  });

  it('resposta antiga depois da pausa: nada gravado na aba nem no cache', async () => {
    antesDeEnriquecer = async () => { await rotear({ tipo: 'publiai:definir-ativa', ativa: false }, PAINEL); };
    await registrar([card(1)]);
    expect(await enr()).toBeUndefined();
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
  });

  it('falha de rede: "Tentar novamente" sem repetição automática; o painel refaz uma vez', async () => {
    falharEnr = true;
    await registrar([card(1)]);
    expect((await enr())!.falhou).toBe(true);
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
    await pulso();
    await registrar([card(2)]);
    expect(pedidosEnr).toHaveLength(1);
    falharEnr = false;
    await rotear({ tipo: 'publiai:analisar-busca', tabId: 7, retentar: true }, PAINEL);
    await complementosPendentes();
    expect(pedidosEnr).toHaveLength(2);
    expect((await enr())!).toMatchObject({ falhou: false, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
  });

  it('conta ML trocada: a identificação da página seguinte detecta antes de reusar o cache; abas e cache limpos', async () => {
    await registrar([card(1)]);
    expect((await chrome.storage.session.get('enr:cache'))['enr:cache']).toMatchObject({ conta: 'conta-a' });
    enrConta = 'conta-b';
    const OUTRA = 'https://lista.mercadolivre.com.br/frigideira';
    await aoAtualizarAba(7, { url: OUTRA });
    geracaoCs = null;
    const antes = pedidosEnr.length;
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    await registrar([card(1)], { ...BUSCA, tab: { id: 7, url: OUTRA } as chrome.tabs.Tab, url: OUTRA });
    // A comissão em cache (da conta A) nunca chega à página: nada de enriquecimento antes da limpeza.
    expect(mensagensPagina('publiai:busca-resultados').some((m) => m.enriquecimento && Object.keys((m.enriquecimento as { catalogos: object }).catalogos).length)).toBe(false);
    expect(pedidosEnr.length).toBe(antes);
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
    expect(await estado()).toBeNull();
  });

  it('busca parada: ao voltar a ficar visível revalida a conta (sem itens, sem uso, ≤ 1 vez/5 min); outra conta → limpa e reprocessa', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:00Z'));
    await registrar([card(1)]);
    const vazios = () => doTipo('identificar_busca').filter((c) => c.itens.length === 0);
    const visivel = async () => { await rotear({ tipo: 'publiai:busca-visivel', geracao: geracaoCs }, BUSCA); await complementosPendentes(); };
    await visivel(); // logo depois da identificação: já verificada há < 5 min
    expect(vazios()).toHaveLength(0);
    vi.setSystemTime(Date.parse('2026-11-03T12:06:00Z'));
    await visivel(); // mesma conta: grava a verificação, nada limpo
    expect(vazios()).toHaveLength(1);
    expect(vazios()[0].registrarUso).toBe(false);
    expect((await enr())!.catalogos[CAT]).toMatchObject({ ofertas: { estado: 'ok' } });
    await visivel();
    expect(vazios()).toHaveLength(1); // ≤ 1 vez a cada 5 min
    enrConta = 'conta-b';
    vi.setSystemTime(Date.parse('2026-11-03T12:12:00Z'));
    await visivel();
    expect(vazios()).toHaveLength(2);
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
    expect(await estado()).toBeNull();
    // A página é avisada (sessao-mudou) e reenvia os cards: reprocessa com a conta nova.
    expect(mensagensPagina('publiai:sessao-mudou').length).toBeGreaterThan(0);
  });

  it('identificação atrasada (conta antiga) depois da navegação não limpa o estado novo', async () => {
    await registrar([card(1)]);
    const sessaoAntes = (await chrome.storage.session.get('geracao-sessao'))['geracao-sessao'];
    enrConta = 'conta-b';
    antesDeResponder = async (acao) => { if (acao === 'identificar_busca') { antesDeResponder = null; await aoAtualizarAba(7, { url: 'https://lista.mercadolivre.com.br/frigideira' }); } };
    await registrar([card(1), card(2)]);
    expect((await chrome.storage.session.get('geracao-sessao'))['geracao-sessao']).toBe(sessaoAntes);
    expect((await chrome.storage.session.get('enr:cache'))['enr:cache']).toMatchObject({ conta: 'conta-a' });
  });

  it('conta ML desconhecida (edge antiga, sem contaMl): o cache não é reutilizado', async () => {
    await registrar([card(1)]);
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const r = await edge(String(u), init);
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (b.acao !== 'identificar_busca') return r;
      const j = await r.json();
      delete j.dados.contaMl;
      return new Response(JSON.stringify(j), { status: 200 });
    });
    const OUTRA = 'https://lista.mercadolivre.com.br/frigideira';
    await aoAtualizarAba(7, { url: OUTRA });
    geracaoCs = null;
    await registrar([card(1)], { ...BUSCA, tab: { id: 7, url: OUTRA } as chrome.tabs.Tab, url: OUTRA });
    expect(pedidosEnr).toHaveLength(2);
  });

  it('teto de 20 perfis por busca: depois de 20, nenhum perfil a mais (nem os automáticos)', async () => {
    sellerPorItem = true;
    await registrar(Array.from({ length: 30 }, (_, i) => card(i + 1, { catalogProductId: `MLB${2000000 + i}` })));
    expect(pedidosEnr.length).toBeGreaterThanOrEqual(6);
    expect(perfisConsultados).toBe(20);
    expect(pedidosEnr.at(-1)!.perfisRestantes).toBe(0);
  });

});
