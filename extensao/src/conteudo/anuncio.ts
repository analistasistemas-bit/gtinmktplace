// Content script do anúncio: lê a página, pede a análise ao SW e mostra o selo ao lado do preço (ADR-0189).
// Roda uma vez em document_idle (a PDP do ML é renderizada no servidor).
import type { RespostaAnuncio } from '../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import { lerAnuncio } from '../leitura/pdp';
import { textoDoSelo } from './selo';

type Resp = { ok: true; dados: RespostaAnuncio } | { ok: false; erro: string };

const FALHA: Resp = { ok: false, erro: 'interno' };
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
    tipoPagina: 'anuncio',
    mlItemId,
    versao: chrome.runtime.getManifest().version,
    motivo: normalizarMotivo(motivo),
  });
}

function criarSelo(texto: string, aviso = false): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'publiai-selo';
  b.textContent = texto;
  b.style.cssText =
    `display:inline-block;margin:8px 0;padding:4px 10px;border:1px solid ${aviso ? '#9ca3af' : '#0f766e'};border-radius:999px;` +
    `background:${aviso ? '#f3f4f6' : '#ecfdf5'};color:${aviso ? '#374151' : '#065f46'};font:600 13px/1.4 system-ui,sans-serif;cursor:pointer`;
  b.addEventListener('click', () => {
    try {
      void chrome.runtime.sendMessage({ tipo: 'publiai:abrir-painel' }).catch(() => {});
    } catch {
      // contexto invalidado: silencioso
    }
  });
  return b;
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
  const { mlItemId: id, sellerId, catalogProductId, categoriaId, preco } = lido.dados;
  // eanDaBusca: o SW preenche com o EAN da própria aba (content script não lê storage.session).
  const r = await chamar({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: id, sellerId, catalogProductId, categoriaId, preco });

  let selo: HTMLElement | null = null;
  if (r.ok) {
    const texto = textoDoSelo(r.dados);
    if (texto) selo = criarSelo(texto);
  } else if (r.erro === 'sem_sessao' || r.erro === 'sessao_expirada') {
    selo = criarSelo('PubliAI · conecte a extensão', true);
  }
  // modulo_desligado, limite e demais erros: sem selo.
  if (selo && !inserir(selo)) erroLeitura('campo_ausente:selo', id);
}

void rodar();
