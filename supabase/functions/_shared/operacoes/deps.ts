// ADR-0174 — fiação real do motor de operações em massa (service role). Só ligação, nenhuma decisão: a regra vive
// em decidir.ts / executar.ts / executar-status.ts / validar.ts (vitest). Service role ignora RLS → toda query filtra por org_id.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../queue.ts';
import { buscarItensML, criarGetJson } from '../promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas, type Cx } from '../promocoes/deps.ts';
import { projetarItem } from '../promocoes/sincronizar.ts';
import type { Cadastro } from '../promocoes/cadastro.ts';
import type { Aliquotas, ProjecaoCor, Semaforo } from '../promocoes/tipos.ts';
import { criarClienteML } from './ml.ts';
import { semaforoReal, type LinhaCentral, type SemaforoExato } from './validar.ts';
import type { DepsExecutar, ItemRow, OperacaoRow } from './executar.ts';
import type { DepsLaco } from './laco.ts';
import type { DepsStatus, OperacaoStatusRow } from './executar-status.ts';
import { lerStatusML } from './ml-status.ts';
import { getConnector } from '../canais/registry.ts';
import { motivoMigracaoPxvPorItem } from '../user-products/guard-migracao-pxv.ts';

const ITENS = 'operacoes_massa_itens';
const COLS_ITEM = 'ml_item_id, preco, status, conferencias, semaforo, confirmado_risco, proxima_conferencia, saida_pedida_em';
export const COLS_CENTRAL = 'ml_item_id, status, titulo, preco_min, preco_max, preco_sugerido, preco_promo, preco_avaliado, projecao';
const ENVIANDO_PARADO_MS = 2 * 60_000; // mesmo limite da RPC operacoes_massa_reivindicar

