// Mapeamento puro de claims/returns do ML (ADR-0037, post-purchase). Sem Deno/npm — testável.

export interface AcaoPendente { action: string; due_date: string | null; mandatory: boolean }

export interface DevolucaoRow {
  claim_id: number;
  order_id: number | null;
  stage: string | null;
  status: string | null;
  type: string | null;
  reason_id: string | null;
  reason_texto: string | null;
  valor_em_jogo: number | null;
  return_status: string | null;
  return_status_money: string | null;
  acoes_pendentes: AcaoPendente[] | null;
  aberto_em: string | null;
  /** `resolution.date_created` — quando o ML resolveu o claim, que é o mesmo instante do estorno
   *  no MP. O Dashboard usa essa data (não a de abertura) para pôr a devolução no período certo.
   *  Null enquanto o claim está aberto. */
  fechado_em: string | null;
  // Colunas do pós-venda (ADR-0192). Opcionais: `mapearDevolucao` NÃO as preenche — quem as grava é
  // `colunasLidas`, só quando a leitura correspondente deu certo (falha não apaga coluna preenchida).
  return_id?: number | null;
  detalhe?: DetalheClaimML | null;
  prazo?: string | null;
  vez_de?: 'vendedor' | 'comprador' | 'ml' | null;
  revisao_pendente?: boolean;
  revisao_status?: string | null;
  afeta_reputacao?: string | null;
  rastreio?: string | null;
  pedidos_devolucao?: number[] | null;
  enriquecido_em?: string | null;
}

/** Recorte de /post-purchase/v1/claims/{id}/detail. */
export interface DetalheClaimML {
  due_date?: string | null;
  action_responsible?: string | null;
  title?: string | null;
  [k: string]: unknown;
}

/** Recorte de /post-purchase/v1/claims/{id}. */
export interface ClaimML {
  id?: number | string;
  type?: string | null;
  stage?: string | null;
  status?: string | null;
  reason_id?: string | null;
  resource?: string | null;
  resource_id?: number | string | null;
  date_created?: string | null;
  resolution?: { reason?: string | null; date_created?: string | null; closed_by?: string | null } | null;
  players?: Array<{
    role?: string | null;
    /** `buyer`/`seller` dizem o lado comercial; `sender`/`receiver` são logísticos e SE INVERTEM
     *  na devolução (o vendedor recebe o produto de volta), então não servem para decidir de quem
     *  é a venda; `internal` é o próprio ML. */
    type?: string | null;
    user_id?: number | string | null;
    available_actions?: Array<{ action?: string; due_date?: string | null; mandatory?: boolean }> | null;
  }> | null;
}

/**
 * O claim é sobre uma COMPRA da empresa (a conta é o comprador), e não sobre uma venda dela?
 *
 * O ML devolve nos claims da conta tanto os que ela abriu como compradora quanto os que recebeu
 * como vendedora. Sem separar, a compra vira "devolução de venda" — e o `sync-devolucao`, que
 * reprocessa o pedido do claim pelo pipeline de `upsertVenda`, recria a linha de venda que a
 * limpeza tinha apagado (foi o que reinseriu as 23 compras em 2026-08-13).
 *
 * Decide só com evidência positiva: sem `buyer`/`seller` nos players — 60% dos claims reais —
 * responde `false`, preservando o comportamento anterior em vez de descartar devolução legítima.
 */
export function ehClaimDeCompra(
  claim: Pick<ClaimML, 'players'>, contaExternaId: string | null | undefined,
): boolean {
  if (!contaExternaId) return false;
  const conta = String(contaExternaId);
  const meus = (claim.players ?? []).filter((p) => p?.user_id != null && String(p.user_id) === conta);
  if (meus.some((p) => p.type === 'seller')) return false;
  return meus.some((p) => p.type === 'buyer');
}

