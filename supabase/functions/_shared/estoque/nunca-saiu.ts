// ADR-0121, emenda 8: prova de que o envio cancelado nunca saiu e as leituras que decidem a reposição.
// Testável por vitest: só `import type`. A ligação real fica em cancelamento-deps.ts e nos chamadores.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const API = 'https://api.mercadolibre.com';
const PRAZO_HISTORICO_MS = 8_000;

export type ProvaNuncaSaiu = 'sim' | 'nao' | 'indisponivel';

/** Todas têm de vir no histórico e nulas. `date_shipped` sozinha não serve: é nula até em envio já coletado. */
const DATAS_NULAS = ['date_first_printed', 'date_shipped', 'date_delivered', 'date_not_delivered', 'date_returned'];

/** GET /shipments/{id}/history prova que a etiqueta nunca foi impressa? Qualquer forma diferente não prova. */
export function provaNuncaSaiu(h: unknown, shippingId: number | string): boolean {
  const x = h as { id?: unknown; status?: unknown; substatus?: unknown; mode?: unknown; date_history?: Record<string, unknown> | null } | null | undefined;
  const datas = x?.date_history;
  return String(x?.id) === String(shippingId) && x?.status === 'cancelled' && x.substatus === null && x.mode === 'me2'
    && !!datas && DATAS_NULAS.every((d) => datas[d] === null);
}

/** Nunca lança. `indisponivel` = não deu para saber agora; `nao` = resposta definitiva que não prova. */
export async function lerNuncaSaiu(token: string, shippingId: number | string): Promise<ProvaNuncaSaiu> {
  try {
    const r = await fetch(`${API}/shipments/${shippingId}/history`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(PRAZO_HISTORICO_MS),
    });
    if (!r.ok) {
      const definitivo = r.status >= 400 && r.status < 500 && ![401, 403, 408, 429].includes(r.status);
      return definitivo ? 'nao' : 'indisponivel';
    }
    return provaNuncaSaiu(await r.json(), shippingId) ? 'sim' : 'nao';
  } catch (e) {
    console.warn(`nunca-saiu: histórico do envio ${shippingId} não lido: ${String(e)}`);
    return 'indisponivel';
  }
}

export interface BaixasAbertas {
  /** `codigoRef` só localiza o estorno; `codigo` e `quantidade` são os do movimento (a BASE, no kit vinculado).
   *  `codigo` nulo = a RPC confirmou a baixa, mas o movimento não foi lido. */
  abertas: Array<{ codigoRef: string; codigo: string | null; quantidade: number }>;
  haEstornada: boolean;
}

/** Teto de linhas do PostgREST: chegar nele pode ser resposta truncada, então conta como leitura falha. */
export function conferirTeto(linhas: unknown[], onde: string) {
  if (linhas.length >= 1000) throw new Error(`${onde}: resposta possivelmente truncada`);
}

/** Baixas do pedido no ledger. O filtro do banco é superconjunto (`_` do LIKE); o prefixo exato é conferido aqui. */
async function lerBaixas(admin: SupabaseClient, orgId: string, orderId: string | number) {
  const prefixo = `mercado_livre:${orderId}:`;
  const { data, error } = await admin.from('estoque_movimentos').select('codigo, quantidade, criado_em, referencia_externa')
    .eq('org_id', orgId).eq('motivo', 'venda').lt('quantidade', 0).like('referencia_externa', `${prefixo}%`);
  if (error) throw new Error(`estoque_movimentos: ${error.message}`);
  conferirTeto(data ?? [], 'estoque_movimentos');
  return ((data ?? []) as Array<{ codigo: string; quantidade: number; criado_em: string; referencia_externa: string }>)
    .filter((m) => m.referencia_externa.startsWith(prefixo))
    .map((m) => ({ ...m, codigoRef: m.referencia_externa.slice(prefixo.length) }));
}

/** Baixas sem estorno efetivo, pela mesma RPC da fila do ADR-0211. Lança se a RPC falhar; a falha só do movimento
 *  (que dá o código para o texto) não desfaz a baixa que a RPC confirmou. */
