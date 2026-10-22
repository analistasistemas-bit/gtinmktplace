// Data de criação do anúncio aberto (ADR-0189 emenda 2026-10-22): um GET do HTML de produto.mercadolivre.com.br
// com a sessão do usuário (deslogado o ML não traz o `gtm_event.startTime`). Só o SW pode (host permission; da
// página daria CORS). Cache por item em storage.session, inclusive a falha: nunca tenta de novo sozinho.
import { startTimeDoHtml } from './compartilhado/quanto-vende';

const chave = (mlItemId: string) => `criacao:${mlItemId}`;

// Busca em voo por item: análises simultâneas do mesmo anúncio dividem o mesmo GET.
const emVoo = new Map<string, Promise<string | null>>();

/** Nunca lança: qualquer falha (storage, rede, timeout, captcha) → null. */
export function dataCriacaoDoAnuncio(mlItemId: string): Promise<string | null> {
  let p = emVoo.get(mlItemId);
  if (!p) {
    p = buscar(mlItemId).finally(() => emVoo.delete(mlItemId));
    emVoo.set(mlItemId, p);
  }
  return p;
}

async function buscar(mlItemId: string): Promise<string | null> {
  const guardado = (await chrome.storage.session.get(chave(mlItemId)).catch(() => ({})) as Record<string, unknown>)[chave(mlItemId)];
  if (guardado !== undefined) return typeof guardado === 'string' ? guardado : null;
  let data: string | null = null;
  try {
    const r = await fetch(`https://produto.mercadolivre.com.br/${mlItemId.replace('MLB', 'MLB-')}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) data = startTimeDoHtml(await r.text(), mlItemId);
  } catch {
    // timeout, rede, captcha: data indisponível
  }
  await chrome.storage.session.set({ [chave(mlItemId)]: data }).catch(() => {});
  return data;
}
