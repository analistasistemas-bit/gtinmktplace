// Despachante da galeria (ADR-0201, Task 8; Global Constraints "Relógio", "Filas", "Jobs", "Trava de escrita por MLB").
// O SQL (`galeria_trabalho_pendente`, `galeria_visao_pendente`, `galeria_trabalho_pendente_aplicacao`,
// `galeria_escritas_adiadas_pendentes`, migration 20261110171517) traz só linhas acionáveis, cabeça por prazo, sem
// cursor; `selecionarTrabalho` (puro) decide a ação com as mesmas regras. Cada publicação incrementa `despacho_seq` por
// compare-and-set (`deduplicationId = ${id}:${seq}`) e grava `publicado_em` só das mensagens aceitas, condicionado a
// `fase` + `despacho_seq`. Sem import de Deno/npm: QStash e relógio entram por `deps`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { talvezFinalizarLote } from '../lote/finalizar.ts';

export const LIMITES = { imagens: 50, visao: 20, aplicacao: 20 } as const;
export type Limites = { imagens: number; visao: number; aplicacao: number };

const ABERTOS_IMG = new Set(['pendente', 'submetendo', 'gerando']);
const EXECUCAO = new Set(['em_andamento', 'abortando', 'revertendo']);
const ITEM_ABERTO = new Set(['pendente', 'subindo', 'aplicando', 'compensando']);
const ESPERA_PUBLICADO_MS = 3 * 60_000;
const TETO_ADIADA_MS = 240 * 60_000;

export interface LinhaImagem {
  id: string; origem: string; status: string; fase: number; tentativa: number; despacho_seq: number;
  provedor: string | null; lease_ate: string | null; cena_path: string | null; alertas: unknown;
}
export interface LinhaItem {
  tipo: 'item'; id: string; aplicacao_id: string; aplicacao_status: string; prazo_ate: string | null; ciclo_ate: string | null;
  user_id: string | null; item_status: string; fase: number; despacho_seq: number; lease_ate: string | null;
  publicado_em: string | null; fotos_novas: unknown;
}
export interface LinhaAplicacao {
  tipo: 'aplicacao'; id: string; aplicacao_status: string; prazo_ate: string | null; ciclo_ate: string | null;
  itens_abertos: number; itens_aplicados: number;
}
export type LinhaDespacho =
  | (LinhaImagem & { fonte: 'imagem' | 'visao' })
  | (LinhaItem & { fonte: 'item' })
  | (LinhaAplicacao & { fonte: 'aplicacao' });

export interface Trabalho {
  tipo: 'imagem' | 'aplicacao_item' | 'aplicacao_foto' | 'aplicacao';
  id: string; fase: number; tentativa: number; despacho_seq: number;
  acao: 'submeter' | 'consultar' | 'alertar' | 'passo' | 'consultar_foto' | 'abortar' | 'compensar' | 'agregar';
  userId?: string | null;
  /** Item de aplicação: a aplicação dele (para não publicar item cuja aplicação acabou de receber uma ação). */
  aplicacaoId?: string;
}

export interface MensagemQStash {
  url: string; body: unknown; deduplicationId?: string; retries: number; queueName?: string;
}

const ms = (iso: string | null) => (iso == null ? null : Date.parse(iso));
const livre = (lease: string | null, agora: Date) => lease == null || ms(lease)! < agora.getTime();
const dentroDoCiclo = (ciclo: string | null, agora: Date) => ciclo != null && ms(ciclo)! > agora.getTime();

/** = `galeria_trabalho_pendente`: geração não terminal sem lease vigente (recorte nunca vai ao worker). */
export const imagemAcionavel = (l: LinhaImagem, agora: Date) =>
  l.origem === 'gerador' && ABERTOS_IMG.has(l.status) && livre(l.lease_ate, agora);

/** = `galeria_visao_pendente`: cena gravada e ainda sem alertas, em qualquer status (não disputa a cota da geração). */
export const visaoAcionavel = (l: LinhaImagem, agora: Date) =>
  l.origem === 'gerador' && l.cena_path != null && l.alertas == null && livre(l.lease_ate, agora);

/** = item de `galeria_trabalho_pendente_aplicacao`: aplicação em execução dentro do ciclo, item aberto e livre, e
 * nenhuma mensagem em voo (publicado há ≥3 min ou nunca; o worker zera `publicado_em` ao concluir cada fase). */
