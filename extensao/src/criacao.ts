// Faixa e data de criação do anúncio aberto (ADR-0189 emenda 2026-10-22): um GET do HTML de
// produto.mercadolivre.com.br com a sessão do usuário (deslogado o ML não traz o `gtm_event.startTime`). Esse HTML é do
// anúncio; a faixa de /p/ e /up/ é agregada. Só o SW pode (host permission; da página daria CORS). Cache por item em
// storage.session, inclusive a falha: nunca tenta de novo sozinho.
import { startTimeDoHtml, vendidosDoHtml } from './compartilhado/quanto-vende';

export interface ObservadoDoAnuncio { criadoEm: string | null; vendidosAnuncio: string | null }

const chave = (mlItemId: string) => `anuncio-vip:${mlItemId}`;
const VAZIO: ObservadoDoAnuncio = { criadoEm: null, vendidosAnuncio: null };

// Busca em voo por item: análises simultâneas do mesmo anúncio dividem o mesmo GET.
const emVoo = new Map<string, Promise<ObservadoDoAnuncio>>();

/** Nunca lança: qualquer falha (storage, rede, timeout, captcha) → campos null. */
export function observadoDoAnuncio(mlItemId: string): Promise<ObservadoDoAnuncio> {
  let p = emVoo.get(mlItemId);
  if (!p) {
    p = buscar(mlItemId).finally(() => emVoo.delete(mlItemId));
    emVoo.set(mlItemId, p);
  }
  return p;
}

async function buscar(mlItemId: string): Promise<ObservadoDoAnuncio> {
  const guardado = (await chrome.storage.session.get(chave(mlItemId)).catch(() => ({})) as Record<string, unknown>)[chave(mlItemId)];
  if (guardado && typeof guardado === 'object') return { ...VAZIO, ...(guardado as Partial<ObservadoDoAnuncio>) };
  let obs = VAZIO;
  try {
    const r = await fetch(`https://produto.mercadolivre.com.br/${mlItemId.replace('MLB', 'MLB-')}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const html = await r.text();
      obs = { criadoEm: startTimeDoHtml(html, mlItemId), vendidosAnuncio: vendidosDoHtml(html, mlItemId) };
    }
  } catch {
    // timeout, rede, captcha: indisponível
  }
  await chrome.storage.session.set({ [chave(mlItemId)]: obs }).catch(() => {});
  return obs;
}
