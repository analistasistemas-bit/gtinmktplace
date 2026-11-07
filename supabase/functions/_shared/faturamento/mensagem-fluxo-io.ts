// Deps reais do envio de mensagem por pack: `ml_posvenda_acoes` via service_role e ML. Usadas pela edge
// `responder-mensagem`. A máquina de estados fica em mensagem-fluxo.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { enviarMsgML } from '../ml/mensagem.ts';
import { mapearMensagem, type MensagemML } from './mensagem-mapper.ts';
import { lerPackSemMarcarLido, mensagemErroEnvioML } from './mensagens-io.ts';
import type { DepsMensagem, MsgConversa, TentativaMensagem } from './mensagem-fluxo.ts';

const T = 'ml_posvenda_acoes';

export interface CtxMensagem { orgId: string; packId: string; sellerId: string; buyerId: string; token: string }

// `linha()` de posvenda-acao-io.ts não serve: converte claim_id nulo em 0.
const linha = (r: unknown) => r as TentativaMensagem;

function paraConversa(m: MensagemML, sellerId: string): MsgConversa {
  const { message_id, direcao, texto } = mapearMensagem(m, sellerId);
  const { message_attachments, message_moderation } = m as {
    message_attachments?: Array<{ filename?: unknown }> | null;
    message_moderation?: { status?: unknown } | null;
  };
  const moderacao = message_moderation?.status;
  return {
    id: message_id, deVendedor: direcao === 'enviada', texto,
    anexos: (message_attachments ?? []).map((a) => String(a.filename)),
    moderacao: moderacao == null ? null : String(moderacao),
  };
}

export function depsMensagemReal(admin: SupabaseClient, ctx: CtxMensagem): DepsMensagem {
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
      // Sem `.select` o PostgREST não diz quantas linhas casaram; 0 linhas = outra execução ganhou.
      const { data, error } = await q.select('*');
      if (error) throw falhou('atualizar', error);
      return data?.length === 1 ? linha(data[0]) : null;
    },

    async lerConversa() {
      const msgs = await lerPackSemMarcarLido(ctx.token, ctx.packId, ctx.sellerId);
      return msgs.map((m) => paraConversa(m, ctx.sellerId));
    },

    async postML(p) {
      try {
        const resp = await enviarMsgML(ctx.token, ctx.packId, ctx.sellerId, ctx.buyerId, p.texto, p.anexo);
        const texto = await resp.text().catch(() => '');
        let body: unknown = null;
        try { body = texto ? JSON.parse(texto) : null; } catch { body = { texto: texto.slice(0, 2000) }; }
        return { status: resp.status, body };
      } catch {
        return { status: null, body: null }; // timeout/rede: não se sabe se o ML recebeu.
      }
    },

    erroRecusa: (status, body) => mensagemErroEnvioML(status, JSON.stringify(body ?? '')),
  };
}
