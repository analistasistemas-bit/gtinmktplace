import { CATEGORIAS_NOTIFICACAO, ehSoAdmin } from './categorias.ts';

/** chat_id de conversa privada com o bot: inteiro positivo (grupo/canal é negativo). */
export const chatPrivado = (chatId: string | null | undefined): boolean => /^[1-9]\d*$/.test(chatId?.trim() ?? '');

/** Sanitiza a entrada de destinatário Telegram vinda da UI (edge function usuarios).
 * chat_id do Telegram é sempre inteiro (negativo p/ grupos); vazio = não recebe.
 * Categorias fora do conjunto conhecido são descartadas silenciosamente.
 * Categorias gerenciais (ADR-0190) exigem `alvo.isAdmin` e, com chat preenchido, chat privado. */
export function sanitizarDestinatario(
  input: { telegram_chat_id?: unknown; telegram_categorias?: unknown },
  alvo?: { isAdmin: boolean },
): { ok: true; chatId: string | null; categorias: string[] } | { ok: false; erro: string } {
  const raw = String(input.telegram_chat_id ?? '').trim();
  if (raw && !/^-?\d+$/.test(raw)) {
    return { ok: false, erro: 'chat_id deve ser numérico (ex.: 123456789)' };
  }
  const validas = CATEGORIAS_NOTIFICACAO as readonly string[];
  const categorias = Array.isArray(input.telegram_categorias)
    ? [...new Set(input.telegram_categorias.filter((c): c is string => typeof c === 'string' && validas.includes(c)))]
    : [];
  if (categorias.some(ehSoAdmin)) {
    if (!alvo?.isAdmin) return { ok: false, erro: 'Notificações gerenciais são só para admin.' };
    if (raw && !chatPrivado(raw)) {
      return { ok: false, erro: 'Notificações gerenciais exigem conversa privada com o bot (chat_id positivo).' };
    }
  }
  return { ok: true, chatId: raw || null, categorias };
}
