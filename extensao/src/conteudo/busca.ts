// Content script da busca (ADR-0189 D-11, Task 22): lê os cards (que montam depois do document_idle e entram no
// scroll), manda ao SW e, quando o painel analisa, põe o selo só nos cards casados com SKU da org. Nunca reordena nem
// esconde cards do ML; o destaque pedido pelo painel só rola e contorna o card por 2 s.
import type { ResultadoCard } from '../../../supabase/functions/_shared/extensao/busca.ts';
import { cardsDoItem, lerBusca } from '../leitura/busca';
import { CORES, MARCA } from './aparencia';
import { seloDaBusca } from './selo-busca';

const ESPERA_MS = 800;
const LIMITE_ESPERA_MS = 15_000;
const HOST = 'publiai-selo-busca';
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

function lerEEnviar(): void {
  if (!ligada) return;
  // URL mudou sem recarregar (filtro aplicado por script): o SW abriu outra geração e zerou o estado; reenvia tudo.
  const url = location.href.split('#')[0];
  if (url !== urlAtual) { urlAtual = url; enviados = new Map(); limparSelos(); }
  // Reenvia também o card que completou preço, catálogo ou vendidos depois da 1ª leitura.
  const assinatura = (c: { preco: number | null; catalogProductId: string | null; vendidosTexto: string | null }) =>
    `${c.preco}|${c.catalogProductId}|${c.vendidosTexto}`;
  const novos = lerBusca(document).filter((c) => enviados.get(c.itemId) !== assinatura(c));
  if (novos.length === 0) return;
  for (const c of novos) enviados.set(c.itemId, assinatura(c));
  enviar({ tipo: 'publiai:busca-cards', cards: novos, ocorrencias: document.querySelectorAll('.poly-card').length });
}

function criarSelo(texto: string, titulo: string, tom: keyof typeof CORES): HTMLElement {
  const host = document.createElement('div');
  host.className = HOST;
  host.style.cssText = 'display:block;margin:6px 0 2px';
  // Fechado: scripts da página não leem a margem (dado financeiro da org).
  const raiz = host.attachShadow({ mode: 'closed' });
  const c = CORES[tom];
  raiz.innerHTML = `<style>
      span.selo{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:2px 10px 2px 6px;
        border:1px solid ${c.borda};border-radius:999px;background:${c.fundo};color:${c.texto};
        font:600 12px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
      svg{width:14px;height:14px;flex:none}
    </style><span class="selo" role="note">${MARCA}<span></span></span>`;
  const rotulo = raiz.querySelector('span.selo > span')!;
  rotulo.textContent = texto;
  const selo = raiz.querySelector('span.selo')!;
  selo.setAttribute('title', titulo);
  selo.setAttribute('aria-label', `PubliAI: ${texto}. ${titulo}`);
  return host;
}

/** Selo nos cards casados (idempotente: refaz do zero, então resultado que deixou de ter selo perde o antigo). */
function aplicarSelos(): void {
  if (!ligada) return;
  for (const h of document.querySelectorAll(`.${HOST}`)) h.remove();
  for (const [itemId, r] of Object.entries(resultados)) {
    const s = seloDaBusca(r);
    if (!s) continue;
    for (const card of cardsDoItem(document, itemId)) {
      const preco = card.querySelector('.poly-component__price');
      (preco?.parentElement ?? card).insertBefore(criarSelo(s.texto, s.titulo, s.tom), preco?.nextSibling ?? null);
    }
  }
}

function limparSelos(): void {
  tirarDestaque();
  resultados = {};
  for (const h of document.querySelectorAll(`.${HOST}`)) h.remove();
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

chrome.runtime.onMessage.addListener((msg: { tipo?: unknown; resultados?: unknown; itemId?: unknown; ativa?: unknown; logado?: unknown }) => {
  if (msg?.tipo === 'publiai:ativacao' || msg?.tipo === 'publiai:conta-mudou') {
    estadoRecebido = true;
    ligada = msg.ativa === true && msg.logado === true;
    limparSelos();
    enviados = new Map(); // o SW zerou o estado; ligando, os cards voltam (a análise só sai quando o painel pedir)
    lerEEnviar();
  } else if (ligada && msg?.tipo === 'publiai:busca-resultados' && msg.resultados && typeof msg.resultados === 'object') {
    resultados = msg.resultados as Record<string, ResultadoCard>;
    aplicarSelos();
  } else if (ligada && msg?.tipo === 'publiai:destacar-card' && typeof msg.itemId === 'string') {
    destacar(msg.itemId);
  } else if (ligada && msg?.tipo === 'publiai:sessao-mudou') {
    limparSelos();
    enviados = new Map(); // nova sessão: o SW zerou o estado; os cards voltam a ser enviados
    lerEEnviar();
  }
});

// Cards montam depois do document_idle e entram no scroll: observa a página com espera curta entre leituras.
let timer: ReturnType<typeof setTimeout> | undefined;
const agendar = () => { clearTimeout(timer); timer = setTimeout(() => { lerEEnviar(); aplicarSelos(); }, ESPERA_MS); };
new MutationObserver((mudancas) => {
  // Mudanças só dos nossos selos não disparam nova leitura.
  if (mudancas.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => (n as Element).classList?.contains(HOST)))) return;
  agendar();
}).observe(document.body, { childList: true, subtree: true });
const inicio = Date.now();
(function esperarCards() {
  if (document.querySelector('.poly-card')) { agendar(); return; } // mesma espera do observer: card ainda montando
  if (Date.now() - inicio < LIMITE_ESPERA_MS) setTimeout(esperarCards, 500);
})();

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
