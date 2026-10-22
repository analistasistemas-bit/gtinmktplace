// Content script do anúncio: lê a página, pede a análise ao SW e mostra o selo ao lado do preço (ADR-0189).
// Roda uma vez em document_idle (a PDP do ML é renderizada no servidor).
import type { RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { ehPaginaCatalogo, lerAnuncio } from '../leitura/pdp';
import { aoMensagemDoSw, comSessaoEstavel, textoDoSelo, tomDoSelo, type TomDoSelo } from './selo';

type Resp = { ok: true; dados: RespostaAnuncio } | { ok: false; erro: string };

const FALHA: Resp = { ok: false, erro: 'interno' };
// Só o registro de uso/erro na edge distingue; a análise é a mesma (vencedor da buy box em /p/).
const tipoPagina = ehPaginaCatalogo(location.pathname) ? 'catalogo' : 'anuncio';
// Síncrono pode lançar "Extension context invalidated" após recarregar a extensão: silencioso.
const chamar = async (corpo: object): Promise<Resp> => {
  try {
    return (await chrome.runtime.sendMessage({ tipo: 'publiai:chamar', corpo })) ?? FALHA;
  } catch {
    return FALHA;
  }
};

// O servidor só aceita motivos em minúsculas (campo_ausente:ml_item_id).
const normalizarMotivo = (m: string) => m.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

let erroEnviado = false;
function erroLeitura(motivo: string, mlItemId: string | null) {
  if (erroEnviado) return;
  erroEnviado = true;
  void chamar({
    acao: 'erro_leitura',
    tipoPagina,
    mlItemId,
    versao: chrome.runtime.getManifest().version,
    motivo: normalizarMotivo(motivo),
  });
}

// Cores do selo = tokens do app PubliAI (tema claro, a página do ML é clara). Shadow DOM: o CSS do ML não vaza.
const CORES: Record<TomDoSelo, { fundo: string; borda: string; texto: string }> = {
  lucro: { fundo: 'oklch(0.97 0.035 150)', borda: 'oklch(0.86 0.08 150)', texto: 'oklch(0.42 0.13 150)' },
  prejuizo: { fundo: 'oklch(0.97 0.025 25)', borda: 'oklch(0.87 0.07 25)', texto: 'oklch(0.50 0.20 25)' },
  neutro: { fundo: 'oklch(0.97 0.006 277)', borda: 'oklch(0.89 0.008 277)', texto: 'oklch(0.36 0.02 277)' },
  proprio: { fundo: 'oklch(0.96 0.03 277)', borda: 'oklch(0.86 0.07 277)', texto: 'oklch(0.45 0.19 277)' },
  conectar: { fundo: 'oklch(0.97 0.006 277)', borda: 'oklch(0.89 0.008 277)', texto: 'oklch(0.36 0.02 277)' },
};
const MARCA =
  '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><linearGradient id="m" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#5C5CEB"/><stop offset="1" stop-color="#9152E3"/></linearGradient></defs>' +
  '<g stroke="url(#m)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21H31"/><path d="M11 32H34"/><path d="M17 43H31"/><path d="M37 16 L53 32 L37 48"/></g>' +
  '<g fill="url(#m)"><circle cx="7" cy="21" r="3"/><circle cx="4" cy="32" r="3"/><circle cx="7" cy="43" r="3"/></g></svg>';

function criarSelo(texto: string, tom: TomDoSelo): HTMLElement {
  const host = document.createElement('div');
  host.id = 'publiai-selo';
  host.style.cssText = 'display:block;margin:10px 0 4px';
  // Fechado: scripts da página do ML não leem a margem pelo shadowRoot (dado financeiro da org).
  const raiz = host.attachShadow({ mode: 'closed' });
  const c = CORES[tom];
  raiz.innerHTML =
    `<style>
      button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:4px 12px 4px 8px;
        border:1px solid ${c.borda};border-radius:999px;background:${c.fundo};color:${c.texto};cursor:pointer;
        font:600 13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums;
        transition:box-shadow 150ms cubic-bezier(.22,1,.36,1)}
      button:hover{box-shadow:0 2px 8px oklch(0.28 0.04 277 / 0.14)}
      button:focus-visible{outline:2px solid oklch(0.55 0.20 277);outline-offset:2px}
      svg{width:16px;height:16px;flex:none}
      .seta{opacity:.6;font-weight:500}
    </style>
    <button type="button">${MARCA}<span></span><span class="seta" aria-hidden="true">›</span></button>`;
  raiz.querySelector('span')!.textContent = texto;
  const b = raiz.querySelector('button')!;
  b.setAttribute('aria-label', `${texto}. Abrir no painel do PubliAI`);
  b.addEventListener('click', () => {
    try {
      void chrome.runtime.sendMessage({ tipo: 'publiai:abrir-painel' }).catch(() => {});
    } catch {
      // contexto invalidado: silencioso
    }
  });
  return host;
}

function inserir(selo: HTMLElement): boolean {
  const alvo =
    document.querySelector('.ui-pdp-price__second-line') ??
    document.querySelector('.ui-pdp-price') ??
    document.querySelector('.ui-pdp-header__title-container') ??
    document.querySelector('h1');
  if (!alvo) return false;
  alvo.insertAdjacentElement('afterend', selo);
  return true;
}

async function rodar() {
  if (document.getElementById('publiai-selo')) return; // segunda execução na mesma página
  const lido = lerAnuncio(document);
  const mlItemId = location.pathname.match(/MLB-?\d+/)?.[0].replace('-', '') ?? null;
  if (!lido.ok) return erroLeitura(lido.motivo, mlItemId);
  const { mlItemId: id, sellerId, catalogProductId, categoriaId, preco, vendidosTexto, lojaOficial } = lido.dados;
  // eanDaBusca: o SW preenche com o EAN da própria aba (content script não lê storage.session).
  // vendidosTexto e lojaOficial ficam no SW para o painel (não vão à edge).
  const r = await comSessaoEstavel(chamar({ acao: 'analisar_anuncio', tipoPagina, mlItemId: id, sellerId, catalogProductId, categoriaId, preco, vendidosTexto, lojaOficial }));
  if (!r) return; // sessão mudou durante a análise: nada de selo da sessão anterior

  let selo: HTMLElement | null = null;
  if (r.ok) {
    const texto = textoDoSelo(r.dados);
    if (texto) selo = criarSelo(texto, tomDoSelo(r.dados));
  } else if (r.erro === 'sem_sessao' || r.erro === 'sessao_expirada') {
    selo = criarSelo('PubliAI · conecte a extensão', 'conectar');
  }
  // modulo_desligado, limite e demais erros: sem selo.
  if (selo && !inserir(selo)) erroLeitura('campo_ausente:selo', id);
}

chrome.runtime.onMessage.addListener((msg) => { aoMensagemDoSw(msg); });
void rodar();
