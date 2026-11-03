// Content script da busca (ADR-0189 D-11, Task 22): lê os cards (que montam depois do document_idle e entram no
// scroll), manda ao SW e põe o Mini-bloco da busca em cada card (emenda 2026-11-02). Nunca reordena nem esconde cards do
// ML; o destaque pedido pelo painel só rola e contorna o card por 2 s.
import type { MetadadosCardBusca, ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import { cardsDoItem, cardsElegiveis, INJETADO, lerBusca, lerCard, type CardBusca } from '../leitura/busca';
import { HOST_MINI_BLOCO, renderizarMiniBlocoDaBusca } from './mini-bloco-busca';
import { enriquecimentoDe, vistaDoCard, type EstadoEnriquecimento } from '../compartilhado/enriquecimento';

const ESPERA_MS = 800;
// Dados locais (preço, vendidos, sinais) não esperam a rede: o bloco sai com o card, separado do envio ao SW.
const ESPERA_BLOCOS_MS = 120;
const PULSO_MS = 61_000; // janela da cota da edge (1 min) + folga
const LIMITE_ESPERA_MS = 15_000;
const HOST = HOST_MINI_BLOCO;
let enviados = new Map<string, string>(); // itemId → assinatura do que já foi enviado
let resultados: Record<string, ResultadoCard> = {};
// Chave "Extensão ativa" e login: desligada ou deslogado, nada é enviado nem desenhado. Fail-closed: só liga com o SW dizendo
// ativa e logado (resposta do boot ou aviso). Aviso que chega antes da resposta do boot vence a resposta.
let ligada = false;
let estadoRecebido = false;

const enviar = (msg: object) => {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* contexto invalidado (extensão recarregada) */ }
};

let urlAtual = location.href.split('#')[0];
// Geração da página dada pelo SW (navegação + sessão). Começa sem: o 1º envio volta recusado com a atual, que a página
// adota e reenvia. Cards levam e resultados/retomada só valem com ela: mensagem atrasada de outra geração, mesmo na
// mesma URL, é descartada nos dois sentidos.
let geracao: string | null = null;
// Sobe a cada invalidação (sessão, ativação, conta, URL): resposta de aperto de mão pedida antes dela não restaura a velha.
let invalidacoes = 0;
function invalidarGeracao(): void { geracao = null; invalidacoes++; }

/** Cards ao SW; recusa por geração antiga traz a atual → adota e reenvia tudo com ela. */
function enviarCards(msg: { geracao: string | null }): void {
  const vez = invalidacoes;
  try {
    chrome.runtime.sendMessage(msg).then((r: { erro?: unknown; geracao?: unknown } | undefined) => {
      if (!ligada || vez !== invalidacoes || r?.erro !== 'geracao_antiga' || typeof r.geracao !== 'string' || r.geracao === msg.geracao) return;
      geracao = r.geracao;
      enviados = new Map();
      lerEEnviar();
    }).catch(() => {});
  } catch { /* contexto invalidado */ }
}

/** URL mudou sem recarregar (filtro aplicado por script): o SW abriu outra geração e zerou o estado; descarta o dado da
 *  página anterior e reenvia tudo. Chamado antes de enviar E antes de desenhar (o desenho local sai antes do envio). */
function conferirUrl(): string {
  const url = location.href.split('#')[0];
  if (url !== urlAtual) { urlAtual = url; enviados = new Map(); invalidarGeracao(); limparSelos(); }
  return url;
}

function lerEEnviar(): void {
  if (!ligada) return;
  const url = conferirUrl();
  // Reenvia também o card que completou preço, catálogo, vendidos, miniatura ou ocorrência depois da 1ª leitura.
  const assinatura = (c: CardBusca) =>
    `${c.preco}|${c.catalogProductId}|${c.userProductId}|${c.identidadeConflitante}|${c.vendidosTexto}|${c.miniaturaUrl}|${JSON.stringify(c.ocorrencias)}`;
  const novos = lerBusca(document).filter((c) => enviados.get(c.itemId) !== assinatura(c));
  if (novos.length === 0) return;
  for (const c of novos) enviados.set(c.itemId, assinatura(c));
  enviarCards({ tipo: 'publiai:busca-cards', geracao, url, cards: novos, ocorrencias: cardsElegiveis(document).length } as { geracao: string | null });
}

