// EAN da busca por aba (ADR-0189). Só o service worker usa: content scripts e painel pedem por mensagem.
// Guardado como { ean, mlItemId }: o 1º anúncio analisado depois da busca fica com o EAN; outro anúncio
// na mesma aba (recomendado, navegação) segue sem ele. Nova busca troca (ou, sem EAN, limpa).
const chave = (tabId: number) => `ean:${tabId}`;
type EanAba = { ean: string; mlItemId: string | null };

export async function registrarEanDaAba(tabId: number, ean: string): Promise<void> {
  await chrome.storage.session.set({ [chave(tabId)]: { ean, mlItemId: null } satisfies EanAba });
}

async function lerEan(tabId: number): Promise<EanAba | null> {
  const v = (await chrome.storage.session.get(chave(tabId)))[chave(tabId)] as Partial<EanAba> | undefined;
  return typeof v?.ean === 'string' ? { ean: v.ean, mlItemId: typeof v.mlItemId === 'string' ? v.mlItemId : null } : null;
}

export async function eanDaAba(tabId: number): Promise<string | null> {
  return (await lerEan(tabId))?.ean ?? null;
}

/** EAN da busca para o anúncio `mlItemId`: liga ao 1º anúncio; só o mesmo anúncio (refresh/volta) o reaproveita. */
export async function eanParaAnuncio(tabId: number, mlItemId: string): Promise<string | null> {
  const v = await lerEan(tabId);
  if (!v) return null;
  if (v.mlItemId === null) {
    await chrome.storage.session.set({ [chave(tabId)]: { ean: v.ean, mlItemId } satisfies EanAba });
    return v.ean;
  }
  return v.mlItemId === mlItemId ? v.ean : null;
}

export async function esquecerAba(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chave(tabId));
}

// Última análise do anúncio feita pelo content script na aba, para o painel (Task 10).
// storage.session e não memória: o SW do MV3 morre ocioso e o painel pode abrir depois.
// Geração da página na aba: muda a cada navegação. O estado é gravado com a geração de quando a análise
// começou, num único `set`; na leitura, estado de outra geração é descartado (resposta atrasada não volta).
const chaveEstado = (tabId: number) => `estado:${tabId}`;
const chaveGeracao = (tabId: number) => `geracao:${tabId}`;
// Geração global da sessão: sobe a cada limparEstadosDasAbas. Estado de outra geração (inclusive sem ela)
// é descartado — cobre aba que nunca teve chave (1ª análise com a extensão recém-carregada).
const GERACAO_SESSAO = 'geracao-sessao';
export const ABAS_ML = 'https://*.mercadolivre.com.br/*'; // = host_permissions do manifest

// observado: o que a página mostra e a edge não recebe (faixa de vendidos, data de criação) — ADR-0189 D-9.
// gravadoEm (ms): análise de anúncio com mais de 10 min é refeita antes de chegar ao painel (roteador).
interface EstadoGuardado { geracao: string | null; sessao: number; entrada: object; resposta: unknown; observado?: object; gravadoEm: number }

export async function registrarEstado(tabId: number, estado: Omit<EstadoGuardado, 'gravadoEm'>): Promise<void> {
  await chrome.storage.session.set({ [chaveEstado(tabId)]: { ...estado, gravadoEm: Date.now() } });
}

// Época da sessão, só em memória do SW: decide se um pedido em voo ainda vale. Sobe de forma SÍNCRONA (antes de
// qualquer await, antes de o novo estado ficar visível) em todo evento que muda a sessão: sair, entrar, troca de
// identidade, limpeza das abas (suporte, pausa, refresh recusado). Quem pede captura a época sincronamente e a
// confere sincronamente antes de usar. SW single-thread; reinício do SW mata as chamadas em voo, então memória basta.
// Fica aqui (abas.ts) por ser a base do grafo: credenciais.ts e sessao.ts importam daqui sem ciclo.
// Semente aleatória por vida do SW: painel/menu com a geração de um SW anterior nunca coincide com a do SW reiniciado.
let epoca = Math.floor(Math.random() * 2 ** 31);
export const epocaAtual = (): number => epoca;
export const novaEpoca = (): void => { epoca++; };

