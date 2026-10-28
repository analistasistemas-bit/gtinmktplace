// Leitura do detalhe de reclamação no ML (ADR-0192). Compartilhada pela edge `posvenda-detalhe` e
// pelas ações (Task 5, que relê o estado após escrever — sem HTTP entre edges). Não testado por vitest.
import { acoesDaConta, playerDaConta, revisaoPendente, vezDe } from './devolucao.ts';
import { lerClaimCompleto } from './devolucoes-io.ts';
import {
  mapearResolucoes, montarHistorico, motivosRevisao, ofertasReembolso,
  type DetalheReclamacao,
} from './posvenda.ts';

const API = 'https://api.mercadolibre.com/post-purchase';

/** GET que degrada para null em qualquer falha: só o claim é obrigatório, o resto é complemento. */
async function lerOpcional(token: string, url: string): Promise<unknown> {
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.ok ? await resp.json() : null;
  } catch { return null; }
}

/** Estado completo da reclamação, relido agora do ML. Lança MLApiError se o claim não for legível. */
export async function lerDetalheReclamacao(
  token: string, claimId: string, contaExternaId: string,
): Promise<DetalheReclamacao> {
  const { claim, ret, extras } = await lerClaimCompleto(token, claimId);
  const player = playerDaConta(claim, contaExternaId);
  const acoes = acoesDaConta(claim, contaExternaId).map((a) => a.action);
  const detalhe = extras.detalhe.ok ? extras.detalhe.valor : null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const revisoes = extras.revisoes.ok && extras.revisoes.valor !== 'sem_review' ? extras.revisoes.valor : [];
  const pendente = revisaoPendente(acoesDaConta(claim, contaExternaId), extras.revisoes);

  const v1 = `${API}/v1/claims/${claimId}`;
  const [msgs, resol, custo, motivos, parcial] = await Promise.all([
    lerOpcional(token, `${v1}/messages`),
    lerOpcional(token, `${v1}/expected-resolutions`),
    lerOpcional(token, `${v1}/charges/return-cost`),
    pendente
      ? lerOpcional(token, `${API}/v1/returns/reasons?flow=seller_return_failed&claim_id=${claimId}`)
      : Promise.resolve(null),
    acoes.includes('allow_partial_refund') ? lerOpcional(token, `${v1}/partial-refund/available-offers`) : Promise.resolve(null),
  ]);

  const resolucoes = mapearResolucoes(resol);
  const amount = Number((custo as { amount?: unknown } | null)?.amount);
  return {
    claim_id: Number(claim.id ?? claimId),
    return_id: ret.ok ? ret.valor?.id ?? null : null,
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
    custo_devolucao: custo != null && Number.isFinite(amount) ? amount : null,
    historico: montarHistorico(msgs, player?.role),
    acoes,
    revisoes,
    pedidos_devolucao: ret.ok ? ret.valor?.pedidos ?? [] : [],
    motivos_falha_revisao: motivosRevisao(motivos),
    reembolso_parcial: ofertasReembolso(parcial),
  };
}
