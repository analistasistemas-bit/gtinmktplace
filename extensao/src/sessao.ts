// Sessão recebida do PubliAI web (ADR-0189 D-4). Guarda SÓ o access token do Supabase em
// chrome.storage.session (memória; acesso padrão TRUSTED_CONTEXTS → content scripts não leem).
// Nunca guarda nem pede refresh token: expirou, o app web empurra outra sessão.
// A sessão traz a identidade `usuário:org:suporte` (sem segredo): análises guardadas por aba valem só para
// ela — troca de identidade, desconexão ou sessão expirada apagam tudo (dado financeiro de outra org).
import { limparEstadosDasAbas } from './abas';

const CHAVE = 'sessao';
const MARGEM_MS = 30_000;

interface Sessao {
  accessToken: string;
  /** Segundos desde a época (`session.expires_at` do Supabase). */
  expiresAt: number;
  orgNome: string;
  identidade: string;
}

// usuário obrigatório; org vazia = perfil ainda carregando no app; suporte vazio = fora de suporte.
const IDENTIDADE = /^[\w-]{1,64}:[\w-]{0,64}:[\w-]{0,64}$/;

/** Identidade a guardar dado que a anterior era `antes`, ou null se é outra identidade (→ limpar).
 *  Org vazia (perfil carregando) não troca nada e herda a org conhecida — senão X → '' → Y passaria sem limpar. */
export function proximaIdentidade(antes: string | null, nova: string): string | null {
  if (antes === null) return null;
  const [ua, oa, sa] = antes.split(':');
  const [un, on, sn] = nova.split(':');
  if (ua !== un || sa !== sn) return null;
  if (on === '' || on === oa) return antes;
  return oa === '' ? nova : null;
}

/** Origens aceitas = `externally_connectable.matches` do manifest gerado para o modo do build. */
function origemPermitida(origin: string | undefined): boolean {
  if (!origin) return false;
  const matches = chrome.runtime.getManifest().externally_connectable?.matches ?? [];
  return matches.some((m) => new URL(m.replace(/\*$/, '')).origin === origin);
}

// Fila única: toda leitura-decisão-escrita da chave `sessao` e do alarme roda em série, senão a limpeza
// da sessão A apaga (ou cancela o alarme de) uma sessão B que chegou no meio. Dentro da fila só se chamam
// as versões internas (lerSessao/validar/limpar/agendar) — chamar uma exportada daqui travaria a fila.
// ponytail: fila só em memória; SW morto entre operações a perde (cada operação é curta, nada a retomar).
let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(op: () => Promise<T>): Promise<T> {
  const r = fila.then(op);
  fila = r.catch(() => {});
  return r;
}

/** Roda `fn` na fila só se a sessão guardada ainda é da `identidade` (null = sem sessão); senão devolve null.
 *  Gravar estado/responder análise aqui dentro: troca de identidade, logout ou expiração no meio não deixam
 *  passar a resposta pedida pela sessão anterior. `fn` não pode chamar nada enfileirado. */
export function seAindaIdentidade<T>(identidade: string | null, fn: () => Promise<T>): Promise<T | null> {
  return naFila(async () => ((await lerSessao())?.identidade ?? null) === identidade ? fn() : null);
}

/** limparEstadosDasAbas fora da sessão (ex.: suporte acabou), em série com o resto. */
export const limparAbasNaFila = () => naFila(limparEstadosDasAbas);