/** Geração global da sessão (sobe em login, saída, troca de identidade e fim de suporte). Quem pede algo lê antes
 *  e depois: mudou no meio → a resposta é de outra sessão e é descartada. */
export async function geracaoAtual(): Promise<number> {
  const v = (await chrome.storage.session.get(GERACAO_SESSAO))[GERACAO_SESSAO];
  return typeof v === 'number' ? v : 0;
}

/** Geração atual e o estado dela, numa leitura só. Geração ausente = nenhuma navegação vista ainda. */
export async function lerAba(tabId: number): Promise<{ geracao: string | null; sessao: number; estado: { entrada: object; resposta: unknown; observado?: object } | null; gravadoEm: number }> {
  const r = await chrome.storage.session.get([chaveEstado(tabId), chaveGeracao(tabId), GERACAO_SESSAO]);
  const g = r[chaveGeracao(tabId)];
  const geracao = typeof g === 'string' ? g : null;
  const sessao = typeof r[GERACAO_SESSAO] === 'number' ? (r[GERACAO_SESSAO] as number) : 0;
  const e = r[chaveEstado(tabId)] as EstadoGuardado | undefined;
  const valido = e && (e.geracao ?? null) === geracao && e.sessao === sessao;
  return {
    geracao, sessao,
    estado: valido ? { entrada: e.entrada, resposta: e.resposta, observado: e.observado } : null,
    gravadoEm: valido && typeof e.gravadoEm === 'number' ? e.gravadoEm : 0, // sem a marca (antes da 0.3.0) = velho
  };
}

export const estadoDaAba = async (tabId: number) => (await lerAba(tabId)).estado;

/** A aba foi para outra página: nova geração primeiro, depois some o estado. */
export async function novaPaginaNaAba(tabId: number): Promise<void> {
  await chrome.storage.session.set({ [chaveGeracao(tabId)]: crypto.randomUUID() });
  await chrome.storage.session.remove(chaveEstado(tabId));
}

/** Item que a URL comprova: `produto.mercadolivre.com.br/MLB-123…` ou página /p/ ou /up/ de www com
 *  `pdp_filters=item_id:MLB…`. Catálogo/UP sem item explícito (o vencedor pode mudar), busca e demais páginas
 *  → null: a aba nunca mantém análise de um item que a URL não prova. */
export function anuncioDaUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname === 'produto.mercadolivre.com.br') return u.pathname.match(/^\/MLB-?(\d+)/)?.[0].slice(1).replace('-', '') ?? null;
  if (u.hostname !== 'www.mercadolivre.com.br' || !/\/(p\/MLB|up\/MLBU)\d+/.test(u.pathname)) return null;
  return u.searchParams.get('pdp_filters')?.match(/(?:^|,)item_id:(MLB\d+)(?:,|$)/)?.[1] ?? null;
}

const chaveAnuncio = (tabId: number) => `anuncio:${tabId}`;

/** A aba mudou de URL: true se ainda é o mesmo anúncio já visto nela (painel continua). Guarda o novo. */
export async function mesmoAnuncioNaAba(tabId: number, url: string): Promise<boolean> {
  const novo = anuncioDaUrl(url);
  const antes = (await chrome.storage.session.get(chaveAnuncio(tabId)))[chaveAnuncio(tabId)] ?? null;
  await chrome.storage.session.set({ [chaveAnuncio(tabId)]: novo });
  return novo !== null && novo === antes;
}

export async function esquecerAnuncioDaAba(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveAnuncio(tabId));
}

/** Aba fechada. */
export async function esquecerEstado(tabId: number): Promise<void> {
  await chrome.storage.session.remove(chaveEstado(tabId));
  await chrome.storage.session.remove(chaveGeracao(tabId));
  await chrome.storage.session.remove(chaveAnuncio(tabId));
}