export const itemAcionavel = (l: LinhaItem, agora: Date) =>
  EXECUCAO.has(l.aplicacao_status) && dentroDoCiclo(l.ciclo_ate, agora) && ITEM_ABERTO.has(l.item_status)
  && livre(l.lease_ate, agora) && (l.publicado_em == null || agora.getTime() - ms(l.publicado_em)! >= ESPERA_PUBLICADO_MS);

/** Ação de nível da aplicação (executada no banco por `galeria_manter_aplicacao`); null = nada a fazer. */
export function acaoDaAplicacao(l: LinhaAplicacao, agora: Date): 'abortar' | 'compensar' | 'agregar' | null {
  if (!EXECUCAO.has(l.aplicacao_status) || !dentroDoCiclo(l.ciclo_ate, agora)) return null;
  if (l.aplicacao_status === 'em_andamento' && l.prazo_ate != null && ms(l.prazo_ate)! < agora.getTime()) return 'abortar';
  if (l.aplicacao_status !== 'em_andamento' && l.itens_aplicados > 0) return 'compensar';
  return l.itens_abertos === 0 ? 'agregar' : null;
}

const fotosEnviadasSemPronta = (fotos: unknown) =>
  Array.isArray(fotos) && fotos.length > 0 && fotos.every((f) => f?.upload_id) && fotos.some((f) => !f?.pronta);

/** Puro. Cotas separadas por fonte (imagens, visão, aplicação), na ordem recebida (o SQL já ordena por prazo). */
export function selecionarTrabalho(linhas: LinhaDespacho[], agora: Date, limites: Limites): Trabalho[] {
  const saida: Trabalho[] = [];
  const vistos = new Set<string>();
  const usado = { imagens: 0, visao: 0, aplicacao: 0 };
  const cabe = (cota: keyof Limites) => usado[cota] < limites[cota] && ++usado[cota] > 0;
  for (const l of linhas) {
    if (vistos.has(l.id)) continue;
    let t: Trabalho | null = null;
    if (l.fonte === 'imagem' && imagemAcionavel(l, agora) && cabe('imagens')) {
      t = { tipo: 'imagem', id: l.id, fase: l.fase, tentativa: l.tentativa, despacho_seq: l.despacho_seq,
        acao: l.status === 'gerando' ? 'consultar' : 'submeter' };
    } else if (l.fonte === 'visao' && visaoAcionavel(l, agora) && cabe('visao')) {
      t = { tipo: 'imagem', id: l.id, fase: l.fase, tentativa: l.tentativa, despacho_seq: l.despacho_seq, acao: 'alertar' };
    } else if (l.fonte === 'item' && itemAcionavel(l, agora) && cabe('aplicacao')) {
      const foto = l.item_status === 'subindo' && fotosEnviadasSemPronta(l.fotos_novas);
      t = { tipo: foto ? 'aplicacao_foto' : 'aplicacao_item', id: l.id, fase: l.fase, tentativa: 0, despacho_seq: l.despacho_seq,
        acao: foto ? 'consultar_foto' : 'passo', userId: l.user_id, aplicacaoId: l.aplicacao_id };
    } else if (l.fonte === 'aplicacao') {
      const acao = acaoDaAplicacao(l, agora);
      if (acao && cabe('aplicacao')) t = { tipo: 'aplicacao', id: l.id, fase: 0, tentativa: 0, despacho_seq: 0, acao };
    }
    if (t) { vistos.add(l.id); saida.push(t); }
  }
  return saida;
}

export interface DepsDespacho {
  agora: Date;
  /** SUPABASE_URL */
  base: string;
  /** `qstashClient().batchJSON`: um elemento por mensagem; só o que traz `messageId` foi aceito. */
  publicar(msgs: MensagemQStash[]): Promise<Array<{ messageId?: string; error?: string }>>;
  garantirFila(userId: string): Promise<void>;
  /** `enfileirarJobPublicacaoML` (queue.ts): fila `publish-ml-${userId}` com as mesmas opções de retry do job normal. */
  enfileirar(userId: string, url: string, body: unknown): Promise<unknown>;
}