export async function receberMensagemExterna(msg: unknown, sender: chrome.runtime.MessageSender): Promise<{ ok: boolean }> {
  if (!origemPermitida(sender.origin)) return { ok: false };
  const m = msg as Partial<Sessao> & { tipo?: unknown } | null;
  if (m?.tipo === 'publiai:desconectar') {
    await naFila(() => limpar());
    return { ok: true };
  }
  if (
    m?.tipo === 'publiai:sessao' &&
    typeof m.accessToken === 'string' && m.accessToken !== '' &&
    // > 1e11 = milissegundos por engano (segundos só passam disso no ano 5138).
    typeof m.expiresAt === 'number' && Number.isFinite(m.expiresAt) && m.expiresAt <= 1e11 &&
    typeof m.orgNome === 'string' &&
    typeof m.identidade === 'string' && IDENTIDADE.test(m.identidade)
  ) {
    const { accessToken, expiresAt, orgNome, identidade } = m;
    return naFila(async () => {
      const anterior = await lerSessao();
      const mantida = proximaIdentidade(anterior?.identidade ?? null, identidade);
      // Sessão nova primeiro: chamada em voo da identidade antiga já se vê descartada (api.ts).
      const sessao: Sessao = { accessToken, expiresAt, orgNome, identidade: mantida ?? identidade };
      await chrome.storage.session.set({ [CHAVE]: sessao });
      if (mantida === null) await limparEstadosDasAbas();
      await agendar(sessao.expiresAt);
      return { ok: true };
    });
  }
  return { ok: false };
}

const ALARME = 'sessao-expira';

async function lerSessao(): Promise<Sessao | undefined> {
  return (await chrome.storage.session.get(CHAVE))[CHAVE] as Sessao | undefined;
}

/** Mesmo limite do alarme e da invalidação: restam ≤ 30 s → vencida (igualdade incluída). */
const vencida = (expiresAt: number) => expiresAt * 1000 - Date.now() <= MARGEM_MS;

/** Expiração passiva (sem interação): o SW acorda no fim da validade e apaga sessão, análises e selos.
 *  Já vencida ao chegar → limpa na hora. Só dentro da fila. */
async function agendar(expiresAt: number): Promise<void> {
  if (vencida(expiresAt)) {
    await validar();
    return;
  }
  await chrome.alarms.create(ALARME, { when: expiresAt * 1000 - MARGEM_MS });
}

/** `chrome.alarms.onAlarm` (registrado no topo do sw.ts). Disparo adiantado com sessão válida → reagenda
 *  (alarme sem período dispara uma vez só). */
export async function aoAlarme(a: chrome.alarms.Alarm): Promise<void> {
  if (a.name !== ALARME) return;
  await naFila(async () => {
    const s = await validar();
    if (s) await agendar(s.expiresAt);
  });
}

/** Só dentro da fila. Vencida → limpa e devolve null. */
async function validar(): Promise<Sessao | null> {
  const s = await lerSessao();
  if (!s) return null;
  if (vencida(s.expiresAt)) {
    await limpar();
    return null;
  }
  return s;
}

/** null se não há sessão ou faltam ≤ 30 s para expirar. Não renova. Expirada: apaga a sessão e, com ela,
 *  as análises das abas — sem sessão válida nada financeiro fica visível. Ausente já foi limpa
 *  quando saiu (todo caminho de saída passa por limpar). */
export async function obterSessaoValida(): Promise<{ accessToken: string; identidade: string } | null> {
  const s = await naFila(validar);
  return s && { accessToken: s.accessToken, identidade: s.identidade };
}

/** Identidade da sessão guardada agora (ou null), para descartar resposta pedida por outra. */
export async function identidadeAtual(): Promise<string | null> {
  return (await lerSessao())?.identidade ?? null;
}

/** Com `seAinda`, só apaga se a sessão guardada ainda é a desse token (o app pode ter
 *  empurrado outra enquanto a chamada que deu 401 estava em voo). */
export function limparSessao(seAinda?: string): Promise<void> {
  return naFila(() => limpar(seAinda));
}

/** Só dentro da fila: conferência, remoção, cancelamento do alarme e limpeza das abas na mesma seção. */
async function limpar(seAinda?: string): Promise<void> {
  if (seAinda !== undefined && (await lerSessao())?.accessToken !== seAinda) return;
  await chrome.storage.session.remove(CHAVE);
  await chrome.alarms.clear(ALARME);
  await limparEstadosDasAbas();
}