const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };
export const urlOperacoes = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/operacoes-massa`;
/** Ids do QStash só com [A-Za-z0-9_-] (mesmo filtro de promocoes/deps.ts). */
export const dedup = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
const agoraIso = () => new Date().toISOString();
// PostgREST devolve numeric como number, mas não custa garantir.
const numOuNull = (x: unknown) => (x == null ? null : Number(x));

export function linhaCentral(r: Record<string, unknown>): LinhaCentral {
  return {
    ml_item_id: String(r.ml_item_id), status: String(r.status), titulo: (r.titulo as string | null) ?? null,
    preco_min: numOuNull(r.preco_min), preco_max: numOuNull(r.preco_max), preco_sugerido: numOuNull(r.preco_sugerido),
    preco_promo: numOuNull(r.preco_promo), preco_avaliado: numOuNull(r.preco_avaliado),
    projecao: (r.projecao as ProjecaoCor[] | null) ?? [],
  };
}

/**
 * Semáforo com a tarifa EXATA do preço (Ajuste 5): reprojeta o anúncio pelo mesmo caminho do sync (projetarItem +
 * tarifaEm com cache `promo:`), com o preço pedido no lugar do avaliado. Cadastro e alíquotas carregados 1x.
 */
export function criarSemaforoExato(admin: SupabaseClient, cx: Cx): SemaforoExato {
  const get = criarGetJson(cx.token);
  const tarifaEm = criarTarifaEm(cx);
  let base: Promise<[Cadastro, Aliquotas | null]> | null = null;
  return async (l, preco) => {
    base ??= Promise.all([carregarCadastro(admin, cx.orgId), lerAliquotas(admin, cx.orgId)]);
    const [cad, aliq] = await base;
    if (!aliq) return 'indisponivel';
    const ml = (await buscarItensML(get, [l.ml_item_id])).get(l.ml_item_id) ?? null;
    // Convidado com min/max nulos: precoAvaliado = preco_sugerido (o pedido) e não roda o "até quanto".
    const r = await projetarItem({
      ml_item_id: l.ml_item_id, status: 'candidate', preco_original: null, preco_promo: preco, preco_sugerido: preco,
      preco_min: null, preco_max: null, ml_pct: null, vendedor_pct: null, estoque_min: null, estoque_max: null,
    }, ml, cad, aliq, tarifaEm);
    return r.pior_semaforo;
  };
}

/**
 * `chave` = id da mensagem QStash que está sendo processada (`upstash-message-id`, igual nas reentregas):
 * a continuação de uma mensagem tem sempre o mesmo deduplicationId, e mensagens diferentes nunca colidem.
 */
export function depsLaco(admin: SupabaseClient, op: { id: string; org_id: string }, chave: string): DepsLaco {
  const linhas = (data: unknown): ItemRow[] => ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ ...(r as unknown as ItemRow), preco: numOuNull(r.preco) }));
  const publicar = async (etapa: 'executar' | 'conferir', delay?: number) => {
    await qstashClient().publishJSON({
      url: urlOperacoes(), body: { etapa, operacao_id: op.id }, retries: 3,
      ...(delay ? { delay } : {}), deduplicationId: dedup(`${etapa}_${op.id}_${chave}`),
    });
  };

  return {
    agora: () => Date.now(),

    async reivindicar(operacaoId, mlItemId) {
      const { data, error } = await admin.rpc('operacoes_massa_reivindicar', { p_org: op.org_id, p_operacao: operacaoId, p_ml_item: mlItemId });
      falhou('reivindicar', error);
      return data === true;
    },

    async itensPendentes(_operacaoId, limite) {
      const parado = new Date(Date.now() - ENVIANDO_PARADO_MS).toISOString();
      const { data, error } = await admin.from(ITENS).select(COLS_ITEM).eq('org_id', op.org_id).eq('operacao_id', op.id)
        .or(`status.eq.pendente,and(status.eq.enviando,atualizado_em.lt.${parado})`)
        .order('ml_item_id').limit(limite);
      falhou('itensPendentes', error);
      return linhas(data);
    },

    async temEnviando() {
      const { count, error } = await admin.from(ITENS).select('ml_item_id', { count: 'exact', head: true }).eq('org_id', op.org_id).eq('operacao_id', op.id)
        .eq('status', 'enviando');
      falhou('temEnviando', error);
      return (count ?? 0) > 0;
    },

    async itensAConferir() {
      const { data, error } = await admin.from(ITENS).select(COLS_ITEM).eq('org_id', op.org_id).eq('operacao_id', op.id)
        .eq('status', 'saida_solicitada').not('proxima_conferencia', 'is', null).order('ml_item_id');
      falhou('itensAConferir', error);
      return linhas(data);
    },

    async gravarItem(_operacaoId, mlItemId, campos) {
      const { error } = await admin.from(ITENS).update({ ...campos, atualizado_em: agoraIso() }).eq('org_id', op.org_id).eq('operacao_id', op.id).eq('ml_item_id', mlItemId);
      falhou('gravarItem', error);
    },

    continuar: (delaySeg) => publicar('executar', delaySeg),
    agendarConferencia: (delaySeg) => publicar('conferir', delaySeg),

    async concluir() {
      const { error } = await admin.from('operacoes_massa').update({ status: 'concluida', concluido_em: agoraIso() })
        .eq('org_id', op.org_id).eq('id', op.id);
      falhou('concluir', error);
    },
  };
}

export function depsExecutar(admin: SupabaseClient, cx: Cx, op: OperacaoRow, chave: string): DepsExecutar {
  const semaforoExato = criarSemaforoExato(admin, cx);
  return {
    ...depsLaco(admin, op, chave),
    ml: criarClienteML(cx.token),

    async semaforoAtual(promocaoId, mlItemId, preco): Promise<Semaforo | null> {
      const { data, error } = await admin.from('ml_promocao_itens').select(COLS_CENTRAL)
        .eq('org_id', op.org_id).eq('promocao_id', promocaoId).eq('ml_item_id', mlItemId).maybeSingle();
      falhou('semaforoAtual', error);
      return data ? semaforoReal(linhaCentral(data), preco, semaforoExato) : null;
    },

    async espelharStatusCentral(promocaoId, tipo, mlItemId, espelho) {
      const tab = admin.from('ml_promocao_itens');
      // DEAL: saiu volta a convidado; SMART: o item some da campanha (o sync também o apagaria).
      const q = espelho === 'saiu' && tipo === 'SMART'
        ? tab.delete()
        : tab.update({ status: espelho === 'saiu' ? 'candidate' : espelho });
      const { error } = await q.eq('org_id', op.org_id).eq('promocao_id', promocaoId).eq('ml_item_id', mlItemId);
      falhou('espelharStatusCentral', error);
    },
  };
}

/** Pausar/reativar: leitura e escrita pelo conector ML (ADR-0060), token da conexão da org. */
export function depsStatus(admin: SupabaseClient, cx: Cx, op: OperacaoStatusRow, chave: string): DepsStatus {
  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => Promise.resolve(cx.token) };
  return {
    ...depsLaco(admin, op, chave),
    lerStatus: (mlItemId) => lerStatusML(cx.token, mlItemId), // 401/403 lança SemAcessoStatusML (fatal)
    migracaoPxv: (mlItemId) => motivoMigracaoPxvPorItem(admin, op.org_id, mlItemId),
    atualizarStatus: (mlItemId, alvo) => conn.atualizarStatus(ctx, mlItemId, alvo),
    async encerrarRestantes(mensagem) {
      const { error } = await admin.from(ITENS).update({ status: 'erro', mensagem, atualizado_em: agoraIso() })
        .eq('org_id', op.org_id).eq('operacao_id', op.id).in('status', ['pendente', 'enviando']);
      falhou('encerrarRestantes', error);
    },
  };
}

/** Quais ids são anúncios da org (mesmas 3 fontes de status-publicados) e quais são Kit Virtual. */
export async function idsDaOrg(admin: SupabaseClient, orgId: string, ids: string[]): Promise<{ daOrg: Set<string>; kits: Set<string> }> {
  const daOrg = new Set<string>();
  const kits = new Set<string>();
  // Blocos de 100: `.in()` com 500 ids (~7 KB) encosta no limite de URL do PostgREST.
  for (let i = 0; i < ids.length; i += 100) {
    const bloco = ids.slice(i, i + 100);
    const [f, e, u, k] = await Promise.all([
      admin.from('familias').select('ml_item_id').eq('org_id', orgId).in('ml_item_id', bloco),
      admin.from('anuncios_externos').select('item_externo_id').eq('org_id', orgId).in('item_externo_id', bloco),
      admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).in('item_externo_id', bloco),
      admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).eq('status', 'publicado').in('ml_item_id', bloco),
    ]);
    for (const [onde, r] of [['familias', f], ['anuncios_externos', e], ['anuncios_externos_itens', u], ['kits_virtuais', k]] as const) falhou(onde, r.error);
    for (const r of f.data ?? []) daOrg.add(String(r.ml_item_id));
    for (const r of e.data ?? []) daOrg.add(String(r.item_externo_id));
    for (const r of u.data ?? []) daOrg.add(String(r.item_externo_id));
    for (const r of k.data ?? []) kits.add(String(r.ml_item_id));
  }
  for (const id of kits) daOrg.add(id); // kit é da org; a recusa vem pelo motivo "Kit Virtual"
  return { daOrg, kits };
}

/** Encerra a operação sem executar (módulo desligado, sem conexão, promoção encerrada): nada fica em andamento. */
export async function encerrarComErro(admin: SupabaseClient, op: { id: string; org_id: string }, mensagem: string): Promise<void> {
  const itens = await admin.from(ITENS).update({ status: 'erro', mensagem, proxima_conferencia: null, atualizado_em: agoraIso() })
    .eq('org_id', op.org_id).eq('operacao_id', op.id).in('status', ['pendente', 'enviando', 'saida_solicitada']);
  falhou('encerrarComErro', itens.error);
  const r = await admin.from('operacoes_massa').update({ status: 'concluida', concluido_em: agoraIso() })
    .eq('org_id', op.org_id).eq('id', op.id);
  falhou('encerrarComErro.concluir', r.error);
}