// Assinatura do que cada host desenha (memória do content script, não no DOM: a página não lê a margem por atributo).
const assinaturas = new WeakMap<Element, string>();
// Metadados do banco (anúncio próprio, vínculo); ausente = ainda não identificado.
let metadados: Record<string, MetadadosCardBusca> = {};
// Catálogos enriquecidos (Task 10): vista por card calculada na hora do desenho.
let enriquecimento: EstadoEnriquecimento | undefined;
// Hosts que NÓS tiramos: a remoção deles não pede nova leitura (a feita pela página pede, para o bloco voltar).
const removidosPorNos = new WeakSet<Node>();
// Card → nó de preço em que o bloco foi desenhado. Host sumido com o mesmo preço = a página tirou só o host: restaura
// até MAX_RESTAUROS vezes por card e depois desiste (sem ciclo com quem remove; o painel segue com tudo).
let ancoras = new WeakMap<Element, Element>();
let restauros = new WeakMap<Element, number>();
const MAX_RESTAUROS = 3;

const doCard = (card: Element, seletor: string) =>
  [...card.querySelectorAll(seletor)].find((e) => !e.closest(INJETADO) && e.closest('.poly-card') === card);

function tirarHost(h: Element): void {
  removidosPorNos.add(h);
  h.remove();
}

/** Mini-bloco em cada card elegível (vinculado ou não), com a leitura daquele card só (sinais e ocorrência dele).
 *  Idempotente por host/assinatura: só refaz o host cujo conteúdo mudou (ML reusou o nó para outro item, preço,
 *  resultado) e tira os que não correspondem a mais nada. Sem preço no card = encaixe inseguro: só o painel. */
function aplicarBlocos(): void {
  if (!ligada) return;
  conferirUrl();
  const vivos = new Set<Element>();
  // Preço analisado por item = o do card agregado (1º preço legível na ordem da página), o mesmo que o SW manda à edge.
  // ponytail: lido do DOM atual; se o scroll trouxer o 1º preço numa leitura e outro antes dele na seguinte, diverge.
  const precoAnalisado = new Map(lerBusca(document).map((c) => [c.itemId, c.preco]));
  for (const card of cardsElegiveis(document)) {
    const c = lerCard(card);
    const preco = doCard(card, '.poly-component__price');
    if (!c || !preco?.parentElement) continue;
    const meta = metadados[c.itemId], res = resultados[c.itemId];
    const pa = precoAnalisado.get(c.itemId) ?? c.preco;
    const vista = vistaDoCard(c, enriquecimento);
    const assinatura = JSON.stringify([c, meta ?? null, res ?? null, pa, vista]);
    const atual = doCard(card, `.${HOST}`);
    if (atual && atual.previousSibling === preco && assinaturas.get(atual) === assinatura) { vivos.add(atual); continue; }
    if (!atual && ancoras.get(card) === preco) {
      const n = restauros.get(card) ?? 0;
      if (n >= MAX_RESTAUROS) continue;
      restauros.set(card, n + 1);
    }
    const novo = renderizarMiniBlocoDaBusca(c, meta, res, pa, vista);
    assinaturas.set(novo, assinatura);
    if (atual) tirarHost(atual);
    preco.parentElement.insertBefore(novo, preco.nextSibling);
    ancoras.set(card, preco);
    vivos.add(novo);
  }
  for (const h of document.querySelectorAll(`.${HOST}`)) {
    if (vivos.has(h)) continue;
    const card = h.closest('.poly-card');
    if (card) ancoras.delete(card);
    tirarHost(h);
  }
}

function limparSelos(): void {
  tirarDestaque();
  resultados = {};
  metadados = {};
  enriquecimento = undefined;
  ancoras = new WeakMap();
  restauros = new WeakMap();
  for (const h of document.querySelectorAll(`.${HOST}`)) tirarHost(h);
}

let destaque: { card: HTMLElement; outline: string; offset: string; timer: ReturnType<typeof setTimeout> } | null = null;
function tirarDestaque(): void {
  if (!destaque) return;
  clearTimeout(destaque.timer);
  destaque.card.style.outline = destaque.outline;
  destaque.card.style.outlineOffset = destaque.offset;
  destaque = null;
}

function destacar(itemId: string): void {
  const card = cardsDoItem(document, itemId)[0] as HTMLElement | undefined;
  if (!card) return;
  tirarDestaque(); // clique seguido: o timer do anterior não apaga o novo
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  destaque = { card, outline: card.style.outline, offset: card.style.outlineOffset, timer: setTimeout(tirarDestaque, 2000) };
  card.style.outline = '3px solid oklch(0.55 0.20 277)';
  card.style.outlineOffset = '2px';
}

// Pulso de retomada (cota da janela seguinte, falha transitória): o SW pede, a página manda depois. Um timer só.
let pulso: ReturnType<typeof setTimeout> | undefined;
function agendarPulso(): void {
  if (pulso) return;
  pulso = setTimeout(() => { pulso = undefined; if (ligada) enviar({ tipo: 'publiai:busca-pulso', geracao }); }, PULSO_MS);
}

const daPagina = (msg: { url?: unknown; geracao?: unknown }) => geracao !== null && msg.geracao === geracao && msg.url === location.href.split('#')[0];