export interface ReturnML {
  id?: number | null;
  /** Código de rastreio da devolução. */
  tracking?: string | null;
  /** `orders[].order_id` do return (carrinho: vários). */
  pedidos?: number[];
  status?: string | null;
  status_money?: string | null;
  subtype?: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Tradução amigável por prefixo do reason_id (família PNR/PDD etc.).
const REASON_PREFIXO: Array<[RegExp, string]> = [
  [/^PNR/i, 'Produto não recebido'],
  [/^PDD/i, 'Produto com defeito ou diferente'],
  [/^PMD/i, 'Produto com defeito'],
  [/^CANCEL/i, 'Cancelamento'],
];

export function traduzirReason(reasonId: string | null | undefined): string | null {
  if (!reasonId) return null;
  for (const [re, label] of REASON_PREFIXO) if (re.test(reasonId)) return label;
  return reasonId;
}

type Player = NonNullable<ClaimML['players']>[number];

const acoesDe = (players: Array<Player | null | undefined>): AcaoPendente[] => {
  const acoes: AcaoPendente[] = [];
  for (const p of players) {
    for (const a of p?.available_actions ?? []) {
      if (a?.action) acoes.push({ action: a.action, due_date: a.due_date ?? null, mandatory: Boolean(a.mandatory) });
    }
  }
  return acoes;
};

/** Player cujo `user_id` é a conta conectada. Não presume `type='seller'`: em claims de
 *  `shipment` a conta aparece como `sender`/`receiver`. */
export function playerDaConta(claim: ClaimML, contaExternaId: string): Player | null {
  return (claim.players ?? []).find((p) => p?.user_id != null && String(p.user_id) === String(contaExternaId)) ?? null;
}

/** Ações liberadas PARA A CONTA (e não as de todos os players). */
export function acoesDaConta(claim: ClaimML, contaExternaId: string): AcaoPendente[] {
  const p = playerDaConta(claim, contaExternaId);
  return p ? acoesDe([p]) : [];
}

/** De quem é a vez, a partir de `detail.action_responsible` e do papel (`role`) da conta. */
export function vezDe(
  responsavel: string | null | undefined, papelDaConta: string | null | undefined,
): 'vendedor' | 'comprador' | 'ml' | null {
  if (!responsavel) return null;
  if (papelDaConta && responsavel === papelDaConta) return 'vendedor';
  if (responsavel === 'mediator' || responsavel === 'internal') return 'ml';
  return 'comprador';
}

/** Leitura que pode falhar: distingue "lido e vazio" de "não consegui ler". */
export type Leitura<T> = { ok: true; valor: T } | { ok: false; permanente?: true };
/** Lida (`ok`) ou recusa PERMANENTE do ML em claim encerrado (recurso inexistente p/ a conta). */
const concluida = (l: Leitura<unknown>) => l.ok || l.permanente === true;

export interface RevisaoML { order_id: number; seller_status: string | null }

export interface ExtrasClaim {
  detalhe: Leitura<DetalheClaimML | null>;
  reputacao: Leitura<string | null>;
  /** `'sem_review'` = 404 "return review not found" (lido, sem revisão): decide pelas ações. */
  revisoes: Leitura<RevisaoML[] | 'sem_review'>;
}

/** Envelope `{ reviews: [{ resource, resource_id, resource_reviews: [{ seller_status }] }] }` →
 *  um item por pedido. Vários `resource_reviews`: `pending` se algum for, senão o último. */
export function normalizarRevisoes(resp: unknown): RevisaoML[] {
  const reviews = (resp as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews)) return [];
  const out: RevisaoML[] = [];
  for (const r of reviews as Array<Record<string, unknown> | null>) {
    if (!r || (r.resource != null && r.resource !== 'order')) continue;
    const id = num(r.resource_id);
    if (id == null) continue;
    const rr = Array.isArray(r.resource_reviews) ? (r.resource_reviews as Array<{ seller_status?: unknown }>) : [];
    const sts = rr.map((x) => (typeof x?.seller_status === 'string' ? x.seller_status : null));
    out.push({ order_id: id, seller_status: sts.includes('pending') ? 'pending' : (sts[sts.length - 1] ?? null) });
  }
  return out;
}

