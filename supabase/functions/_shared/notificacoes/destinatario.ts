import { CATEGORIAS_NOTIFICACAO } from './categorias.ts';

/** Sanitiza a entrada de destinatário Telegram vinda da UI (edge function usuarios).
 * chat_id do Telegram é sempre inteiro (negativo p/ grupos); vazio = não recebe.
 * Categorias fora do conjunto conhecido são descartadas silenciosamente. */
export function sanitizarDestinatario(
  input: { telegram_chat_id?: unknown; telegram_categorias?: unknown },
): { ok: true; chatId: string | null; categorias: string[] } | { ok: false; erro: string } {
  const raw = String(input.telegram_chat_id ?? '').trim();
  if (raw && !/^-?\d+$/.test(raw)) {
    return { ok: false, erro: 'chat_id deve ser numérico (ex.: 123456789)' };
  }
  const validas = CATEGORIAS_NOTIFICACAO as readonly string[];
  const categorias = Array.isArray(input.telegram_categorias)
    ? [...new Set(input.telegram_categorias.filter((c): c is string => typeof c === 'string' && validas.includes(c)))]
    : [];
  return { ok: true, chatId: raw || null, categorias };
}
