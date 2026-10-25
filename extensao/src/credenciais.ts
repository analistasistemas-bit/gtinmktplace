// Sessão própria da extensão (ADR-0189, emenda 2026-10-24, D-4). Só o service worker importa este módulo.
// Credenciais Supabase (access + refresh) em chrome.storage.local restrito a TRUSTED_CONTEXTS (content scripts
// não leem); a senha só trafega painel → SW → Supabase e nunca é gravada. Só o SW renova, na fila única.
// Risco residual aceito: quem tem acesso ao perfil/disco do Chrome lê o refresh token.
import { limparEstadosDasAbas } from './abas';

export interface Credenciais { accessToken: string; refreshToken: string; /** segundos */ expiresAt: number; userId: string }
export interface Perfil { nome: string | null; email: string | null; orgNome: string | null }
/** O par + identidade/perfil vindos da ação `sessao` da edge (null até `definirIdentidade`). */
export interface Guardado extends Credenciais { identidade: string | null; perfil: Perfil | null }

const CHAVE = 'credenciais';
const MARGEM_MS = 30_000;
const TEMPO_LIMITE_MS = 15_000;

// Fila única: toda leitura-decisão-escrita das credenciais (e da identidade) roda em série. Dentro dela só se
// chamam versões internas — chamar algo enfileirado daqui travaria a fila. `sair` é a exceção: roda fora.
// ponytail: fila só em memória; SW morto entre operações a perde (cada operação é curta, nada a retomar).
let fila: Promise<unknown> = Promise.resolve();
export function naFila<T>(op: () => Promise<T>): Promise<T> {
  const r = fila.then(op);
  fila = r.catch(() => {});
  return r;
}

// Geração das credenciais: sobe a cada login gravado e a cada saída. Login/renovação em voo capturam a geração
// antes da rede e só gravam se ela não mudou (checagem e `set` sem await no meio). Não é GERACAO_SESSAO de
// abas.ts: aquela sobe também em troca de identidade/suporte, e descartar um par já rotacionado deslogaria.
// Só memória: o que estava em voo morre junto com o SW.
let geracao = 0;

/** Boot do SW e antes de toda gravação de token. Rejeição propaga: sem a restrição, nada é gravado. */
export const protegerCredenciais = () => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

export async function lerCredenciais(): Promise<Guardado | undefined> {
  return (await chrome.storage.local.get(CHAVE))[CHAVE] as Guardado | undefined;
}

/** Grava `g` se a geração ainda é `gen`. false = outra geração (saiu/entrou no meio) ou sem proteção do storage. */
async function gravarSe(gen: number, g: Guardado): Promise<boolean> {
  try {
    await protegerCredenciais();
  } catch {
    return false;
  }
  if (gen !== geracao) return false;
  await chrome.storage.local.set({ [CHAVE]: g }); // set invocado sem await depois da checagem
  return true;
}

/** Só na fila: regrava as credenciais guardadas com `muda` (null = não grava). Devolve as anteriores se gravou.
 *  Saída no meio (`sair` roda fora da fila) vence: nada é regravado. */
export async function regravarNaFila(muda: (g: Guardado) => Guardado | null): Promise<Guardado | null> {
  const gen = geracao;
  const g = await lerCredenciais();
  const novo = g && muda(g);
  return novo && (await gravarSe(gen, novo)) ? g! : null;
}

