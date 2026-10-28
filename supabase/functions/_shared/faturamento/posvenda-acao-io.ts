// Deps reais da máquina de estados de pós-venda (ADR-0192, Task 5): `ml_posvenda_acoes` via
// service_role, POST no ML e re-sync com o dono. Usadas pela edge `posvenda-acao` e pelo
// reconciliar. Não testado por vitest (o fluxo é testado em posvenda-fluxo.test.ts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../queue.ts';
import { lerClaimCompleto, upsertDevolucao } from './devolucoes-io.ts';
import { lerDetalheReclamacao } from './posvenda-io.ts';
import type { DepsAcao, Tentativa } from './posvenda-fluxo.ts';

const API = 'https://api.mercadolibre.com';
const T = 'ml_posvenda_acoes';
const TIMEOUT_POST_MS = 20_000;

export interface CtxAcao {
  orgId: string; connectionId: string; contaExternaId: string;
  /** `marketplace_connections.criado_por`: user_id das linhas de ml_devolucoes (nunca quem clicou). */
  dono: string;
  token: string;
}

const linha = (r: Record<string, unknown>): Tentativa => ({
  ...(r as unknown as Tentativa),
  claim_id: Number(r.claim_id),
  return_id: r.return_id == null ? null : Number(r.return_id),
});

export function depsAcaoReal(admin: SupabaseClient, ctx: CtxAcao): DepsAcao {
  const falhou = (onde: string, e: { message: string }) => new Error(`${T} ${onde}: ${e.message}`);
  return {
    agora: () => new Date().toISOString(),

    async porOperacao(op) {
      const { data, error } = await admin.from(T).select('*').eq('org_id', ctx.orgId).eq('operacao_id', op).maybeSingle();
      if (error) throw falhou('porOperacao', error);
      return data ? linha(data) : null;
    },

    async inserir(n) {
      const { data, error } = await admin.from(T).insert({ ...n, estado: 'reservada' }).select('*').single();
      if (error) {
        if (error.code === '23505' && /operacao_uniq/.test(error.message)) return 'conflito_operacao';
        if (error.code === '23505' && /trava_uniq/.test(error.message)) return 'conflito_recurso';
        throw falhou('inserir', error);
      }
      return linha(data);
    },

    async ativaDoRecurso(recurso) {
      const { data, error } = await admin.from(T).select('*').eq('org_id', ctx.orgId).eq('recurso', recurso)
        .in('estado', ['reservada', 'enviada', 'desconhecido']).maybeSingle();
      if (error) throw falhou('ativaDoRecurso', error);
      return data ? linha(data) : null;
    },

    async atualizar(id, onde, set) {
      let q = admin.from(T).update({ ...set, atualizado_em: new Date().toISOString() })
        .eq('id', id).eq('org_id', ctx.orgId).eq('estado', onde.estado);
      if (onde.postEmNulo) q = q.is('post_em', null);
      if (onde.syncPendente) q = q.eq('sync_pendente', true);
      if (onde.criadoAntesDe) q = q.lt('criado_em', onde.criadoAntesDe);
      // Sem `.select` o PostgREST não diz quantas linhas casaram; 0 linhas = outra execução ganhou.
      const { data, error } = await q.select('*');
      if (error) throw falhou('atualizar', error);
      return data?.length === 1 ? linha(data[0]) : null;
    },

    async abertas({ limite, depoisId, giro }) {
      let q = admin.from(T).select('*').eq('org_id', ctx.orgId)
        .or('estado.in.(reservada,enviada,desconhecido),sync_pendente.eq.true');
      // Fan-out: keyset por id (uuid) — a página seguinte começa depois da última, mesmo travada.
      // Legado (giro): fila por atualizado_em — toda linha relida é tocada e vai para o fim.
      if (!giro && depoisId) q = q.gt('id', depoisId);
      if (giro) q = q.order('atualizado_em', { ascending: true });
      const { data, error } = await q.order('id', { ascending: true }).limit(limite);
      if (error) throw falhou('abertas', error);
      return (data ?? []).map(linha);
    },

    lerDetalhe: (claimId) => lerDetalheReclamacao(ctx.token, String(claimId), ctx.contaExternaId),

    async postML(path, corpo) {
      try {
        const resp = await fetch(`${API}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(TIMEOUT_POST_MS),
        });
        const texto = await resp.text().catch(() => '');
        let body: unknown = null;
        try { body = texto ? JSON.parse(texto) : null; } catch { body = { texto: texto.slice(0, 2000) }; }
        return { status: resp.status, body };
      } catch {
        return { status: null, body: null }; // timeout/rede: não se sabe se o ML recebeu.
      }
    },

    async sincronizar(claimId) {
      const { claim, ret, extras, lidoEm } = await lerClaimCompleto(ctx.token, String(claimId));
      // Estrito: sem ler tudo, não dá baixa no sync_pendente (fica para a próxima rodada).
      if (!ret.ok || !extras.detalhe.ok || !extras.reputacao.ok || !extras.revisoes.ok) {
        throw new Error('releitura incompleta do claim');
      }
      const { linha: dev } = await upsertDevolucao(admin, ctx.dono, ctx.orgId, claim, ret, ctx.contaExternaId, extras, lidoEm);
      await qstashClient().publishJSON({
        url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-devolucao`,
        body: { user_id: ctx.dono, claim_id: String(claimId), org_id: ctx.orgId, connection_id: ctx.connectionId },
        retries: 3,
      });
      return dev ?? null;
    },
  };
}