export async function baixasAbertas(admin: SupabaseClient, orgId: string, orderId: string | number): Promise<BaixasAbertas> {
  const { data, error } = await admin.rpc('cancelamento_baixas', { p_org: orgId, p_orders: [String(orderId)] });
  if (error) throw new Error(`cancelamento_baixas: ${error.message}`);
  conferirTeto(data ?? [], 'cancelamento_baixas');
  // codigo_ref nulo = pedido sem baixa.
  const linhas = ((data ?? []) as Array<{ codigo_ref: string | null; quantidade: number; estornada: boolean }>).filter((l) => l.codigo_ref != null);
  const abertas = linhas.filter((l) => !l.estornada);
  const movs = abertas.length === 0 ? [] : await lerBaixas(admin, orgId, orderId).catch((e) => {
    console.warn(`nunca-saiu: movimentos do pedido ${orderId} não lidos: ${String(e)}`);
    return [];
  });
  return {
    haEstornada: linhas.some((l) => l.estornada),
    abertas: abertas.map((l) => ({
      codigoRef: l.codigo_ref!, codigo: movs.find((m) => m.codigoRef === l.codigo_ref)?.codigo ?? null, quantidade: Number(l.quantidade),
    })),
  };
}

/**
 * Alguém mexeu no saldo de um SKU do pedido depois da baixa: `entrada`/`ajuste`, ou linha nova de `variacoes` (a
 * planilha grava saldo absoluto sem movimento). Olha `codigo` do movimento, o saldo de fato debitado. Lança em erro.
 */
export async function saldoMexidoDepois(admin: SupabaseClient, orgId: string, orderId: string | number): Promise<boolean> {
  const baixas = await lerBaixas(admin, orgId, orderId);
  if (baixas.length === 0) throw new Error(`nenhuma baixa do pedido ${orderId} lida no ledger`);
  const achou = await Promise.all(baixas.flatMap((b) => [
    admin.from('estoque_movimentos').select('codigo').eq('org_id', orgId).in('motivo', ['entrada', 'ajuste'])
      .eq('codigo', b.codigo).gt('criado_em', b.criado_em).limit(1),
    admin.from('variacoes').select('codigo').eq('org_id', orgId).eq('codigo', b.codigo).gt('criado_em', b.criado_em).limit(1),
  ]));
  // Erro em qualquer leitura vence um achado: só depois de ler tudo.
  for (const { error } of achou) if (error) throw new Error(`saldo depois da baixa: ${error.message}`);
  return achou.some(({ data }) => (data ?? []).length > 0);
}

/** O aviso já foi reservado? Lê sem reservar. Lança em erro. */
export async function notificacaoJaEnviada(admin: SupabaseClient, orgId: string, entidade: string, chave: string): Promise<boolean> {
  const { data, error } = await admin.from('ml_notificacoes_enviadas').select('chave')
    .eq('org_id', orgId).eq('entidade', entidade).eq('chave', chave).limit(1);
  if (error) throw new Error(`ml_notificacoes_enviadas: ${error.message}`);
  return (data ?? []).length > 0;
}

/** `1` = todas as orgs; lista de ids separada por vírgula = só essas; ausente = desligada. */
export function drenagemLigada(valor: string | undefined, orgId: string): boolean {
  const v = (valor ?? '').trim();
  if (!v) return false;
  if (v === '1') return true;
  return v.split(',').map((s) => s.trim()).includes(orgId);
}

/**
 * A fila do ADR-0211 vai tratar este pedido? Obrigação armada e pendente, e as condições em que ela drena: flags,
 * org ativa e conexão com conta e dono na mesma linha. Na dúvida, não. Lança em erro de leitura.
 */
export async function filaAssume(
  admin: SupabaseClient, orgId: string, orderId: string | number, env: { drenar: string | undefined; fanout: boolean },
): Promise<boolean> {
  if (!drenagemLigada(env.drenar, orgId) || !env.fanout) return false;
  const rs = await Promise.all([
    admin.from('ml_vendas').select('id').eq('org_id', orgId).eq('order_id', orderId)
      .not('cancelamento_geracao', 'is', null).is('cancelamento_concluido_em', null).limit(1),
    admin.from('organizations').select('id').eq('id', orgId).is('arquivada_em', null).limit(1),
    admin.from('marketplace_connections').select('id').eq('org_id', orgId).eq('canal', 'mercado_livre')
      .not('conta_externa_id', 'is', null).neq('conta_externa_id', '').not('criado_por', 'is', null).limit(1),
  ]);
  for (const { error } of rs) if (error) throw new Error(`fila de cancelamento: ${error.message}`);
  return rs.every(({ data }) => (data ?? []).length > 0);
}
