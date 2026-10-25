// Content script do anúncio: lê a página, pede a análise ao SW e mostra o selo ao lado do preço (ADR-0189).
// Roda uma vez em document_idle (a PDP do ML é renderizada no servidor).
import type { RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { avaliarQualidade } from '../compartilhado/qualidade';
import { ehPaginaCatalogo, lerAnuncio } from '../leitura/pdp';
import { esperarPaginaEstavel, lerComReleitura } from './leitura-estavel';
import { destacarMiniaturas, limparMiniaturas } from './miniaturas';
import { CORES, MARCA } from './aparencia';
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

// Geração local: cada rodar()/pausar() invalida a execução anterior (reentrante; resposta velha nunca vira selo).
let geracaoLocal = 0;
const removerSelo = () => document.getElementById('publiai-selo')?.remove();

/** Chave desligada ou conta saiu: tira selo e contornos e descarta a análise em voo. */
export function pausar(): void {
  geracaoLocal++;
  removerSelo();
  limparMiniaturas(document);
}

export async function rodar(): Promise<void> {
  const minha = ++geracaoLocal;
  const vale = () => minha === geracaoLocal;
  removerSelo(); // religar não duplica
  const lido = await lerComReleitura(() => lerAnuncio(document), () => esperarPaginaEstavel(), () => location.pathname + location.search);
  if (!vale()) return;
  if (!lido) return; // bloqueio/verificação do ML, navegação ou espera inconclusiva: não é quebra de layout
  const mlItemId = location.pathname.match(/MLB-?\d+/)?.[0].replace('-', '') ?? null;
  if (!lido.ok) return erroLeitura(lido.motivo, mlItemId);
  const { mlItemId: id, sellerId, catalogProductId, categoriaId, preco, vendidosTexto, lojaOficial, qualidade } = lido.dados;
  // eanDaBusca: o SW preenche com o EAN da própria aba (content script não lê storage.session).
  // vendidosTexto, lojaOficial e qualidade ficam no SW para o painel (não vão à edge).
  const r = await comSessaoEstavel(chamar({ acao: 'analisar_anuncio', tipoPagina, mlItemId: id, sellerId, catalogProductId, categoriaId, preco, vendidosTexto, lojaOficial, qualidade }));
  if (!r || !vale()) return; // sessão/chave mudou durante a análise: nada de selo da anterior
  // Só com análise ok há selo: inativa, sem_sessao, modulo_desligado, limite e demais erros ficam sem selo.
  if (!r.ok) return;
  // Só com a extensão ativa para a org (análise ok): marca as miniaturas fracas na galeria.
  destacarMiniaturas(document, avaliarQualidade(qualidade).fotosFracas.map((f) => f.id));
  const texto = textoDoSelo(r.dados);
  if (texto && !inserir(criarSelo(texto, tomDoSelo(r.dados)))) erroLeitura('campo_ausente:selo', id);
}

type Aviso = { tipo?: unknown; ativa?: unknown; logado?: unknown };
chrome.runtime.onMessage.addListener((msg: Aviso) => {
  aoMensagemDoSw(msg);
  if (msg?.tipo !== 'publiai:ativacao' && msg?.tipo !== 'publiai:conta-mudou') return;
  if (msg.ativa === true && msg.logado === true) void rodar();
  else pausar();
});

// Boot: só analisa com a chave ligada e logado (o selo "conecte a extensão" não existe mais).
void (async () => {
  try {
    const e = await chrome.runtime.sendMessage({ tipo: 'publiai:estado-extensao' });
    if (e?.ativa === true && e?.logado === true) await rodar();
  } catch {
    // contexto invalidado: silencioso
  }
})();
