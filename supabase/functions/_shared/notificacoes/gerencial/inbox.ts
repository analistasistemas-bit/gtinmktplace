// Inbox durável do bot (ADR-0190 D-8/D-9): o webhook grava o update (PK bot+update = dedup) e
// publica um job QStash; o worker reivindica com lease (RPCs da migration telegram_bot_inbox, CAS
// por `lease_id`) e só a execução dona da posse responde. A varredura só republica.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../../queue.ts';
import { enfileirarEmBlocos } from '../../enfileirar-em-blocos.ts';

const TABELA = 'telegram_updates';
const LOTE_VARREDURA = 200;

export interface Row {
  bot_id: number; update_id: number; org_id: string; payload: Record<string, unknown>;
  status: 'recebido' | 'processando' | 'respondido' | 'falhou'; tentativas: number;
  lease_ate: string | null; lease_id: string | null;
}
export interface Pk { botId: number; updateId: number }

const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`;
const job = (botId: number, updateId: number, tentativas: number) => ({
  url: urlWorker(), body: { bot_id: botId, update_id: updateId }, retries: 3,
  deduplicationId: `tg-${botId}-${updateId}-${tentativas}`,
});

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Grava o update (on conflict do nothing). Duplicata: recebido/processando → 'pendente' (o webhook
 *  publica de novo: recupera "insert ok, publish falhou"); respondido/falhou → 'concluida'. */
export async function receberUpdate(
  admin: SupabaseClient, orgId: string, botId: number, update: { update_id: number },
): Promise<'nova' | 'pendente' | 'concluida'> {
  const { data, error } = await admin.from(TABELA)
    .upsert({ bot_id: botId, update_id: update.update_id, org_id: orgId, payload: update },
      { onConflict: 'bot_id,update_id', ignoreDuplicates: true })
    .select('update_id');
  if (error) throw new Error(`gravar update: ${error.message}`);
  if (data?.length) return 'nova';
  const { data: atual, error: errLer } = await admin.from(TABELA).select('status')
    .eq('bot_id', botId).eq('update_id', update.update_id).maybeSingle();
  if (errLer) throw new Error(`ler update: ${errLer.message}`);
  return atual?.status === 'respondido' || atual?.status === 'falhou' ? 'concluida' : 'pendente';
}

/** Grava `publicado_em` (devolvendo `tentativas` para o dedup) e publica o job. Lança em falha.
 *  ponytail: `publicado_em` antes do publish — se o publish falhar, a varredura retoma em 90 s. */
export async function publicarUpdate(admin: SupabaseClient, botId: number, updateId: number): Promise<void> {
  const { data, error } = await admin.from(TABELA).update({ publicado_em: new Date().toISOString() })
    .eq('bot_id', botId).eq('update_id', updateId).select('tentativas');
  if (error) throw new Error(`marcar publicado: ${error.message}`);
  if (!data?.length) throw new Error(`update ${botId}/${updateId} não encontrado`);
  await qstashClient().publishJSON(job(botId, updateId, Number(data[0].tentativas)));
}

/** Posse por 60 s. null = outra execução tem a posse (ou já concluído). */
export async function reivindicar(
  admin: SupabaseClient, botId: number, updateId: number, agora: Date,
): Promise<{ row: Row; leaseId: string } | null> {
  const linhas = await rpc<Row[]>(admin, 'telegram_update_reivindicar', { p_bot: botId, p_update: updateId, p_agora: agora.toISOString() });
  const row = linhas?.[0];
  return row ? { row, leaseId: row.lease_id! } : null;
}

/** Imediatamente antes de enviar: renova o lease; false = posse perdida, abortar sem enviar. */
export function confirmarPosse(admin: SupabaseClient, pk: Pk, leaseId: string, agora: Date): Promise<boolean> {
  return rpc<boolean>(admin, 'telegram_update_confirmar_posse',
    { p_bot: pk.botId, p_update: pk.updateId, p_lease: leaseId, p_agora: agora.toISOString() });
}

export function concluir(
  admin: SupabaseClient, pk: Pk, leaseId: string, status: 'respondido' | 'falhou', erro?: string,
): Promise<boolean> {
  return rpc<boolean>(admin, 'telegram_update_concluir',
    { p_bot: pk.botId, p_update: pk.updateId, p_lease: leaseId, p_status: status, p_erro: erro ?? null });
}

/** Volta para `recebido` (nova tentativa); com 5 tentativas vira `falhou`. CAS: execução vencida → false. */
export function devolver(admin: SupabaseClient, pk: Pk, leaseId: string, erro: string): Promise<boolean> {
  return rpc<boolean>(admin, 'telegram_update_devolver', { p_bot: pk.botId, p_update: pk.updateId, p_lease: leaseId, p_erro: erro });
}

/** Rede de segurança: `recebido` sem publicação há > 90 s ou `processando` com lease vencido ganham o
 *  job de novo. Lote de 200 por cursor (bot_id, update_id); lote cheio publica a continuação. */
export async function varrerInbox(admin: SupabaseClient, agora: Date, depois?: Pk): Promise<number> {
  const linhas = await rpc<Array<{ bot_id: number; update_id: number; tentativas: number }>>(admin, 'telegram_updates_parados', {
    p_agora: agora.toISOString(), p_depois_bot: depois?.botId ?? null, p_depois_update: depois?.updateId ?? null, p_limite: LOTE_VARREDURA,
  }) ?? [];
  if (linhas.length === 0) return 0;
  await enfileirarEmBlocos(linhas, (l) => job(l.bot_id, l.update_id, l.tentativas), (msgs) => qstashClient().batchJSON(msgs));
  if (linhas.length === LOTE_VARREDURA) {
    const ultima = linhas[linhas.length - 1];
    await qstashClient().publishJSON({
      url: urlWorker(), body: { varrer: true, depois: { botId: ultima.bot_id, updateId: ultima.update_id } }, retries: 3,
    });
  }
  return linhas.length;
}
