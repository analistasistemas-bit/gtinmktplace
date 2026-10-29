// IO de devoluções/claims (ADR-0037, post-purchase). Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  colunasLidas, ehClaimDeCompra, linhaParaUpsert, mapearDevolucao, normalizarRevisoes,
  type ClaimML, type DetalheClaimML, type ExtrasClaim, type Leitura, type ReturnML,
} from './devolucao.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { MLApiError } from '../ml/erro-ml.ts';
import { chunk } from './utils.ts';
import type { DevolucaoLocal } from './reconciliar-filtros.ts';

const API = 'https://api.mercadolibre.com';

/** GET /post-purchase/v1/claims/{id}. Lança MLApiError(status) em erro (caller classifica via
 * classificarErroML). */
export async function buscarClaim(token: string, claimId: string): Promise<ClaimML> {
  const resp = await fetch(`${API}/post-purchase/v1/claims/${claimId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const corpo = (await resp.text().catch(() => '')).slice(0, 200); // classificador de recusa permanente lê isto
    throw new MLApiError(resp.status, `ML /claims/${claimId} ${resp.status} ${corpo}`.trim());
  }
  return await resp.json() as ClaimML;
}

const AUTH = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const numOuNull = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};

/** Forma medida do return (v2): `shipments[].tracking_number` (type 'return') e o pedido em
 *  `orders[]` (carrinho) ou `resource_id` (`resource_type: 'order'`). */
function lerReturn(data: unknown): ReturnML | null {
  const d = data as Record<string, unknown> | null;
  const r = (Array.isArray(data) ? data[0] : ((d?.returns as unknown[] | undefined)?.[0] ?? data)) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const envios = Array.isArray(r.shipments) ? (r.shipments as Array<Record<string, unknown>>) : [];
  const envio = envios.find((e) => e?.type === 'return') ?? envios[0];
  const lista = Array.isArray(r.orders)
    ? (r.orders as Array<Record<string, unknown>>).map((o) => numOuNull(o?.order_id ?? o?.id))
    : (r.resource_type === 'order' ? [numOuNull(r.resource_id)] : []);
  const pedidos = lista.filter((n): n is number => n != null);
  return {
    id: numOuNull(r.id),
    tracking: typeof envio?.tracking_number === 'string' ? envio.tracking_number : null,
    pedidos: pedidos.length ? pedidos : undefined,
    status: (r.status as string | undefined) ?? null,
    status_money: (r.status_money as string | undefined) ?? null,
    subtype: (r.subtype as string | undefined) ?? null,
  };
}

/** GET v2/claims/{id}/returns. 404 = claim sem devolução (lido, `valor: null`); qualquer outra
 *  falha = `ok:false` (não apaga o que já foi gravado). NÃO vira MLApiError: "sem return ainda" é
 *  estado de negócio comum, não erro de liveness. */
export async function buscarReturnLeitura(token: string, claimId: string, encerrado = false): Promise<Leitura<ReturnML | null>> {
  try {
    const resp = await fetch(`${API}/post-purchase/v2/claims/${claimId}/returns`, AUTH(token));
    if (resp.status === 404) return { ok: true, valor: null };
    if (!resp.ok) {
      // Só claim encerrado: recusa permanente = conclusão sem dado (não apaga o já gravado).
      if (encerrado && recusaPermanente(resp.status, await resp.json().catch(() => null))) return { ok: false, permanente: true };
      return { ok: false };
    }
    return { ok: true, valor: lerReturn(await resp.json()) };
  } catch { return { ok: false }; }
}

/** Compat.: null em ausência OU erro. Quem precisa distinguir usa `buscarReturnLeitura`. */
export async function buscarReturn(token: string, claimId: string): Promise<ReturnML | null> {
  const l = await buscarReturnLeitura(token, claimId);
  return l.ok ? l.valor : null;
}

async function lerJson(url: string, token: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const resp = await fetch(url, AUTH(token));
    // 2xx com corpo ilegível é leitura FALHA (null), nunca "lido e vazio". Só o corpo de erro
    // (404 "review not found") pode faltar.
    if (resp.ok) return { status: resp.status, body: await resp.json() };
    return { status: resp.status, body: await resp.json().catch(() => null) };
  } catch { return null; }
}

/** Recusa permanente do ML (não adianta retentar): 401 "Claims 1.0" ou 403 "sem acesso ao claim". */
export function recusaPermanente(status: number, body: unknown): boolean {
  const txt = JSON.stringify(body ?? '');
  return (status === 401 && /Claims 1\.0/i.test(txt)) || (status === 403 && /does not have access to claim/i.test(txt));
}

const CAMPOS_DETALHE = ['title', 'description', 'problem', 'due_date', 'action_responsible'] as const;

/** `/detail`, `/affects-reputation` e as revisões do return. Cada leitura falha sozinha. */
export async function buscarExtrasClaim(
  token: string, claimId: string, returnId: number | null | undefined, encerrado = false,
): Promise<ExtrasClaim> {
  const base = `${API}/post-purchase/v1`;
  const [det, rep, rev] = await Promise.all([
    lerJson(`${base}/claims/${claimId}/detail`, token),
    lerJson(`${base}/claims/${claimId}/affects-reputation`, token),
    returnId == null ? Promise.resolve(null) : lerJson(`${base}/returns/${returnId}/reviews`, token),
  ]);
  const ok200 = (r: { status: number } | null) => r != null && r.status >= 200 && r.status < 300;

  const perm = (r: { status: number; body: unknown } | null) => encerrado && r != null && recusaPermanente(r.status, r.body);
  let detalhe: ExtrasClaim['detalhe'] = perm(det) ? { ok: false, permanente: true } : { ok: false };
  if (det && ok200(det) && det.body && typeof det.body === 'object') {
    const b = det.body as Record<string, unknown>;
    const d: DetalheClaimML = {};
    for (const k of CAMPOS_DETALHE) if (b[k] !== undefined) d[k] = b[k] as never;
    detalhe = { ok: true, valor: d };
  }
  const reputacao: ExtrasClaim['reputacao'] = rep && ok200(rep) && rep.body && typeof rep.body === 'object'
    ? { ok: true, valor: ((rep.body as Record<string, unknown>).affects_reputation as string | undefined) ?? null }
    : perm(rep) ? { ok: false, permanente: true } : { ok: false };
  let revisoes: ExtrasClaim['revisoes'] = { ok: false };
  if (returnId == null) revisoes = { ok: true, valor: [] };
  else if (rev && ok200(rev) && Array.isArray((rev.body as { reviews?: unknown } | null)?.reviews)) {
    revisoes = { ok: true, valor: normalizarRevisoes(rev.body) };
  }
  else if (rev?.status === 404 && /review.*not found|not found.*review/i.test(JSON.stringify(rev.body ?? ''))) {
    revisoes = { ok: true, valor: 'sem_review' };
  }
  return { detalhe, reputacao, revisoes };
}

/** Return + extras de um claim. Sem return lido, as revisões (que dependem do id) também ficam
 *  não lidas. A versão (`lidoEm`) é capturada pelo CHAMADOR antes de ler o claim. */
export async function lerReturnEExtras(token: string, claimId: string, encerrado = false) {
  const ret = await buscarReturnLeitura(token, claimId, encerrado);
  const extras = await buscarExtrasClaim(token, claimId, ret.ok ? ret.valor?.id ?? null : null, encerrado);
  if (!ret.ok) extras.revisoes = ret.permanente ? { ok: false, permanente: true } : { ok: false };
  return { ret, extras };
}

/** Snapshot completo: `lidoEm` capturado ANTES de qualquer GET (inclusive o do claim), senão uma
 *  resposta lenta e antiga receberia versão posterior e sobrescreveria estado novo. Lança
 *  MLApiError se o claim não puder ser lido. */
export async function lerClaimCompleto(token: string, claimId: string) {
  const lidoEm = new Date().toISOString();
  const claim = await buscarClaim(token, claimId);
  return { claim, lidoEm, ...(await lerReturnEExtras(token, claimId, claim.status === 'closed')) };
}

/** Varre /post-purchase/v1/claims/search do vendedor. Para o backfill. */
export async function buscarClaimsSeller(token: string): Promise<ClaimML[]> {
  const statuses = ['opened', 'closed'];
  const out: ClaimML[] = [];
  const headers = { Authorization: `Bearer ${token}` };
  const limit = 50;

  for (const status of statuses) {
    let offset = 0;
    while (offset < 2000) {
      const params = new URLSearchParams({
        status,
        sort: 'date_desc',
        offset: String(offset),
        limit: String(limit)
      });
      const resp = await fetch(`${API}/post-purchase/v1/claims/search?${params}`, { headers });
      if (!resp.ok) {
        if (offset === 0) throw new Error(`ML /claims ${resp.status}`);
        break;
      }
      const data = await resp.json();
      const results: ClaimML[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.results) ? data.results : []);
      out.push(...results);
      const total = Number(data?.paging?.total ?? out.length);
      offset += limit;
      if (results.length === 0 || offset >= total) break;
    }
  }
  return out;
}

/** Upsert de um claim. Retorna se é novo (para alerta) e marca a venda com tem_devolucao.
 *  `ret` como `Leitura` grava só o que foi lido; `ReturnML|null` (chamada antiga) conta como lido.
 *  Sem `extras` não toca nas colunas do pós-venda. `lidoEm` = instante ANTES dos GETs ao ML (guarda
 *  de versão do RPC). Lança em erro do banco; `linha` = a linha que ficou no banco. */
export async function upsertDevolucao(
  admin: SupabaseClient, userId: string, orgId: string | null, claim: ClaimML,
  ret: Leitura<ReturnML | null> | ReturnML | null,
  /** Conta ML conectada. Claim em que ela é a COMPRADORA não é devolução de venda — ver
   *  `ehClaimDeCompra`. Opcional para não quebrar chamadas antigas; sem ele, grava como antes. */
  contaExternaId?: string | null,
  extras?: ExtrasClaim,
  lidoEm?: string,
): Promise<{ nova: boolean; row: ReturnType<typeof mapearDevolucao>; ignorado?: boolean; linha?: Record<string, unknown> }> {
  const leitura: Leitura<ReturnML | null> = ret && typeof ret === 'object' && 'ok' in ret
    ? ret as Leitura<ReturnML | null> : { ok: true, valor: ret as ReturnML | null };
  const row = mapearDevolucao(claim, leitura.ok ? leitura.valor : null, contaExternaId);

  if (ehClaimDeCompra(claim, contaExternaId)) {
    return { nova: false, row, ignorado: true };
  }

  // Se order_id é nulo mas o claim é sobre envio (resource = shipment), resolve order_id em ml_vendas
  if (row.order_id === null && claim.resource === 'shipment' && claim.resource_id != null) {
    const { data: venda } = await admin.from('ml_vendas')
      .select('order_id')
      .eq('user_id', userId)
      .eq('shipping_id', String(claim.resource_id))
      .maybeSingle();
    if (venda?.order_id != null) {
      row.order_id = Number(venda.order_id);
    }
  }

  const { data: anterior } = await admin.from('ml_devolucoes')
    .select('id').eq('user_id', userId).eq('claim_id', row.claim_id).maybeSingle();
  const nova = !anterior;
  const lidas = extras && contaExternaId ? colunasLidas(claim, leitura, extras, contaExternaId) : {};
  const { data: linha, error } = await admin.rpc('upsert_ml_devolucao', {
    linha: {
      user_id: userId, org_id: orgId, ...linhaParaUpsert(row, lidas, leitura.ok),
      raw: claim as unknown as Record<string, unknown>, atualizado_em: new Date().toISOString(),
      ...(lidoEm ? { lido_em: lidoEm } : {}),
    },
  });
  if (error) throw new Error(`upsert_ml_devolucao: ${error.message}`);

  // Marca a venda relacionada (atalho p/ badge na aba Vendas). atualizado_em bumped p/ o poll
  // incremental (ADR-0082) pegar o badge no delta — sem isso ele só aparece num fetch completo.
  if (row.order_id != null) {
    await admin.from('ml_vendas').update({ tem_devolucao: true, atualizado_em: new Date().toISOString() })
      .eq('user_id', userId).eq('order_id', row.order_id);
  }
  return { nova, row, linha: (linha ?? undefined) as Record<string, unknown> | undefined };
}

/**
 * Enriquece linhas antigas (`enriquecido_em is null`) da org, paginando por `claim_id` (> depoisDe),
 * sem depender de `buscarClaimsSeller` (corta em 2.000 por status). Falha de um claim não trava os
 * demais: a linha continua `null` e volta na próxima rodada. Devolve quantos gravou e o último
 * `claim_id` do lote (cursor; null = acabou). Escreve com user_id = dono da conexão.
 */
export async function enriquecerPendentes(
  admin: SupabaseClient, token: string, org: string, conexao: ConexaoCanal & { criadoPor: string },
  depoisDe = 0, limite = 20,
): Promise<{ n: number; ultimo: number | null }> {
  const { data, error } = await admin.from('ml_devolucoes').select('claim_id, status')
    .eq('org_id', org).is('enriquecido_em', null).gt('claim_id', depoisDe)
    .order('claim_id', { ascending: true }).limit(limite);
  if (error) throw new Error(`enriquecerPendentes: ${error.message}`);
  const ids = (data ?? []).map((r) => Number(r.claim_id));
  const encerrados = new Set((data ?? []).filter((r) => r.status === 'closed').map((r) => Number(r.claim_id)));
  let n = 0;
  for (const lote of chunk(ids, 5)) {
    await Promise.all(lote.map(async (id) => {
      try {
        const { claim, ret, extras, lidoEm } = await lerClaimCompleto(token, String(id));
        await upsertDevolucao(admin, conexao.criadoPor, org, claim, ret, conexao.contaExternaId, extras, lidoEm);
        n++;
      } catch (e) {
        // 403 permanente no GET principal de claim já encerrado: só marca como enriquecido (nada a ler).
        if (e instanceof MLApiError && encerrados.has(id) && recusaPermanente(e.status ?? 0, e.message)) {
          const { error: erroUp } = await admin.from('ml_devolucoes').update({ enriquecido_em: new Date().toISOString() })
            .eq('org_id', org).eq('claim_id', id);
          if (!erroUp) { n++; return; }
        }
        console.warn(`enriquecer: claim ${id} da org ${org} falhou: ${(e as Error).message}`);
      }
    }));
  }
  return { n, ultimo: ids.length ? ids[ids.length - 1] : null };
}

/**
 * Estado local dos claims informados, para o reconciliar decidir quais precisam ser reprocessados
 * (`claimPrecisaProcessar`). Uma consulta em lote no lugar de reprocessar tudo às cegas.
 *
 * Em lotes pelo mesmo motivo de `carregarPerguntasLocais`: `in.()` vai na URL e a resposta do
 * PostgREST tem teto de 1000 linhas — `buscarClaimsSeller` pagina até 2000 por status.
 */
export async function carregarDevolucoesLocais(
  admin: SupabaseClient, userId: string, claimIds: number[],
): Promise<Map<number, DevolucaoLocal>> {
  const mapa = new Map<number, DevolucaoLocal>();
  for (const lote of chunk(claimIds, 200)) {
    const { data } = await admin.from('ml_devolucoes')
      .select('claim_id, status, stage, aberto_em, fechado_em, return_status_money, revisao_pendente, enriquecido_em')
      .eq('user_id', userId).in('claim_id', lote);
    for (const r of data ?? []) mapa.set(Number(r.claim_id), r as unknown as DevolucaoLocal);
  }
  return mapa;
}
