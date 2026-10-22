// Faixa e data de criação do anúncio aberto (ADR-0189 emenda 2026-10-22): um GET do HTML de
// produto.mercadolivre.com.br com a sessão do usuário (deslogado o ML não traz o `gtm_event.startTime`). Esse HTML é do
// anúncio; a faixa de /p/ e /up/ é agregada. Só o SW pode (host permission; da página daria CORS). Cache por item em
// storage.session, inclusive a falha: nunca tenta de novo sozinho.
import { startTimeDoHtml, vendidosDoHtml } from './compartilhado/quanto-vende';

/** motivo: por que faltou dado (aparece no painel; sem dado de terceiro, só o diagnóstico da leitura). */
export interface ObservadoDoAnuncio { criadoEm: string | null; vendidosAnuncio: string | null; motivo?: string }

const chave = (mlItemId: string) => `anuncio-vip:${mlItemId}`;
// Captcha do ML (antibot barra a requisição da extensão): nenhuma nova busca nesta sessão do navegador.
const BLOQUEADO = 'anuncio-vip:bloqueado';
const MOTIVO_CAPTCHA = 'captcha do Mercado Livre';
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
  const sess = (await chrome.storage.session.get([chave(mlItemId), BLOQUEADO]).catch(() => ({}))) as Record<string, unknown>;
  const guardado = sess[chave(mlItemId)];
  if (guardado && typeof guardado === 'object') return { ...VAZIO, ...(guardado as Partial<ObservadoDoAnuncio>) };
  if (sess[BLOQUEADO]) return { ...VAZIO, motivo: MOTIVO_CAPTCHA };
  let obs: ObservadoDoAnuncio;
  try {
    const r = await fetch(`https://produto.mercadolivre.com.br/${mlItemId.replace('MLB', 'MLB-')}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    // Antes de ler o corpo: timeout na leitura não pode impedir o bloqueio (achado Codex).
    if (r.redirected && new URL(r.url).pathname.startsWith('/captcha')) {
      await chrome.storage.session.set({ [BLOQUEADO]: true }).catch(() => {});
      return { ...VAZIO, motivo: MOTIVO_CAPTCHA };
    }
    const html = r.ok ? await r.text() : '';
    obs = { criadoEm: startTimeDoHtml(html, mlItemId), vendidosAnuncio: vendidosDoHtml(html, mlItemId) };
    if (!obs.criadoEm) {
      const destino = r.redirected ? ` → ${new URL(r.url).hostname}${new URL(r.url).pathname.slice(0, 12)}…` : '';
      obs.motivo = !r.ok ? `HTTP ${r.status}${destino}` : `página sem a data (${Math.round(html.length / 1000)} KB${destino})`;
    }
  } catch (e) {
    obs = { ...VAZIO, motivo: e instanceof DOMException && e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede' };
  }
  await chrome.storage.session.set({ [chave(mlItemId)]: obs }).catch(() => {});
  return obs;
}