function mensagem(t: Trabalho, base: string): MensagemQStash {
  const body = { tipo: t.tipo, id: t.id, fase: t.fase, tentativa: t.tentativa, despacho_seq: t.despacho_seq, acao: t.acao };
  const comum = { body, deduplicationId: `${t.id}:${t.despacho_seq}` };
  // Submissão paga sem retry do QStash: a idempotência dela é o claim com `tentativa` no banco.
  if (t.tipo === 'imagem') return { ...comum, url: `${base}/functions/v1/galeria-worker`, retries: t.acao === 'submeter' ? 0 : 3 };
  return { ...comum, url: `${base}/functions/v1/galeria-aplicar-worker`, queueName: `publish-ml-${t.userId}`, retries: 3 };
}

/**
 * Incrementa `despacho_seq` (compare-and-set em `fase` + seq lido; perdeu → não publica), publica tudo num batch e grava
 * `publicado_em` só das aceitas, condicionado a `fase` + seq publicado (se o worker já concluiu a fase, afeta 0 linhas).
 * Usado também pelo `galeria-gerar` (publicação imediata, otimização).
 */
export async function publicarJobs(admin: SupabaseClient, jobs: Trabalho[], deps: DepsDespacho): Promise<number> {
  const tabela = (t: Trabalho) => (t.tipo === 'imagem' ? 'galeria_imagens' : 'galeria_aplicacao_itens');
  const filasOk = new Set<string>();
  for (const u of new Set(jobs.filter((j) => j.tipo !== 'imagem').map((j) => j.userId))) {
    if (!u) continue;
    try { await deps.garantirFila(u); filasOk.add(u); } catch (e) { console.error('[galeria-despacho] fila', u, (e as Error).message); }
  }
  const candidatos = jobs.filter((j) => j.tipo === 'imagem' || (j.userId && filasOk.has(j.userId)));
  const marcados = (await Promise.all(candidatos.map(async (j) => {
    const seq = j.despacho_seq + 1;
    const { data, error } = await admin.from(tabela(j)).update({ despacho_seq: seq })
      .eq('id', j.id).eq('fase', j.fase).eq('despacho_seq', j.despacho_seq).select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1 ? { ...j, despacho_seq: seq } : null;
  }))).filter((j): j is Trabalho => j !== null);
  if (marcados.length === 0) return 0;

  let respostas: Array<{ messageId?: string }> = [];
  try { respostas = await deps.publicar(marcados.map((j) => mensagem(j, deps.base))); }
  catch (e) { console.error('[galeria-despacho] batch', (e as Error).message); }
  const aceitos = marcados.filter((_, i) => typeof respostas[i]?.messageId === 'string');
  await Promise.all(aceitos.map(async (j) => {
    const { error } = await admin.from(tabela(j)).update({ publicado_em: deps.agora.toISOString() })
      .eq('id', j.id).eq('fase', j.fase).eq('despacho_seq', j.despacho_seq);
    if (error) throw new Error(error.message);
  }));
  return aceitos.length;
}

/** Puro. Ordem das Global Constraints: família fora de `publicando` = job concluído; 240 min → erro; travado → +60 s. */
export function decidirAdiada(
  a: { adiado_desde: string }, agora: Date, statusFamilia: string | null, travado: boolean,
): 'concluida' | 'erro' | 'reagendar' | 'enfileirar' {
  if (statusFamilia !== 'publicando') return 'concluida';
  if (agora.getTime() - Date.parse(a.adiado_desde) >= TETO_ADIADA_MS) return 'erro';
  return travado ? 'reagendar' : 'enfileirar';
}

export interface Adiada {
  id: string; org_id: string; familia_id: string; lote_id: string; endpoint: string; itens: string[];
  job: Record<string, unknown>; adiado_desde: string; proxima_em: string;
}