/** Troca de identidade / desconexão / sessão expirada: nenhuma aba guarda análise nem EAN da sessão anterior.
 *  Sobe a geração global (escrita em voo com a anterior é descartada na leitura) e, em toda aba do ML
 *  (com chave ou não), nova geração de página; o painel é avisado para reler e o content script tira o selo.
 *  Só roda na fila da sessão (sessao.ts). */
export async function limparEstadosDasAbas(): Promise<void> {
  novaEpoca(); // antes do 1º await
  const tudo = await chrome.storage.session.get(null);
  const atual = typeof tudo[GERACAO_SESSAO] === 'number' ? (tudo[GERACAO_SESSAO] as number) : 0;
  await chrome.storage.session.set({ [GERACAO_SESSAO]: atual + 1 });
  const abas = new Set<number>();
  for (const t of await chrome.tabs.query({ url: ABAS_ML }).catch(() => [])) if (t.id !== undefined) abas.add(t.id);
  const remover: string[] = [];
  for (const k of Object.keys(tudo)) {
    const [prefixo, id] = k.split(':');
    if (prefixo === 'ean') remover.push(k);
    if (prefixo === 'estado' || prefixo === 'geracao') abas.add(Number(id));
  }
  if (remover.length) await chrome.storage.session.remove(remover);
  for (const tabId of abas) {
    await novaPaginaNaAba(tabId);
    chrome.runtime.sendMessage({ tipo: 'publiai:estado-atualizado', tabId }).catch(() => {}); // painel fechado
    // O selo na página do ML também sai (content script da aba; aba fechada/sem script → ignora).
    chrome.tabs.sendMessage(tabId, { tipo: 'publiai:sessao-mudou' }).catch(() => {});
  }
  await transmitirConta();
}

/** Mensagem do SW para o painel e todas as abas do ML (fechado/sem content script → ignora). */
export async function transmitir(msg: object): Promise<void> {
  chrome.runtime.sendMessage(msg).catch(() => {});
  for (const t of await chrome.tabs.query({ url: ABAS_ML }).catch(() => [])) {
    if (t.id !== undefined) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
  }
}

/** Conta mudou (login, saída, troca de identidade — e toda limpeza: fim de suporte, pausa, sessão legada):
 *  menu, selos e painel releem `publiai:estado-extensao` e descartam o que tinham da geração anterior.
 *  Chaves de credenciais.ts ('credenciais') e preferencias.ts ('ativa') lidas direto: importar de lá faria ciclo. */
export async function transmitirConta(): Promise<void> {
  const r = await chrome.storage.local.get(['credenciais', 'ativa']);
  await transmitir({ tipo: 'publiai:conta-mudou', logado: r.credenciais !== undefined, ativa: r.ativa !== false, geracao: epocaAtual() });
}

// Painel lateral só nas abas do ML (ADR-0189): fora delas o Chrome o esconde ao trocar de aba e o devolve ao voltar.
// `tab.url` só vem para hosts da host permission — sem url = fora do ML.
const PAINEL = 'src/painel/index.html'; // = side_panel.default_path do manifest

const ehAbaMl = (url: string | undefined) => {
  try { return !!url && new URL(url).hostname.endsWith('.mercadolivre.com.br'); } catch { return false; }
};

export async function ajustarPainelDaAba(tabId: number, url: string | undefined): Promise<void> {
  await chrome.sidePanel.setOptions(ehAbaMl(url) ? { tabId, path: PAINEL, enabled: true } : { tabId, enabled: false });
}

/** Boot do SW: desligado por padrão (abas novas fora do ML) e ligado nas abas do ML já abertas. */
export async function painelSoNoMl(): Promise<void> {
  await chrome.sidePanel.setOptions({ enabled: false });
  for (const t of await chrome.tabs.query({ url: ABAS_ML }).catch(() => [])) {
    if (t.id === undefined) continue;
    // URL relida na hora (o snapshot pode ter saído do ML); sem await entre ler e aplicar, um onUpdated
    // posterior sempre aplica depois e vence.
    const atual = await chrome.tabs.get(t.id).catch(() => null);
    if (atual) await ajustarPainelDaAba(t.id, atual.url);
  }
}
