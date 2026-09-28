// ADR-0173: fiação real (Supabase RPCs da Task 1 + QStash) do protocolo em rodada.ts.
// Nenhuma decisão aqui — só liga; a semântica de posse/CAS/notificação está testada em rodada.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../queue.ts';
import { dedupMsg, type Abertura, type Acumulado, type DepsRodada, type MsgOrg } from './rodada.ts';

export const fanoutAtivo = (flag: 'FANOUT_BACKFILL' | 'FANOUT_PULSE' | 'FANOUT_RECONCILIAR') => Deno.env.get(flag) === '1';

export const urlDaFuncao = (fn: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/${fn}`;

function falhou(onde: string, error: { message: string } | null) {
  if (error) throw new Error(`${onde}: ${error.message}`);
}

interface LinhaAbertura {
  resultado: Abertura['resultado'];
  lease: string | null;
  estado: string;
  ciclo: string;
  cursor: string | null;
  acumulado: Acumulado;
  params: Record<string, unknown>;
  notificar_pendente: boolean;
}

export function depsRodada(admin: SupabaseClient, fn: string): DepsRodada {
  return {
    async abrir(m: MsgOrg): Promise<Abertura> {
      const { data, error } = await admin.rpc('abrir_execucao', {
        p_job: m.job, p_org: m.org_id, p_ciclo: m.ciclo, p_params: m.params,
      });
      falhou('abrir_execucao', error);
      const row = (data as LinhaAbertura[] | null)?.[0];
      if (!row) throw new Error('abrir_execucao: sem linha');
      return {
        resultado: row.resultado, lease: row.lease, estado: row.estado, ciclo: row.ciclo,
        cursor: row.cursor, acumulado: row.acumulado, params: row.params, notificarPendente: row.notificar_pendente,
      };
    },

    async avancar(m, lease, cursorNovo, acumulado) {
      const { data, error } = await admin.rpc('avancar_execucao', {
        p_job: m.job, p_org: m.org_id, p_lease: lease, p_cursor_novo: cursorNovo, p_acumulado: acumulado,
      });
      falhou('avancar_execucao', error);
      return Boolean(data);
    },

    async concluir(m, lease, estado, erro, acumulado, notificar) {
      const { data, error } = await admin.rpc('concluir_execucao', {
        p_job: m.job, p_org: m.org_id, p_lease: lease, p_estado: estado, p_erro: erro,
        p_acumulado: acumulado, p_notificar: notificar,
      });
      falhou('concluir_execucao', error);
      return Boolean(data);
    },

    async liberar(m, lease, erro) {
      const { error } = await admin.rpc('liberar_execucao', { p_job: m.job, p_org: m.org_id, p_lease: lease, p_erro: erro });
      falhou('liberar_execucao', error);
    },

    async marcarNotificado(m, lease) {
      const { data, error } = await admin.rpc('marcar_notificado', { p_job: m.job, p_org: m.org_id, p_lease: lease });
      falhou('marcar_notificado', error);
      return Boolean(data);
    },

    async publicar(m, cursor) {
      await qstashClient().publishJSON({
        url: urlDaFuncao(fn), body: m, retries: 3, deduplicationId: dedupMsg(fn, m, cursor),
      });
    },
  };
}

/** Dispara o fan-out inicial (1 mensagem por org, cursor='início'). Sequencial: mantém simples e
 *  segue o mesmo padrão de "1 requisição por item" do dedupId — o volume aqui é 1 por org, não por lote. */
export async function publicarDisparo(fn: string, msgs: MsgOrg[]): Promise<number> {
  const erros: string[] = [];
  const url = urlDaFuncao(fn);
  for (const m of msgs) {
    try {
      await qstashClient().publishJSON({ url, body: m, retries: 3, deduplicationId: dedupMsg(fn, m, null) });
    } catch (e) {
      erros.push(`${m.job}:${m.org_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (erros.length) throw new Error(`publicarDisparo: ${erros.length}/${msgs.length} falharam — ${erros.join('; ')}`);
  return msgs.length;
}