function auth(caminho: string, corpo?: object, token?: string): Promise<Response> {
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}${caminho}`, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS), // fetch pendurado travaria a fila inteira
  });
}

/** Par da resposta de `/auth/v1/token`, ou null fora do contrato. Validade pelo relógio local + expires_in
 *  (relógio local atrasado não manda token vencido à edge); sem expires_in, usa expires_at. */
async function parDaResposta(r: Response): Promise<Credenciais | null> {
  const j = await r.json().catch(() => null) as
    { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; expires_at?: unknown; user?: { id?: unknown } } | null;
  const texto = (v: unknown): v is string => typeof v === 'string' && v !== '';
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!texto(j?.access_token) || !texto(j.refresh_token) || !texto(j.user?.id)) return null;
  const expiresAt = num(j.expires_in) ? Math.floor(Date.now() / 1000) + j.expires_in : num(j.expires_at) ? j.expires_at : null;
  if (expiresAt === null) return null;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt, userId: j.user!.id as string };
}

const transitorio = (status: number) => status === 408 || status === 429 || status >= 500;

export async function entrar(email: string, senha: string): Promise<{ ok: true } | { ok: false; erro: 'credenciais_invalidas' | 'rede' }> {
  const REDE = { ok: false, erro: 'rede' } as const;
  const gen = geracao;
  let r: Response;
  try {
    r = await auth('/auth/v1/token?grant_type=password', { email, password: senha });
  } catch {
    return REDE;
  }
  if (transitorio(r.status)) return REDE;
  if (!r.ok) return { ok: false, erro: 'credenciais_invalidas' };
  const par = await parDaResposta(r);
  if (!par) return REDE;
  return naFila(async () => {
    // Sair apertado durante o login (gen mudou) vence: a resposta não loga.
    if (!(await gravarSe(gen, { ...par, identidade: null, perfil: null }))) return REDE;
    await limparEstadosDasAbas(); // login sobe a geração da sessão
    return { ok: true };
  });
}

/** Apaga as credenciais e as análises das abas. Na fila, salvo em `sair`. */
export async function apagarCredenciais(): Promise<void> {
  geracao++;
  await chrome.storage.local.remove(CHAVE);
  await limparEstadosDasAbas();
}

export type TokenValido = { accessToken: string; identidade: string | null } | { erro: 'sem_sessao' } | { erro: 'transitorio' };

/** Access válido (renova se restam ≤ 30 s). sem_sessao = deslogado de fato; transitorio = rede/429/5xx, credenciais
 *  mantidas (a próxima chamada tenta de novo). Refresh recusado (400/401…) desloga; nunca há loop: sem credenciais,
 *  a próxima chamada nem vai à rede. */
export function tokenValido(): Promise<TokenValido> {
  return naFila(async (): Promise<TokenValido> => {
    const g = await lerCredenciais();
    if (!g) return { erro: 'sem_sessao' };
    if (g.expiresAt * 1000 - Date.now() > MARGEM_MS) return { accessToken: g.accessToken, identidade: g.identidade };
    const gen = geracao;
    let r: Response;
    try {
      r = await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: g.refreshToken });
    } catch {
      return { erro: 'transitorio' };
    }
    if (gen !== geracao) return { erro: 'sem_sessao' }; // saiu durante a renovação: nada a gravar nem apagar
    if (transitorio(r.status)) return { erro: 'transitorio' };
    if (!r.ok) {
      await apagarCredenciais();
      return { erro: 'sem_sessao' };
    }
    const par = await parDaResposta(r);
    if (!par) return { erro: 'transitorio' };
    if (!(await gravarSe(gen, { ...g, ...par }))) return gen === geracao ? { erro: 'transitorio' } : { erro: 'sem_sessao' };
    return { accessToken: par.accessToken, identidade: g.identidade };
  });
}

/** Fora da fila: não espera renovação em voo (que, ao terminar, vê a geração nova e não grava). Limpeza local
 *  imediata; o logout `scope=local` (só esta sessão) é disparado sem aguardar — offline, sai só localmente. */
export async function sair(): Promise<void> {
  geracao++; // antes de qualquer await
  const g = await lerCredenciais();
  await apagarCredenciais();
  if (g) auth('/auth/v1/logout?scope=local', undefined, g.accessToken).catch(() => {});
}

export async function estaLogado(): Promise<boolean> {
  return (await lerCredenciais()) !== undefined;
}
