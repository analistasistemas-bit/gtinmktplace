// Busca automática no SW (ADR-0189 emenda 2026-11-02, Task 3): registrar cards → identificar no banco → margem só dos
// vinculados elegíveis, painel aberto ou fechado, com isolamento de sessão e de página.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epocaAtual, lerAba, limparEstadosDasAbas } from '../abas';
import { aoAtualizarAba, complementosPendentes, rotearMensagem as rotearBruto } from '../roteador';
import { sair } from '../credenciais';
import { instalarChromeFalso, local, logar } from './chrome-falso';
import { haParaTentar, vistaDoCard, type EstadoEnriquecimento } from '../compartilhado/enriquecimento';

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
// Enriquecimento (Task 11.2): cota de PÁGINAS por minuto (uma unidade por pedido), conta ML, falha de rede, 429 nas
// ofertas com Retry-After e trava próprias; pedidos à parte de `corpos`.
let enrCota: number;
let enrConta: string;
let falharEnr: boolean;
/** Erro definitivo da edge (403 com o código) em cada ação; null = segue normal. */
let erroEnr: string | null;
let erroIdentificar: string | null;
/** Erro definitivo só na próxima resposta de enriquecimento (consumido). */
let erroEnrUmaVez: string | null;
/** Erro definitivo na margem (analisar_busca); null = segue normal. */
let erroMargem: string | null;
let ofertas429: boolean;
let tentarAposEm: string | null;
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
  // Mesmos limites do roteamento da edge: passar deles = 400 (o teste falha por `falhou`).
  if (b.catalogos.length > 50 || b.catalogos.reduce((n, c) => n + c.itens.length, 0) > 50 || b.perfis.length > 50 || b.perfisEmCache.length > 100) return null;
  if (enrCota <= 0) {
    const motivo = 'limite de páginas por minuto';
    return { estado: 'ok', valor: { consultadoEm: isoDe(agora), conta: enrConta, custo: { comandosRedis: 1, chamadasMl: 0 }, tentarAposEm: null,
      catalogos: b.catalogos.map((c) => ({ catalogProductId: c.catalogProductId, estado: 'indisponivel', motivo, retomarEm: null, consultadoEm: null })),
      vendedores: b.perfis.map((s) => ({ sellerId: s, estado: 'indisponivel', motivo })) } };
  }
  enrCota--;
  const catalogos = b.catalogos.map((c) => ({
    catalogProductId: c.catalogProductId, estado: 'ok', retomarEm: null, consultadoEm: isoDe(agora),
    ...(c.componentes.includes('produto') ? { produto: { estado: 'ok', criadoEm: '2026-06-01T00:00:00Z', expiraEm: isoDe(agora + 6 * 3600_000) } } : {}),
    ...(c.componentes.includes('ofertas') ? { ofertas: ofertas429 ? { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } : { estado: 'ok', expiraEm: isoDe(agora + 60_000), total: 2, lidas: 2, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true,
      exatas: c.itens.map((i) => ({ itemId: i.itemId, estado: 'ok', categoriaId: 'MLB5', sellerId: sellerDe(i.itemId), tipo: 'gold_special', perfil: 'carregado', comissaoNaSuaConta: { estado: 'ok', valor: { percentual: 14, fixa: 0 } } })) } } : {}),
  }));
  // Como a edge: explícitos + vendedores das ofertas exatas lidas, menos os em cache, deduplicados; até 50 por pedido.
  const sellers = [...new Set([...b.perfis, ...(ofertas429 ? [] : b.catalogos.filter((c) => c.componentes.includes('ofertas')).flatMap((c) => c.itens.map((i) => sellerDe(i.itemId))))])]
    .filter((x) => !b.perfisEmCache.includes(x));
  perfisConsultados += Math.min(sellers.length, 50);
  const vendedores = [
    ...sellers.slice(0, 50).map((x) => ({ sellerId: x, estado: 'ok', nome: `V${x}`, medalha: 'gold', uf: 'SP', expiraEm: isoDe(agora + 24 * 3600_000) })),
    ...sellers.slice(50).map((x) => ({ sellerId: x, estado: 'indisponivel', motivo: 'limite de perfis por pedido' })),
  ];
  return { estado: 'ok', valor: { consultadoEm: isoDe(agora), catalogos, conta: enrConta, custo: { comandosRedis: 1, chamadasMl: 1 }, vendedores, tentarAposEm: ofertas429 ? tentarAposEm : null } };
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
    if (erroEnr) return new Response(JSON.stringify({ erro: erroEnr }), { status: 403 });
    if (erroEnrUmaVez) { const erro = erroEnrUmaVez; erroEnrUmaVez = null; return new Response(JSON.stringify({ erro }), { status: 403 }); }
    const r = respostaEnr(b);
    return r ? env(r) : new Response(JSON.stringify({ erro: 'payload_invalido' }), { status: 400 });
  }
  corpos.push(b);
  if (bloqueio) await bloqueio;
  if (antesDeResponder) await antesDeResponder(b.acao);
  if (b.acao === 'identificar_busca') {
    if (falharIdentificar) return new Response(JSON.stringify({ erro: 'interno' }), { status: 500 });
    if (erroIdentificar) return new Response(JSON.stringify({ erro: erroIdentificar }), { status: 403 });
    if (b.registrarUso === true) registros++;
    return env({ contaMl: enrConta, itens: b.itens.map((i: { itemId: string }) => ({ itemId: i.itemId, proprio: false, vinculo: vinculados.has(i.itemId) ? { fonte: 'catalogo', codigo: `SKU-${i.itemId}` } : null })) });
  }
  if (b.acao === 'analisar_busca') {
    if (erroMargem) return new Response(JSON.stringify({ erro: erroMargem }), { status: 403 });
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
  erroEnr = null;
  erroIdentificar = null;
  erroEnrUmaVez = null;
  erroMargem = null;
  ofertas429 = false;
  tentarAposEm = null;
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

// Task 11.3 (Revisão 03/11-b): a página inteira num pedido de enriquecimento, logo depois da identificação e antes da
// margem; tudo terminal (sem retomada automática); repetição só por "Tentar novamente" ou cards novos (delta).
type EstadoEnr = { catalogos: Record<string, { produto?: { estado: string; motivo?: string }; ofertas?: { estado: string; motivo?: string; exatas?: Record<string, { estado: string }> } }>; vendedores: Record<string, { estado: string; medalha?: string; motivo?: string }>; tentarAposEm?: number | null; falhou: boolean; indisponivel: string | null };
const enr = async () => ((await lerAba(7)).estado as unknown as { resposta: { enriquecimento?: EstadoEnr } } | null)?.resposta.enriquecimento;
const CAT = 'MLB1000000';
const porCatalogo = (de: number, ate: number) => cards(de, ate).map((c) => ({ ...c, catalogProductId: `MLB${3000000 + Number(c.itemId.slice(3))}` }));
const retentar = () => rotear({ tipo: 'publiai:analisar-busca', tabId: 7, retentar: true }, PAINEL) as Promise<{ ok: boolean; erro?: string; tentarAposEm?: number }>;

describe('enriquecimento dos catálogos (lote por página)', () => {
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
    expect(pedidosEnr[0]).not.toHaveProperty('perfisRestantes');
    const e = (await enr())!;
    expect(e.catalogos[CAT]).toMatchObject({ produto: { estado: 'ok' }, ofertas: { estado: 'ok' } });
    expect(e.vendedores['7']).toMatchObject({ estado: 'ok', medalha: 'gold' });
    expect(mensagensPagina('publiai:busca-resultados').at(-1)!.enriquecimento).toMatchObject({ catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
  });

  it('página de 50 catálogos (painel fechado) → UM pedido com os 50 e todos os 50 perfis', async () => {
    sellerPorItem = true;
    await registrar(porCatalogo(1, 50));
    expect(pedidosEnr).toHaveLength(1);
    expect(pedidosEnr[0].catalogos).toHaveLength(50);
    expect(perfisConsultados).toBe(50);
    const e = (await enr())!;
    expect(Object.values(e.catalogos).every((c) => c.ofertas?.estado === 'ok')).toBe(true);
    expect(Object.values(e.vendedores).filter((v) => v.estado === 'ok')).toHaveLength(50);
  });

  it('margem lenta não adia o enriquecimento: o pedido sai e é gravado com a margem ainda em voo', async () => {
    vinculados = new Set(cards(1, 5).map((c) => c.itemId));
    let soltar!: () => void;
    const margem = new Promise<void>((r) => { soltar = r; });
    antesDeResponder = (acao) => (acao === 'analisar_busca' ? margem : undefined);
    const reg = registrar(cards(1, 5));
    await vi.waitFor(async () => expect((await enr())?.catalogos[CAT]?.ofertas?.estado).toBe('ok'));
    expect(doTipo('analisar_busca')).toHaveLength(1); // a margem já saiu, ainda sem resposta
    expect(Object.values((await estado())!.resposta.resultados).some((r) => r.estado === 'ok')).toBe(false);
    soltar();
    await reg;
    expect((await estado())!.resposta.resultados[id(1)].estado).toBe('ok');
  });

  it('scroll manda só o delta: cards novos = um pedido só com os novos', async () => {
    await registrar(porCatalogo(1, 10));
    await registrar(porCatalogo(11, 15));
    expect(pedidosEnr).toHaveLength(2);
    expect(pedidosEnr[1].catalogos.map((c) => c.catalogProductId)).toEqual(porCatalogo(11, 15).map((c) => c.catalogProductId));
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

  it('cota de páginas esgotada: parcial terminal (sem pulso); o pulso da margem não reabre; "Tentar novamente" refaz', async () => {
    vinculados = new Set([id(1)]);
    cota = 0; // margem sem cota: ela pede o pulso dela
    enrCota = 0;
    await registrar([card(1)]);
    expect((await enr())!.catalogos[CAT]).toEqual({ produto: { estado: 'indisponivel', motivo: 'limite de páginas por minuto' }, ofertas: { estado: 'indisponivel', motivo: 'limite de páginas por minuto', itens: { [id(1)]: 10 } } });
    expect(mensagensPagina('publiai:busca-retomar').length).toBeGreaterThan(0); // da margem
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    enrCota = 10;
    await pulso();
    expect(pedidosEnr).toHaveLength(1); // o pulso (da margem) não repete o enriquecimento
    expect(await retentar()).toMatchObject({ ok: true });
    await complementosPendentes();
    expect(pedidosEnr).toHaveLength(2);
    expect((await enr())!.catalogos[CAT]).toMatchObject({ produto: { estado: 'ok' }, ofertas: { estado: 'ok' } });
  });

  it('429 do ML com Retry-After: "Tentar novamente" antes dele é recusado sem chamada; depois, refaz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:00Z'));
    ofertas429 = true;
    tentarAposEm = '2026-11-03T12:00:30.000Z';
    await registrar([card(1)]);
    expect((await enr())!).toMatchObject({ tentarAposEm: Date.parse(tentarAposEm), catalogos: { [CAT]: { produto: { estado: 'ok' }, ofertas: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } } } });
    ofertas429 = false;
    expect(await retentar()).toMatchObject({ ok: false, erro: 'aguardar', tentarAposEm: Date.parse(tentarAposEm) });
    await complementosPendentes();
    expect(pedidosEnr).toHaveLength(1);
    vi.setSystemTime(Date.parse('2026-11-03T12:00:31Z'));
    expect(await retentar()).toMatchObject({ ok: true });
    await complementosPendentes();
    expect(pedidosEnr.at(-1)!.catalogos).toEqual([{ catalogProductId: CAT, componentes: ['ofertas'], itens: [{ itemId: id(1), preco: 10 }] }]);
    expect((await enr())!).toMatchObject({ tentarAposEm: null, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
  });

  it('Rodada 1 (11.4): erro definitivo no enriquecimento (módulo desligado) grava indisponível terminal; "Tentar novamente" refaz', async () => {
    erroEnr = 'modulo_desligado';
    await registrar([card(1)]);
    const e1 = (await enr())! as unknown as EstadoEnriquecimento;
    expect(e1.indisponivel).toBe('A extensão não está habilitada para sua empresa');
    expect(vistaDoCard({ itemId: id(1), catalogProductId: CAT, identidadeConflitante: false, preco: 10 }, e1)).toMatchObject({ faltaProduto: false, faltaOfertas: false });
    expect(haParaTentar(e1)).toBe(true);
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
    erroEnr = null;
    expect(await retentar()).toMatchObject({ ok: true });
    await complementosPendentes();
    expect((await enr())!).toMatchObject({ indisponivel: null, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
  });

  it('Rodada 1 (11.4): erro definitivo na identificação grava indisponível (nada fica em "Consultando"); "Tentar novamente" refaz', async () => {
    erroIdentificar = 'payload_invalido';
    await registrar([card(1)]);
    expect(pedidosEnr).toHaveLength(0);
    expect((await enr())!.indisponivel).toBe('Não foi possível analisar este anúncio. Tente de novo.');
    erroIdentificar = null;
    expect(await retentar()).toMatchObject({ ok: true });
    await complementosPendentes();
    expect((await enr())!).toMatchObject({ indisponivel: null, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
  });

  it('Rodada 2 (11.4): erro definitivo do pedido da busca A, com a busca B já na aba, não marca B; B ainda enriquece', async () => {
    let soltar!: () => void;
    bloqueioEnr = new Promise((r) => { soltar = r; });
    erroEnrUmaVez = 'modulo_desligado';
    await enviarCards([card(1)]);
    await vi.waitFor(() => expect(pedidosEnr).toHaveLength(1));
    // A aba vai para a busca B (cards registrados) com o pedido de A ainda em voo.
    const OUTRA = 'https://lista.mercadolivre.com.br/frigideira';
    const B = { ...BUSCA, tab: { id: 7, url: OUTRA } as chrome.tabs.Tab, url: OUTRA };
    geracaoCs = null;
    await enviarCards([card(2, { catalogProductId: 'MLB2000000' })], B);
    bloqueioEnr = null;
    soltar();
    await complementosPendentes();
    const e = (await enr())!;
    expect(e.indisponivel).toBeNull();
    expect(pedidosEnr.at(-1)!.catalogos.map((c) => c.catalogProductId)).toEqual(['MLB2000000']);
    expect(e.catalogos.MLB2000000).toMatchObject({ ofertas: { estado: 'ok' } });
  });

  it('Rodada 3 (11.4): erro definitivo só na margem não marca o enriquecimento; o delta do scroll é enriquecido', async () => {
    vinculados = new Set([id(1), id(2)]);
    erroMargem = 'payload_invalido';
    await registrar([card(1)]);
    expect((await enr())!).toMatchObject({ indisponivel: null, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
    await registrar([card(1), card(2, { catalogProductId: 'MLB2000000' })]);
    const e = (await enr())!;
    expect(e.indisponivel).toBeNull();
    expect(pedidosEnr.at(-1)!.catalogos.map((c) => c.catalogProductId)).toEqual(['MLB2000000']);
    expect(e.catalogos.MLB2000000).toMatchObject({ ofertas: { estado: 'ok' } });
  });

  it('Rodada 1 (11.4): sessão expirada não grava indisponível (a sessão limpa os blocos)', async () => {
    erroEnr = 'sessao_suporte_expirada';
    await registrar([card(1)]);
    expect((await enr())?.indisponivel ?? null).toBeNull();
  });

  it('falha de rede: terminal, sem repetição automática; scroll manda só o delta; "Tentar novamente" refaz o que falhou', async () => {
    falharEnr = true;
    await registrar([card(1)]);
    expect((await enr())!).toMatchObject({ falhou: true, catalogos: { [CAT]: { ofertas: { estado: 'indisponivel' } } } });
    expect(mensagensPagina('publiai:busca-retomar')).toHaveLength(0);
    await pulso();
    expect(pedidosEnr).toHaveLength(1);
    falharEnr = false;
    await registrar([card(1), card(2, { catalogProductId: 'MLB2000000' })]);
    expect(pedidosEnr).toHaveLength(2);
    expect(pedidosEnr[1].catalogos.map((c) => c.catalogProductId)).toEqual(['MLB2000000']);
    await retentar();
    await complementosPendentes();
    expect(pedidosEnr).toHaveLength(3);
    expect(pedidosEnr[2].catalogos.map((c) => c.catalogProductId)).toEqual([CAT]);
    expect((await enr())!).toMatchObject({ falhou: false, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
  });

  it('reinício do SW: o parcial terminal guardado não é reaberto pelo pulso; cards novos vão como delta', async () => {
    enrCota = 0;
    await registrar([card(1)]);
    vi.resetModules();
    const novo = await import('../roteador');
    enrCota = 10;
    await novo.rotearMensagem({ tipo: 'publiai:busca-pulso', geracao: geracaoCs }, BUSCA);
    await novo.complementosPendentes();
    expect(pedidosEnr).toHaveLength(1);
    await novo.rotearMensagem({ tipo: 'publiai:busca-cards', geracao: geracaoCs, url: URL_BUSCA, cards: [card(1), card(2, { catalogProductId: 'MLB2000000' })], ocorrencias: 2 }, BUSCA);
    await novo.complementosPendentes();
    expect(pedidosEnr).toHaveLength(2);
    expect(pedidosEnr[1].catalogos.map((c) => c.catalogProductId)).toEqual(['MLB2000000']);
    expect((await enr())!.catalogos[CAT].ofertas).toMatchObject({ estado: 'indisponivel' });
  });

  it('resposta antiga depois da pausa: nada gravado na aba nem no cache', async () => {
    antesDeEnriquecer = async () => { await rotear({ tipo: 'publiai:definir-ativa', ativa: false }, PAINEL); };
    await registrar([card(1)]);
    expect(await enr()).toBeUndefined();
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
  });

  it('logout com o enriquecimento em voo: nada gravado na aba nem no cache; login de novo começa sem nada', async () => {
    antesDeEnriquecer = async () => { await sair(); };
    await registrar([card(1)]);
    expect(await estado()).toBeNull();
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
  });

  it('suporte expirado no enriquecimento: abas e cache limpos, nada gravado', async () => {
    await registrar([card(1)]);
    expect((await chrome.storage.session.get('enr:cache'))['enr:cache']).toBeDefined();
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (b.acao === 'enriquecer_catalogos_busca') { pedidosEnr.push(b); return new Response(JSON.stringify({ erro: 'sessao_suporte_expirada' }), { status: 403 }); }
      return edge(String(u), init);
    });
    await registrar([card(1), card(2, { catalogProductId: 'MLB2000000' })]);
    expect(pedidosEnr).toHaveLength(2);
    expect(await estado()).toBeNull();
    expect(await chrome.storage.session.get('enr:cache')).toEqual({});
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

  it('revalidação que falhou (rede/sem contaMl) também conta para o limite de 5 min: duas ativações = uma chamada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:00Z'));
    await registrar([card(1)]);
    const vazios = () => doTipo('identificar_busca').filter((c) => c.itens.length === 0);
    falharIdentificar = true;
    vi.setSystemTime(Date.parse('2026-11-03T12:06:00Z'));
    for (let i = 0; i < 2; i++) { await rotear({ tipo: 'publiai:busca-visivel', geracao: geracaoCs }, BUSCA); await complementosPendentes(); }
    expect(vazios()).toHaveLength(1);
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

  it('contaMl ausente (leitura da conexão falhou na edge): nem o lote seguinte nem a revalidação limpam abas ou cache', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:00Z'));
    await registrar([card(1)]);
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const r = await edge(String(u), init);
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (b.acao !== 'identificar_busca') return r;
      const j = await r.json();
      delete j.dados.contaMl;
      return new Response(JSON.stringify(j), { status: 200 });
    });
    vi.mocked(chrome.tabs.sendMessage).mockClear();
    await registrar([card(1), card(2)]);
    vi.setSystemTime(Date.parse('2026-11-03T12:06:00Z'));
    await rotear({ tipo: 'publiai:busca-visivel', geracao: geracaoCs }, BUSCA);
    await complementosPendentes();
    expect(doTipo('identificar_busca').filter((c) => c.itens.length === 0)).toHaveLength(1);
    expect(mensagensPagina('publiai:sessao-mudou')).toHaveLength(0);
    expect((await chrome.storage.session.get('enr:cache'))['enr:cache']).toMatchObject({ conta: 'conta-a' });
    expect(await estado()).not.toBeNull();
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

  it('Rodada 1: margem lenta + scroll → o enriquecimento dos cards novos sai sem esperar a margem', async () => {
    vinculados = new Set([id(1)]);
    let soltar!: () => void;
    const margem = new Promise<void>((r) => { soltar = r; });
    antesDeResponder = (acao) => (acao === 'analisar_busca' ? margem : undefined);
    await enviarCards([card(1)]);
    await vi.waitFor(() => expect(doTipo('analisar_busca')).toHaveLength(1));
    await enviarCards([card(1), card(2, { catalogProductId: 'MLB2000000' })]);
    await vi.waitFor(async () => expect((await enr())?.catalogos.MLB2000000?.ofertas?.estado).toBe('ok'));
    expect(pedidosEnr.map((p) => p.catalogos.map((c) => c.catalogProductId))).toEqual([[CAT], ['MLB2000000']]);
    expect((await estado())!.resposta.resultados[id(1)]).toBeUndefined(); // margem ainda em voo
    soltar();
    await complementosPendentes();
    expect((await estado())!.resposta.resultados[id(1)].estado).toBe('ok');
    expect(doTipo('analisar_busca')).toHaveLength(1);
  });

  it('Rodada 1: enriquecimento lento não adia a margem', async () => {
    vinculados = new Set([id(1)]);
    let soltar!: () => void;
    bloqueioEnr = new Promise((r) => { soltar = r; });
    await enviarCards([card(1)]);
    await vi.waitFor(async () => expect((await estado())?.resposta.resultados[id(1)]?.estado).toBe('ok'));
    expect(pedidosEnr).toHaveLength(1);
    expect((await enr())?.catalogos[CAT]?.ofertas).toBeUndefined(); // enriquecimento ainda em voo
    soltar();
    await complementosPendentes();
    expect((await enr())!.catalogos[CAT].ofertas).toMatchObject({ estado: 'ok' });
  });

  it('Rodada 1: falha de uma fase não marca a outra', async () => {
    vinculados = new Set([id(1)]);
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (b.acao === 'analisar_busca') { corpos.push(b); return new Response(JSON.stringify({ erro: 'interno' }), { status: 500 }); }
      return edge(String(u), init);
    });
    await registrar([card(1)]);
    expect((await enr())!).toMatchObject({ falhou: false, catalogos: { [CAT]: { ofertas: { estado: 'ok' } } } });
    vi.mocked(fetch).mockImplementation(edge as never);
    falharEnr = true;
    await registrar([card(1), card(2, { catalogProductId: 'MLB2000000' })]);
    expect((await estado())!.resposta.resultados[id(1)].estado).toBe('ok');
    expect((await enr())!.falhou).toBe(true);
    expect((await enr())!.catalogos[CAT].ofertas).toMatchObject({ estado: 'ok' });
  });

  it('pré-merge 1: 60 catálogos e o 1º pedido falha → os 60 terminam indisponíveis (nenhum em "Consultando"), sem repetir', async () => {
    falharEnr = true;
    const lista = porCatalogo(1, 60);
    await registrar(lista);
    expect(pedidosEnr).toHaveLength(1);
    const e = (await enr())!;
    expect(lista.filter((c) => e.catalogos[c.catalogProductId]?.ofertas?.estado !== 'indisponivel')).toEqual([]);
    expect(e.falhou).toBe(true);
    await pulso();
    expect(pedidosEnr).toHaveLength(1);
  });

  it('pré-merge 2: edge pendurada → o cliente aborta em 10 s e o pedido fica indisponível (terminal)', async () => {
    let sinal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (u, init) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      if (b.acao !== 'enriquecer_catalogos_busca') return edge(String(u), init);
      pedidosEnr.push(b);
      sinal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // nunca responde (nem com o abort)
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await enviarCards([card(1)]);
    for (let i = 0; i < 1000 && pedidosEnr.length === 0; i++) await vi.advanceTimersByTimeAsync(0); // sem avançar o relógio
    expect(pedidosEnr).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect((await enr())?.catalogos[CAT]?.ofertas).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    await vi.waitFor(async () => expect((await enr())?.catalogos[CAT]?.ofertas?.estado).toBe('indisponivel'));
    expect(sinal?.aborted).toBe(true);
    expect((await enr())!.falhou).toBe(true);
  });

  it('pré-merge 3: "Tentar novamente" no Retry-After responde aguardar sem esperar a margem pendente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-03T12:00:00Z'));
    vinculados = new Set([id(1)]);
    ofertas429 = true;
    tentarAposEm = '2026-11-03T12:00:30.000Z';
    let soltar!: () => void;
    const margem = new Promise<void>((r) => { soltar = r; });
    antesDeResponder = (acao) => (acao === 'analisar_busca' ? margem : undefined);
    await enviarCards([card(1)]);
    await vi.waitFor(async () => expect((await enr())?.catalogos[CAT]?.ofertas?.estado).toBe('indisponivel'));
    await vi.waitFor(() => expect(doTipo('analisar_busca')).toHaveLength(1));
    let respondeu: unknown = null;
    void retentar().then((r) => { respondeu = r; });
    await vi.waitFor(() => expect(respondeu).toMatchObject({ ok: false, erro: 'aguardar' }));
    soltar();
    await complementosPendentes();
    expect((await estado())!.resposta.resultados[id(1)].estado).toBe('ok');
  });
});
