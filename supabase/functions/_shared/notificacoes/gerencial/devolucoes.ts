// Devoluções do resumo diário (ADR-0190 D-6): estornado de ontem e reclamações com prazo próximo.
// Mesmos critérios de src/lib/devolucoes.ts (`devolucoesConcluidasNoPeriodo`, `devolucoesAbertas`),
// com janela [desde, ate) e leitura LIMITADA (nunca o histórico inteiro da org).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { lerPaginas, type MetricsDb } from '../../platform-admin/metrics-repository.ts';
import type { JanelaIso } from './janelas.ts';

export interface DevolucaoComEstorno {
  type: string; status: string; return_status_money: string | null; aberto_em: string | null; fechado_em: string | null;
  acoes_pendentes: { action: string; due_date: string | null; mandatory: boolean }[] | null; valor_estornado: number;
}

type Consulta = ReturnType<MetricsDb['from']>;
const LOTE_ORDERS = 200;
const COLUNAS = 'id, order_id, type, status, return_status_money, aberto_em, fechado_em, acoes_pendentes';

/** Σ estornado das devoluções concluídas (`returns` + `refunded`) com `fechado_em ?? aberto_em` em [desde, ate).
 *  Compara por instante (o PostgREST devolve `+00:00`, a janela vem em `-03:00`). */
export function estornadoNoPeriodo(devs: DevolucaoComEstorno[], j: JanelaIso): number {
  const de = Date.parse(j.desde), ate = Date.parse(j.ate);
  return devs.reduce((s, d) => {
    if (d.type !== 'returns' || d.return_status_money !== 'refunded') return s;
    const t = Date.parse(d.fechado_em ?? d.aberto_em ?? '');
    return Number.isFinite(t) && t >= de && t < ate ? s + d.valor_estornado : s;
  }, 0);
}

/** Abertas que pedem ação (critério de `devolucoesAbertas`) com algum prazo ≤ `limiteIso`. */
export function abertasComPrazoAte(devs: DevolucaoComEstorno[], limiteIso: string): number {
  const limite = Date.parse(limiteIso);
  return devs.filter((d) => d.status === 'opened' && (d.acoes_pendentes ?? []).some((a) => {
    const t = Date.parse(a.due_date ?? '');
    return Number.isFinite(t) && t <= limite;
  })).length;
}

async function paginas(build: () => unknown, rotulo: string): Promise<Record<string, unknown>[]> {
  const { rows, error } = await lerPaginas(build as () => Consulta);
  if (error) throw new Error(`${rotulo}: ${error.message}`);
  return rows;
}

/** Abertas (para o prazo) + resolvidas/abertas em `ontem` (para o estornado), sem repetir a mesma linha;
 *  `valor_estornado` = `ml_vendas.estorno` do pedido (como src/lib/devolucoes.ts:43-55). Erro lança. */
export async function lerDevolucoesDoResumo(
  admin: SupabaseClient, orgId: string, ontem: JanelaIso,
): Promise<DevolucaoComEstorno[]> {
  const base = () => admin.from('ml_devolucoes').select(COLUNAS).eq('org_id', orgId);
  const [abertas, doDia] = await Promise.all([
    paginas(() => base().eq('status', 'opened').order('id', { ascending: true }), 'devoluções abertas'),
    paginas(() => base()
      .or(`and(fechado_em.gte.${ontem.desde},fechado_em.lt.${ontem.ate}),`
        + `and(fechado_em.is.null,aberto_em.gte.${ontem.desde},aberto_em.lt.${ontem.ate})`)
      .order('id', { ascending: true }), 'devoluções do dia'),
  ]);
  const linhas = [...new Map([...abertas, ...doDia].map((r) => [r.id, r])).values()];

  const orderIds = [...new Set(linhas.map((r) => r.order_id).filter((id) => id != null))];
  const estorno = new Map<unknown, number>();
  for (let i = 0; i < orderIds.length; i += LOTE_ORDERS) {
    const { data, error } = await admin.from('ml_vendas').select('order_id, estorno')
      .eq('org_id', orgId).in('order_id', orderIds.slice(i, i + LOTE_ORDERS));
    if (error) throw new Error(`estorno das devoluções: ${error.message}`);
    for (const v of data ?? []) estorno.set(v.order_id, Number(v.estorno ?? 0));
  }

  return linhas.map((r) => ({
    type: r.type as string, status: r.status as string,
    return_status_money: (r.return_status_money as string | null) ?? null,
    aberto_em: (r.aberto_em as string | null) ?? null, fechado_em: (r.fechado_em as string | null) ?? null,
    acoes_pendentes: (r.acoes_pendentes as DevolucaoComEstorno['acoes_pendentes']) ?? null,
    valor_estornado: estorno.get(r.order_id) ?? 0,
  }));
}
