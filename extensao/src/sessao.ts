// Sessão recebida do PubliAI web (ADR-0189 D-4). Guarda SÓ o access token do Supabase em
// chrome.storage.session (memória; acesso padrão TRUSTED_CONTEXTS → content scripts não leem).
// Nunca guarda nem pede refresh token: expirou, o app web empurra outra sessão.

const CHAVE = 'sessao';
const MARGEM_MS = 30_000;

interface Sessao {
  accessToken: string;
  /** Segundos desde a época (`session.expires_at` do Supabase). */
  expiresAt: number;
  orgNome: string;
}

/** Origens aceitas = `externally_connectable.matches` do manifest gerado para o modo do build. */
function origemPermitida(origin: string | undefined): boolean {
  if (!origin) return false;
  const matches = chrome.runtime.getManifest().externally_connectable?.matches ?? [];
  return matches.some((m) => new URL(m.replace(/\*$/, '')).origin === origin);
}

export async function receberMensagemExterna(msg: unknown, sender: chrome.runtime.MessageSender): Promise<{ ok: boolean }> {
  if (!origemPermitida(sender.origin)) return { ok: false };
  const m = msg as Partial<Sessao> & { tipo?: unknown } | null;
  if (m?.tipo === 'publiai:desconectar') {
    await limparSessao();
    return { ok: true };
  }
  if (
    m?.tipo === 'publiai:sessao' &&
    typeof m.accessToken === 'string' && m.accessToken !== '' &&
    typeof m.expiresAt === 'number' && Number.isFinite(m.expiresAt) &&
    typeof m.orgNome === 'string'
  ) {
    const sessao: Sessao = { accessToken: m.accessToken, expiresAt: m.expiresAt, orgNome: m.orgNome };
    await chrome.storage.session.set({ [CHAVE]: sessao });
    return { ok: true };
  }
  return { ok: false };
}

/** null se não há sessão ou faltam < 30 s para expirar. Não renova. */
export async function obterSessaoValida(): Promise<{ accessToken: string } | null> {
  const s = (await chrome.storage.session.get(CHAVE))[CHAVE] as Sessao | undefined;
  if (!s || s.expiresAt * 1000 - Date.now() < MARGEM_MS) return null;
  return { accessToken: s.accessToken };
}

/** Com `seAinda`, só apaga se a sessão guardada ainda é a desse token (o app pode ter
 *  empurrado outra enquanto a chamada que deu 401 estava em voo). */
export async function limparSessao(seAinda?: string): Promise<void> {
  if (seAinda !== undefined) {
    const s = (await chrome.storage.session.get(CHAVE))[CHAVE] as Sessao | undefined;
    if (s?.accessToken !== seAinda) return;
  }
  await chrome.storage.session.remove(CHAVE);
}
