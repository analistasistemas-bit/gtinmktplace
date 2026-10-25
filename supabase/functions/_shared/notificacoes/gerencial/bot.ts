// Bot de comandos (ADR-0190 D-8) — lógica pura: secret do webhook por (org, bot), comando e acesso.
// O secret identifica bot → org ANTES de resolver a pessoa; trocar o token zera o bot_id (trigger) e
// invalida o secret antigo.
import { chatPrivado } from '../destinatario.ts';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256(chave, `${orgId}:${botId}`) em hex (64 chars, aceito como `secret_token` do Telegram). */
export async function secretDaOrg(chave: string, orgId: string, botId: number): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(`${orgId}:${botId}`)));
}

/** Compara em tempo constante (sobre o tamanho esperado). */
export async function secretValido(chave: string, orgId: string, botId: number, recebido: string | null): Promise<boolean> {
  if (recebido == null) return false;
  const esperado = await secretDaOrg(chave, orgId, botId);
  let dif = esperado.length ^ recebido.length;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ (recebido.charCodeAt(i) || 0);
  return dif === 0;
}

export type Comando = 'hoje' | 'ontem' | 'mes' | 'top' | 'ajuda' | null;
const COMANDOS = new Set(['hoje', 'ontem', 'mes', 'top', 'ajuda']);

/** `/TOP@PubliAIBot extra` → 'top'. Texto livre ou comando fora da lista → null. */
export function interpretarComando(texto?: string): Comando {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(texto?.trim() ?? '');
  const c = m?.[1].toLowerCase();
  return c && COMANDOS.has(c) ? (c as Comando) : null;
}

export type Acesso = 'ok' | 'grupo' | 'sem_acesso';

/** Só conversa privada (type 'private' e id positivo) com profile admin ativo do chat. */
export function avaliarAcesso(
  chat: { id: number; type: string }, profiles: { is_admin: boolean; is_active: boolean }[],
): Acesso {
  if (chat.type !== 'private' || !chatPrivado(String(chat.id))) return 'grupo';
  return profiles.some((p) => p.is_admin === true && p.is_active === true) ? 'ok' : 'sem_acesso';
}
