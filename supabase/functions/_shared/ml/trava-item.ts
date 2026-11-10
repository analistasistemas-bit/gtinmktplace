// Trava de escrita por MLB dos escritores comuns (ADR-0201, Global Constraints "Trava de escrita por MLB").
// `update-familia-ml` e `publicar-split-ml` travam (`ml_travar_itens`, tipo `escritor`, TTL 600 s) TODOS os itens que
// vão escrever ANTES do GET em que baseiam o PUT; o gancho `antesDoPut` do conector estende a trava por 900 s
// imediatamente antes de cada PUT; a trava só é solta com resposta definitiva do ML (2xx/4xx). Conflito → o job não faz
// GET nem PUT: grava o adiamento durável em `ml_escritas_adiadas` e agenda um "acordar" fora da fila serial.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decidirAdiada, processarAdiada, type Adiada, type DepsDespacho } from '../galeria/despacho.ts';
import { idDerivado } from '../galeria/pedido.ts';

export const TTL_TRAVA_S = 600;
export const QUARENTENA_PUT_S = 900;
const ASSUMIDA_MS = 10 * 60_000;
const REAGENDAR_MS = 60_000;

/**
 * Dono estável da trava `escritor` por job (família + lote + endpoint): o retry do QStash do mesmo job (ex.: 5xx no
 * PUT) reencontra a própria trava e segue, em vez de se adiar contra ela. É também o `trava_dono` da linha adiada.
 */
export const donoEscritor = (endpoint: string, familiaId: string, loteId: string) =>
  idDerivado(familiaId, `escritor:${endpoint}:${loteId}`, 0, 0);

export async function travarItens(admin: SupabaseClient, orgId: string, itens: string[], dono: string): Promise<boolean> {
  const { data, error } = await admin.rpc('ml_travar_itens',
    { p_org: orgId, p_itens: itens, p_tipo: 'escritor', p_dono: dono, p_ttl_seg: TTL_TRAVA_S });
  if (error) throw new Error(`ml_travar_itens: ${error.message}`);
  return data === true;
}

/** Antes de cada PUT. Falha de gravação = false (o PUT não sai). */
export async function estenderTrava(admin: SupabaseClient, orgId: string, itens: string[], dono: string): Promise<boolean> {
  const { data, error } = await admin.rpc('ml_estender_trava', { p_org: orgId, p_itens: itens, p_dono: dono, p_seg: QUARENTENA_PUT_S });
  return !error && data === true;
}

/** Só com resposta definitiva do ML. Falha aqui não muda nada: a trava vence sozinha. */
export async function soltarItens(admin: SupabaseClient, orgId: string, dono: string): Promise<void> {
  const { error } = await admin.rpc('ml_soltar_itens', { p_org: orgId, p_dono: dono });
  if (error) console.error('[trava-item] soltar', error.message);
}

