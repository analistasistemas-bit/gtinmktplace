import type { Session } from '@supabase/supabase-js';
import { useSupportStore } from '@/stores/support-store';

// Ponte app web → extensão PubliAI (ADR-0189 D-4). O app é o ÚNICO dono do refresh token:
// empurra só o access token e a validade. `chrome.runtime.sendMessage` só existe na página
// quando há extensão com `externally_connectable` casando esta origem.

export type ResultadoPonte = 'ok' | 'nao_instalada' | 'desconectada';

interface RuntimeExterno {
  sendMessage: (id: string, msg: unknown, cb: (resp: unknown) => void) => void;
  lastError?: unknown;
}

export async function enviarSessaoParaExtensao(session: Session | null): Promise<ResultadoPonte> {
  const id = import.meta.env.VITE_EXTENSAO_ID as string | undefined;
  const runtime = (globalThis as { chrome?: { runtime?: RuntimeExterno } }).chrome?.runtime;
  if (!id || typeof runtime?.sendMessage !== 'function') return 'nao_instalada';

  const msg = session
    ? {
        tipo: 'publiai:sessao',
        accessToken: session.access_token,
        // Segundos (a extensão recusa milissegundos).
        expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
        // ponytail: nome só existe no contexto de suporte; fora dele vai "" (a extensão não o exibe).
        orgNome: useSupportStore.getState().context?.orgName ?? '',
      }
    : { tipo: 'publiai:desconectar' };

  const resp = await new Promise<unknown>((resolve) => {
    try {
      runtime.sendMessage(id, msg, (r) => {
        // Ler lastError marca o erro como tratado (senão o Chrome loga "Unchecked runtime.lastError").
        resolve(runtime.lastError ? undefined : r);
      });
    } catch {
      resolve(undefined);
    }
  });
  if ((resp as { ok?: unknown } | undefined)?.ok !== true) return 'nao_instalada';
  return session ? 'ok' : 'desconectada';
}
