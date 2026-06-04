import type { PayloadItem } from './publicar.ts';

export interface ResultadoItem {
  id: string;
  permalink: string;
  variations: Array<{ id: string | number; seller_custom_field?: string }>;
}

export async function criarItemML(accessToken: string, payload: PayloadItem): Promise<ResultadoItem> {
  const resp = await fetch('https://api.mercadolibre.com/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const detalhe = json?.message ?? JSON.stringify(json);
    const e = new Error(`ML rejeitou (${resp.status}): ${detalhe}`);
    (e as { status?: number }).status = resp.status;
    throw e;
  }
  return { id: json.id, permalink: json.permalink, variations: json.variations ?? [] };
}

/**
 * O ML rejeita emojis na descrição (DESCRIPTION_PLAIN_TEXT_NOT_ALLOWED). O template
 * do copywriter (M3.1) usa emojis no preview; aqui removemos só para o envio ao ML.
 * Checkmarks viram "- " (mantêm a lista); bullet "•" e acentos são aceitos.
 */
export function sanitizarDescricaoML(texto: string): string {
  return texto
    .replace(/[✔✅☑]️?[ \t]*/g, '- ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}️]/gu, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cria/atualiza a descrição do item. No ML a descrição é um recurso separado
 * (`/items/{id}/description`), não vai no POST /items. Idempotente: tenta POST
 * (criar) e cai para PUT (atualizar) se já existir — seguro em retries.
 */
export async function garantirDescricaoML(
  accessToken: string,
  itemId: string,
  texto: string,
): Promise<void> {
  const url = `https://api.mercadolibre.com/items/${itemId}/description`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ plain_text: sanitizarDescricaoML(texto) });

  let resp = await fetch(url, { method: 'POST', headers, body });
  if (resp.status === 400 || resp.status === 409) {
    resp = await fetch(url, { method: 'PUT', headers, body });
  }
  if (!resp.ok) {
    throw new Error(`Descrição (${resp.status}): ${await resp.text()}`);
  }
}