/** Faz o mesmo que a mensagem de acordar: perder a mensagem só atrasa ≤1 min. Nunca escreve no ML. */
export async function processarAdiada(admin: SupabaseClient, a: Adiada, deps: DepsDespacho): Promise<void> {
  const [{ data: fam, error: eF }, { data: travas, error: eT }] = await Promise.all([
    admin.from('familias').select('status, user_id').eq('id', a.familia_id).maybeSingle(),
    admin.from('ml_item_travas').select('dono_tipo, expira_em').eq('org_id', a.org_id).in('item_id', a.itens),
  ]);
  if (eF || eT) throw new Error((eF ?? eT)!.message);
  const travado = (travas ?? []).some((t: { dono_tipo: string; expira_em: string | null }) =>
    t.dono_tipo === 'galeria' || (t.expira_em != null && Date.parse(t.expira_em) > deps.agora.getTime()));
  const decisao = decidirAdiada(a, deps.agora, fam?.status ?? null, travado);
  // Claim da rodada (compare-and-set em proxima_em): outro despachante simultâneo perde e não repete o efeito.
  const proxima = new Date(deps.agora.getTime() + (decisao === 'reagendar' ? 60_000 : 5 * 60_000)).toISOString();
  const { data: claim, error: eC } = await admin.from('ml_escritas_adiadas').update({ proxima_em: proxima })
    .eq('id', a.id).eq('proxima_em', a.proxima_em).select('id');
  if (eC) throw new Error(eC.message);
  if ((claim ?? []).length !== 1 || decisao === 'reagendar') return;
  if (decisao === 'enfileirar') {
    await deps.enfileirar(fam!.user_id, `${deps.base}/functions/v1/${a.endpoint}`, { ...a.job, adiada_id: a.id });
    return;
  }
  if (decisao === 'erro') {
    // Nunca sobrescreve sucesso; fora do catch genérico do worker (não toca em variacoes).
    const { error } = await admin.from('familias').update({ status: 'erro', erro_mensagem: 'item_reservado_galeria' })
      .eq('id', a.familia_id).eq('status', 'publicando');
    if (error) throw new Error(error.message);
  }
  await talvezFinalizarLote(admin, a.lote_id);
  const { error } = await admin.from('ml_escritas_adiadas').delete().eq('id', a.id).eq('proxima_em', proxima);
  if (error) throw new Error(error.message);
}

async function rpcLista<T>(admin: SupabaseClient, nome: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await admin.rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return (data ?? []) as T[];
}

export async function despachar(admin: SupabaseClient, deps: DepsDespacho) {
  const [imagens, visao, aplicacao, adiadas] = await Promise.all([
    rpcLista<LinhaImagem>(admin, 'galeria_trabalho_pendente', { p_limite: LIMITES.imagens }),
    rpcLista<LinhaImagem>(admin, 'galeria_visao_pendente', { p_limite: LIMITES.visao }),
    rpcLista<LinhaItem | LinhaAplicacao>(admin, 'galeria_trabalho_pendente_aplicacao', { p_limite: LIMITES.aplicacao }),
    rpcLista<Adiada>(admin, 'galeria_escritas_adiadas_pendentes', { p_limite: 20 }),
  ]);
  const linhas: LinhaDespacho[] = [
    ...aplicacao.map((l) => ({ ...l, fonte: l.tipo }) as LinhaDespacho),
    ...imagens.map((l) => ({ ...l, fonte: 'imagem' as const })),
    ...visao.map((l) => ({ ...l, fonte: 'visao' as const })),
  ];
  const trabalho = selecionarTrabalho(linhas, deps.agora, LIMITES);

  // Ações de nível da aplicação: no banco, sob lock da aplicação (abortar por prazo, compensar aplicados, agregar).
  const mantidas = new Set<string>();
  for (const t of trabalho.filter((x) => x.tipo === 'aplicacao')) {
    mantidas.add(t.id);
    const { error } = await admin.rpc('galeria_manter_aplicacao', { p_aplicacao: t.id });
    if (error) console.error('[galeria-despacho] manter', t.id, error.message);
  }
  // A ação pode ter mudado os itens (ex.: aborto marca pendente → pulado): item dessa aplicação espera o próximo tick,
  // quando a consulta já o traz (ou não) pelo estado novo.
  const publicados = await publicarJobs(admin,
    trabalho.filter((x) => x.tipo !== 'aplicacao' && !(x.aplicacaoId && mantidas.has(x.aplicacaoId))), deps);

  let adiadasOk = 0;
  for (const a of adiadas) {
    try { await processarAdiada(admin, a, deps); adiadasOk++; }
    catch (e) { console.error('[galeria-despacho] adiada', a.id, (e as Error).message); }
  }
  return { trabalho: trabalho.length, publicados, adiadas: adiadasOk };
}