/** Mensagem de acordar: `publishJSON` SEM fila (o `queue.ts` não combina fila com delay). */
export async function agendarAcordar(endpoint: string, job: Record<string, unknown>, delaySeg = 60): Promise<void> {
  // Import tardio: quem só trava/solta (ex.: remover-publicado) não carrega o cliente do QStash.
  const { qstashClient } = await import('../queue.ts');
  await qstashClient().publishJSON({
    url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/${endpoint}`, body: job, delay: delaySeg, retries: 3,
  });
}

/** Puro (acordar com a família ainda `publicando`): teto de 240 min desde `adiado_desde`. */
export function decidirAcordar(a: { adiado_desde: string }, agora: Date, travado: boolean): 'erro' | 'reagendar' | 'enfileirar' {
  return decidirAdiada(a, agora, 'publicando', travado) as 'erro' | 'reagendar' | 'enfileirar';
}

export interface PedidoEscrita {
  orgId: string; familiaId: string; loteId: string; endpoint: string; itens: string[];
  /** Corpo original do job (reenfileirado igual quando o item ficar livre). */
  job: Record<string, unknown>;
  /** Presente quando o job veio de um reenfileiramento (`adiada_id` no corpo). */
  adiadaId?: string;
}
export type Reserva =
  | { tipo: 'livre'; dono: string; posseAdiada: string | null }
  /** Outro job vivo assumiu a linha adiada: responde 200 sem escrever. */
  | { tipo: 'assumida' }
  /** Conflito: adiamento gravado. Responde 200, família continua `publicando`. */
  | { tipo: 'adiada'; adiadaId: string };

export interface DepsReserva { agora?: () => Date; acordar?: typeof agendarAcordar }

/**
 * Claim da linha adiada (quando houver) → trava. Conflito → adia (upsert idempotente; `adiado_desde` nunca muda) e
 * agenda o acordar (otimização: o despachante também lê a tabela). Lança se o adiamento não foi gravado: o chamador
 * devolve 5xx e a mensagem original repete.
 */
export async function reservarEscrita(admin: SupabaseClient, p: PedidoEscrita, deps: DepsReserva = {}): Promise<Reserva> {
  const agora = (deps.agora ?? (() => new Date()))();
  const dono = donoEscritor(p.endpoint, p.familiaId, p.loteId);
  let posse: string | null = null;
  if (p.adiadaId) {
    posse = crypto.randomUUID();
    const { data, error } = await admin.from('ml_escritas_adiadas')
      .update({ posse, assumida_ate: new Date(agora.getTime() + ASSUMIDA_MS).toISOString(), trava_dono: dono })
      .eq('id', p.adiadaId).or(`assumida_ate.is.null,assumida_ate.lt.${agora.toISOString()}`).select('id');
    if (error) throw new Error(`assumir escrita adiada: ${error.message}`);
    if ((data ?? []).length !== 1) return { tipo: 'assumida' };
  }
  if (await travarItens(admin, p.orgId, p.itens, dono)) return { tipo: 'livre', dono, posseAdiada: posse };

  const proxima = new Date(agora.getTime() + REAGENDAR_MS).toISOString();
  let adiadaId = p.adiadaId;
  if (posse) {
    const { error } = await admin.from('ml_escritas_adiadas')
      .update({ proxima_em: proxima, posse: null, assumida_ate: null }).eq('id', p.adiadaId!).eq('posse', posse);
    if (error) throw new Error(`reagendar escrita adiada: ${error.message}`);
  } else {
    const { adiada_id: _, acordar: __, ...job } = p.job;
    const { data, error } = await admin.from('ml_escritas_adiadas').upsert({
      org_id: p.orgId, familia_id: p.familiaId, lote_id: p.loteId, endpoint: p.endpoint, itens: p.itens, job,
      proxima_em: proxima, trava_dono: dono,
    }, { onConflict: 'familia_id,lote_id,endpoint' }).select('id');
    if (error || !data?.[0]) throw new Error(`gravar escrita adiada: ${error?.message ?? 'sem linha'}`);
    adiadaId = (data[0] as { id: string }).id;
  }
  try { await (deps.acordar ?? agendarAcordar)(p.endpoint, { acordar: true, adiada_id: adiadaId }, 60); }
  catch (e) { console.error('[trava-item] acordar', (e as Error).message); }
  return { tipo: 'adiada', adiadaId: adiadaId! };
}

/** Desfecho persistido (ok ou erro + lote finalizado): apaga a linha, só se ainda é minha. */
export async function encerrarEscritaAdiada(admin: SupabaseClient, adiadaId: string, posse: string): Promise<void> {
  const { error } = await admin.from('ml_escritas_adiadas').delete().eq('id', adiadaId).eq('posse', posse);
  if (error) console.error('[trava-item] encerrar adiada', error.message);
}

/** Retry do QStash (5xx): devolve a linha para a próxima entrega poder assumi-la de novo. */
export async function devolverEscritaAdiada(admin: SupabaseClient, adiadaId: string, posse: string): Promise<void> {
  const { error } = await admin.from('ml_escritas_adiadas').update({ posse: null, assumida_ate: null })
    .eq('id', adiadaId).eq('posse', posse);
  if (error) console.error('[trava-item] devolver adiada', error.message);
}

/** Mensagem de acordar: o mesmo que o despachante faz com a linha (nunca escreve no ML). */
export async function acordarEscritaAdiada(admin: SupabaseClient, adiadaId: string, deps: DepsDespacho): Promise<void> {
  const { data, error } = await admin.from('ml_escritas_adiadas').select('*').eq('id', adiadaId)
    .or(`assumida_ate.is.null,assumida_ate.lt.${deps.agora.toISOString()}`).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;   // já concluída/apagada ou assumida por um job vivo
  await processarAdiada(admin, data as Adiada, deps);
}

/**
 * Controle da trava ao longo de um job: `antesDoPut` (gancho do conector) estende e marca que um PUT pode ter
 * saído; `resolver(status)` solta só se nenhum PUT saiu ou a resposta foi definitiva (2xx/4xx). Sem `finally`:
 * PUT sem resposta, timeout ou 5xx mantém a trava (vence em `envio + 900 s`).
 */
export function controleTrava(admin: SupabaseClient, orgId: string, itens: string[], dono: string) {
  let putSaiu = false;
  let solta = false;
  return {
    get putSaiu() { return putSaiu; },
    antesDoPut: async () => {
      const ok = await estenderTrava(admin, orgId, itens, dono);
      if (ok) putSaiu = true;
      return ok;
    },
    /** `status` da última resposta do ML (undefined = sem resposta/timeout ou 2xx implícito via `ok`). */
    async resolver(r: { ok: boolean; status?: number }) {
      if (solta) return;
      const definitivo = r.ok || (r.status != null && r.status < 500);
      if (!putSaiu || definitivo) { solta = true; await soltarItens(admin, orgId, dono); }
    },
    /** Saída por exceção: só solta se nenhum PUT saiu. */
    async abandonar() {
      if (!solta && !putSaiu) { solta = true; await soltarItens(admin, orgId, dono); }
    },
  };
}
