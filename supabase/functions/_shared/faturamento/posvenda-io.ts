// Leitura do detalhe de reclamação no ML (ADR-0192). Compartilhada pela edge `posvenda-detalhe` e
// pelas ações (Task 5, que relê o estado após escrever — sem HTTP entre edges). Não testado por vitest.
import { acoesDaConta, playerDaConta, revisaoPendente, vezDe } from './devolucao.ts';
import { lerClaimCompleto } from './devolucoes-io.ts';
import {
  mapearResolucoes, montarHistorico, motivosRevisao, ofertasReembolso,
  type DetalheReclamacao,
} from './posvenda.ts';

const API = 'https://api.mercadolibre.com/post-purchase';

type Lido = { ok: true; body: unknown } | { ok: false };

/** GET que distingue "lido" de "não consegui ler" (HTTP != 2xx, rede ou JSON ilegível). */
async function ler(token: string, url: string): Promise<Lido> {
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.ok ? { ok: true, body: await resp.json() } : { ok: false };
  } catch { return { ok: false }; }
}

/** Recurso necessário à decisão: falha → erro (a edge responde 502), nunca "ausência". */
const exigir = (l: Lido, nome: string): unknown => {
  if (!l.ok) throw new Error(`Não foi possível ler ${nome} no Mercado Livre. Tente novamente.`);
  return l.body;
};

/** Estado completo da reclamação, relido agora do ML. Lança se o claim ou um recurso necessário
 *  à decisão (ações, revisões, motivos, ofertas) não puder ser lido; os só informativos viram
 *  null/vazio e entram em `incompleto`. */
export async function lerDetalheReclamacao(
  token: string, claimId: string, contaExternaId: string,
): Promise<DetalheReclamacao> {
  const { claim, ret, extras } = await lerClaimCompleto(token, claimId);
  const player = playerDaConta(claim, contaExternaId);
  const acoesPend = acoesDaConta(claim, contaExternaId);
  const acoes = acoesPend.map((a) => a.action);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const incompleto: string[] = [];

  // Revisões dependem do return: sem ler o return não dá para afirmar "nenhum pedido pendente".
  if (!ret.ok) throw new Error('Não foi possível ler a devolução no Mercado Livre. Tente novamente.');
  if (!extras.revisoes.ok) throw new Error('Não foi possível ler as revisões da devolução no Mercado Livre. Tente novamente.');
  const revisoes = extras.revisoes.valor !== 'sem_review' ? extras.revisoes.valor : [];
  const pendente = revisaoPendente(acoesPend, extras.revisoes);

  const v1 = `${API}/v1/claims/${claimId}`;
  const [msgs, hist, resol, custo, motivos, parcial] = await Promise.all([
    ler(token, `${v1}/messages`),
    ler(token, `${v1}/status-history`),
    ler(token, `${v1}/expected-resolutions`),
    ler(token, `${v1}/charges/return-cost`),
    pendente ? ler(token, `${API}/v1/returns/reasons?flow=seller_return_failed&claim_id=${claimId}`) : null,
    acoes.includes('allow_partial_refund') ? ler(token, `${v1}/partial-refund/available-offers`) : null,
  ]);
  const motivosBody = motivos ? exigir(motivos, 'os motivos de revisão') : null;
  const parcialBody = parcial ? exigir(parcial, 'as ofertas de reembolso parcial') : null;

  const info = (l: Lido, campo: string): unknown => {
    if (!l.ok) { incompleto.push(campo); return null; }
    return l.body;
  };
  const detalhe = extras.detalhe.ok ? extras.detalhe.valor : null;
  if (!extras.detalhe.ok) incompleto.push('estado');
  if (!extras.reputacao.ok) incompleto.push('afeta_reputacao');
  const resolBody = info(resol, 'resolucoes');
  const custoBody = info(custo, 'custo_devolucao') as { amount?: unknown } | null;
  const msgsBody = info(msgs, 'historico');
  const histBody = hist.ok ? hist.body : null;
  if (!hist.ok && msgs.ok) incompleto.push('historico'); // (msgs falho já registrou)

  const resolucoes = mapearResolucoes(resolBody);
  const amount = Number(custoBody?.amount);
  return {
    claim_id: Number(claim.id ?? claimId),
    return_id: ret.valor?.id ?? null,
    stage: claim.stage ?? null,
    status: claim.status ?? null,
    estado: {
      titulo: str(detalhe?.title), descricao: str(detalhe?.description), problema: str(detalhe?.problem),
      prazo: str(detalhe?.due_date),
      vez_de: vezDe(str(detalhe?.action_responsible), player?.role),
    },
    comprador_quer: resolucoes.find((r) => r.papel === 'complainant')?.tipo ?? null,
    resolucoes,
    resolucao_final: claim.resolution
      ? { motivo: claim.resolution.reason ?? null, data: claim.resolution.date_created ?? null }
      : null,
    afeta_reputacao: extras.reputacao.ok ? extras.reputacao.valor : null,
    custo_devolucao: custoBody != null && custoBody.amount != null && Number.isFinite(amount) ? amount : null,
    historico: montarHistorico(msgsBody, histBody, player?.role),
    acoes,
    revisoes,
    pedidos_devolucao: ret.valor?.pedidos ?? [],
    motivos_falha_revisao: motivosRevisao(motivosBody),
    reembolso_parcial: ofertasReembolso(parcialBody),
    incompleto,
  };
}
