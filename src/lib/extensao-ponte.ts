import type { Session } from '@supabase/supabase-js';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';

// Ponte app web → extensão PubliAI (ADR-0189 D-4). Protocolo ≥ 2 (0.3+): a extensão tem sessão própria e a
// ponte só faz ping (versão/protocolo). Legado 0.2.x: o app é o dono do refresh token e empurra só o access
// token e a validade. `chrome.runtime.sendMessage` só existe na página
// quando há extensão com `externally_connectable` casando esta origem.

export type ResultadoPonte = 'ok' | 'nao_instalada' | 'desconectada';

interface RuntimeExterno {
  sendMessage: (id: string, msg: unknown, cb: (resp: unknown) => void) => void;
  lastError?: unknown;
}

/** `usuário:org:pedido-de-suporte` — sem segredo. A extensão apaga as análises guardadas quando muda
 *  (logout, troca de conta, início/fim de suporte). Org vazia = perfil ainda carregando. */
export function identidadeExtensao(session: Session): string {
  return `${session.user.id}:${effectiveOrgId() ?? ''}:${useSupportStore.getState().context?.requestId ?? ''}`;
}

/** Manda `msg` à extensão; undefined = ausente/erro. */
function mandar(id: string, runtime: RuntimeExterno, msg: unknown): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    try {
      runtime.sendMessage(id, msg, (r) => {
        // Ler lastError marca o erro como tratado (senão o Chrome loga "Unchecked runtime.lastError").
        resolve(runtime.lastError ? undefined : r);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function contexto() {
  const id = import.meta.env.VITE_EXTENSAO_ID as string | undefined;
  const runtime = (globalThis as { chrome?: { runtime?: RuntimeExterno } }).chrome?.runtime;
  return id && typeof runtime?.sendMessage === 'function' ? { id, runtime } : null;
}

/** Versão e protocolo da extensão. null = ausente ou 0.2.x que não conhece o ping (responde `{ ok:false }`). */
export async function pingExtensao(): Promise<{ versao: string; protocolo: number } | null> {
  const c = contexto();
  if (!c) return null;
  const r = (await mandar(c.id, c.runtime, { tipo: 'publiai:ping' })) as { ok?: unknown; versao?: unknown; protocolo?: unknown } | undefined;
  if (r?.ok !== true || typeof r.versao !== 'string') return null;
  return { versao: r.versao, protocolo: typeof r.protocolo === 'number' ? r.protocolo : 0 };
}

export async function enviarSessaoParaExtensao(session: Session | null): Promise<ResultadoPonte> {
  const c = contexto();
  if (!c) return 'nao_instalada';

  // Protocolo ≥ 2 (0.3+): a extensão tem login próprio; o app não manda credencial nem desconectar.
  const ping = await pingExtensao();
  if (ping && ping.protocolo >= 2) return session ? 'ok' : 'desconectada';

  const msg = session
    ? {
        tipo: 'publiai:sessao',
        accessToken: session.access_token,
        // Segundos (a extensão recusa milissegundos).
        expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
        // ponytail: nome só existe no contexto de suporte; fora dele vai "" (a extensão não o exibe).
        orgNome: useSupportStore.getState().context?.orgName ?? '',
        identidade: identidadeExtensao(session),
      }
    : { tipo: 'publiai:desconectar' };

  const resp = await mandar(c.id, c.runtime, msg);
  if ((resp as { ok?: unknown } | undefined)?.ok !== true) return 'nao_instalada';
  return session ? 'ok' : 'desconectada';
}