chrome.runtime.onMessage.addListener((msg: { tipo?: unknown; resultados?: unknown; metadados?: unknown; enriquecimento?: unknown; itemId?: unknown; ativa?: unknown; logado?: unknown; url?: unknown; geracao?: unknown }) => {
  if (msg?.tipo === 'publiai:ativacao' || msg?.tipo === 'publiai:conta-mudou') {
    estadoRecebido = true;
    ligada = msg.ativa === true && msg.logado === true;
    invalidarGeracao(); // na hora: resultado atrasado da sessão/ativação anterior não passa até o novo aperto de mão
    limparSelos();
    enviados = new Map(); // o SW zerou o estado; ligando, os cards voltam (e o SW analisa sozinho)
    lerEEnviar();
    agendar(); // blocos locais voltam sem o dado da sessão anterior
  } else if (ligada && msg?.tipo === 'publiai:busca-retomar' && daPagina(msg)) {
    agendarPulso();
  } else if (ligada && msg?.tipo === 'publiai:busca-resultados' && daPagina(msg) && msg.resultados && typeof msg.resultados === 'object') {
    // Resultado de outra página (URL ou geração anterior) não vale aqui.
    resultados = msg.resultados as Record<string, ResultadoCard>;
    metadados = msg.metadados && typeof msg.metadados === 'object' ? msg.metadados as Record<string, MetadadosCardBusca> : {};
    enriquecimento = msg.enriquecimento ? enriquecimentoDe(msg.enriquecimento) : undefined;
    aplicarBlocos();
  } else if (ligada && msg?.tipo === 'publiai:destacar-card' && typeof msg.itemId === 'string') {
    destacar(msg.itemId);
  } else if (ligada && msg?.tipo === 'publiai:sessao-mudou') {
    invalidarGeracao();
    limparSelos();
    enviados = new Map(); // nova sessão: o SW zerou o estado; os cards voltam a ser enviados
    lerEEnviar();
    agendar();
  }
});

// Cards montam depois do document_idle e entram no scroll: observa a página com espera curta entre leituras.
let timer: ReturnType<typeof setTimeout> | undefined;
// ponytail: blocos com timer que não reinicia (página do ML montando sem parar não adia além de ESPERA_BLOCOS_MS).
let timerBlocos: ReturnType<typeof setTimeout> | undefined;
function agendar(): void {
  clearTimeout(timer);
  timer = setTimeout(() => { lerEEnviar(); aplicarBlocos(); }, ESPERA_MS);
  timerBlocos ??= setTimeout(() => { timerBlocos = undefined; aplicarBlocos(); }, ESPERA_BLOCOS_MS);
}

/** Nó dentro do Avant ou de um host PubliAI (o próprio host incluído). */
const deFora = (n: Node | null) => !!(n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(`${INJETADO}, .${HOST}`));
/** Mutação que pede nova leitura: do ML (cards, preço, imagem, link) ou host nosso removido pela página. Dentro do Avant
 *  ou dos nossos hosts (inclusive characterData), host entrando, ou host que nós mesmos tiramos, não vale: sem ciclo com
 *  o Avant nem com os nossos próprios blocos. */
export function mutacaoUtil(m: MutationRecord): boolean {
  if (deFora(m.target)) return false;
  if (m.type !== 'childList') return true;
  const hostDaPagina = (n: Node) => (n as Element).classList?.contains(HOST) && !removidosPorNos.has(n);
  return [...m.addedNodes].some((n) => !deFora(n)) || [...m.removedNodes].some((n) => !deFora(n) || hostDaPagina(n));
}
new MutationObserver((mudancas) => { if (mudancas.some(mutacaoUtil)) agendar(); })
  .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'srcset'] });
const inicio = Date.now();
(function esperarCards() {
  if (document.querySelector('.poly-card')) { agendar(); return; } // mesma espera do observer: card ainda montando
  if (Date.now() - inicio < LIMITE_ESPERA_MS) setTimeout(esperarCards, 500);
})();

// Busca parada que volta a ficar visível: o SW confirma a conta ML da org (≤ 1 vez/5 min por aba; ele decide).
document.addEventListener('visibilitychange', () => {
  if (ligada && geracao !== null && document.visibilityState === 'visible') enviar({ tipo: 'publiai:busca-visivel', geracao });
});

// Estado inicial da chave (sem rede no SW). Falha ou resposta que não diz ativa e logado: continua desligada.
void (async () => {
  try {
    const e = await chrome.runtime.sendMessage({ tipo: 'publiai:estado-extensao' });
    if (estadoRecebido) return;
    ligada = e?.ativa === true && e?.logado === true;
    if (ligada) agendar();
  } catch {
    // contexto invalidado: silencioso
  }
})();