/** Revisões lidas com sucesso têm precedência sobre as ações (o ML mantém `return_review_*` em
 *  claims fechados). Sem leitura útil (`'sem_review'` ou falha), decide pelas ações. */
export function revisaoPendente(acoes: AcaoPendente[], revisoes: Leitura<RevisaoML[] | 'sem_review'>): boolean {
  if (revisoes.ok && revisoes.valor !== 'sem_review') return revisoes.valor.some((r) => r.seller_status === 'pending');
  return acoes.some((a) => a.action.startsWith('return_review'));
}

export function mapearDevolucao(claim: ClaimML, ret?: ReturnML | null, contaExternaId?: string | null): DevolucaoRow {
  // Sem `contaExternaId` (webhook/backfill atuais) mantém o agrupamento de todos os players.
  const acoes = contaExternaId ? acoesDaConta(claim, contaExternaId) : acoesDe(claim.players ?? []);
  const orderId = claim.resource === 'order' ? num(claim.resource_id ?? null) : null;
  return {
    claim_id: Number(claim.id),
    order_id: orderId,
    stage: claim.stage ?? null,
    status: claim.status ?? null,
    type: claim.type ?? null,
    reason_id: claim.reason_id ?? null,
    reason_texto: traduzirReason(claim.reason_id),
    valor_em_jogo: null,
    return_status: ret?.status ?? null,
    return_status_money: ret?.status_money ?? null,
    acoes_pendentes: acoes.length > 0 ? acoes : null,
    aberto_em: claim.date_created ?? null,
    fechado_em: claim.resolution?.date_created ?? null,
  };
}

const COLUNAS_RETURN = ['return_status', 'return_status_money', 'return_id', 'rastreio', 'pedidos_devolucao'] as const;

/** Só as colunas cujas leituras deram `ok`. `enriquecido_em` só quando return + 3 extras deram `ok`. */
export function colunasLidas(
  claim: ClaimML, ret: Leitura<ReturnML | null>, extras: ExtrasClaim, contaExternaId: string,
  agoraIso: string = new Date().toISOString(),
): Partial<DevolucaoRow> {
  const o: Partial<DevolucaoRow> = {};
  if (ret.ok) {
    const r = ret.valor;
    o.return_status = r?.status ?? null;
    o.return_status_money = r?.status_money ?? null;
    o.return_id = r?.id ?? null;
    o.rastreio = r?.tracking ?? null;
    o.pedidos_devolucao = r?.pedidos ?? null;
  }
  if (extras.detalhe.ok) {
    const d = extras.detalhe.valor;
    o.detalhe = d;
    o.prazo = d?.due_date ?? null;
    o.vez_de = vezDe(d?.action_responsible, playerDaConta(claim, contaExternaId)?.role);
  }
  if (extras.reputacao.ok) o.afeta_reputacao = extras.reputacao.valor;
  if (extras.revisoes.ok) {
    const rv = extras.revisoes.valor;
    o.revisao_pendente = revisaoPendente(acoesDaConta(claim, contaExternaId), extras.revisoes);
    o.revisao_status = rv === 'sem_review' ? null
      : rv.some((r) => r.seller_status === 'pending') ? 'pending' : (rv[rv.length - 1]?.seller_status ?? null);
  }
  if ([ret, extras.detalhe, extras.reputacao, extras.revisoes].every(concluida)) o.enriquecido_em = agoraIso;
  return o;
}

/** Linha final do upsert: parte de `base`, tira o que depende do return quando ele não foi lido
 *  (senão `mapearDevolucao(claim, null)` apagaria o valor gravado) e sobrepõe `lidas`. */
export function linhaParaUpsert(base: DevolucaoRow, lidas: Partial<DevolucaoRow>, retOk: boolean): Partial<DevolucaoRow> {
  const o: Partial<DevolucaoRow> = { ...base };
  if (!retOk) for (const c of COLUNAS_RETURN) delete o[c];
  return Object.assign(o, lidas);
}
