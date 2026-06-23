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
  players?: Array<{ available_actions?: Array<{ action?: string; due_date?: string | null; mandatory?: boolean }> | null }> | null;
}

export interface ReturnML {
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

export function mapearDevolucao(claim: ClaimML, ret?: ReturnML | null): DevolucaoRow {
  const acoes: AcaoPendente[] = [];
  for (const p of claim.players ?? []) {
    for (const a of p?.available_actions ?? []) {
      if (a?.action) acoes.push({ action: a.action, due_date: a.due_date ?? null, mandatory: Boolean(a.mandatory) });
    }
  }
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
  };
}
