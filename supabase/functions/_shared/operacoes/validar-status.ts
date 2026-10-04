// ADR-0174 emenda 2026-10-04 — validação do pedido de pausar/reativar (criação). Puro. Sem trava financeira:
// pausar/reativar não cria prejuízo. Kit Virtual fica fora (status em kit nunca testado — ADR-0154 D-14).
import { MAX_ITENS, type Recusa } from './validar.ts';
import type { AcaoStatus } from './tipos.ts';

export interface ItemPedidoStatus { ml_item_id: string; titulo: string | null }
const TITULO_MAX = 300;

export function validarPedidoStatus(
  itens: ItemPedidoStatus[], daOrg: Set<string>, kits: Set<string>,
): { ok: true; itens: ItemPedidoStatus[] } | { ok: false; erro: string; itens?: Recusa[] } {
  if (!itens.length) return { ok: false, erro: 'Selecione ao menos um anúncio.' };
  if (itens.length > MAX_ITENS) return { ok: false, erro: `No máximo ${MAX_ITENS} anúncios por operação.` };
  const ok: ItemPedidoStatus[] = [];
  const recusas: Recusa[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    const id = it.ml_item_id;
    if (vistos.has(id)) { recusas.push({ ml_item_id: id, motivo: 'Anúncio repetido no pedido' }); continue; }
    vistos.add(id);
    if (kits.has(id)) { recusas.push({ ml_item_id: id, motivo: 'Kit Virtual não entra em pausar/reativar em massa' }); continue; }
    if (!daOrg.has(id)) { recusas.push({ ml_item_id: id, motivo: 'O anúncio não é desta organização' }); continue; }
    ok.push({ ml_item_id: id, titulo: it.titulo?.slice(0, TITULO_MAX) ?? null });
  }
  return recusas.length ? { ok: false, erro: 'Alguns anúncios não podem entrar na operação.', itens: recusas } : { ok: true, itens: ok };
}

const INVERSA_STATUS: Record<AcaoStatus, AcaoStatus> = { pausar: 'reativar', reativar: 'pausar' };

/** Reverter de pausar/reativar: origem concluída, da ação inversa, sem promoção, e só ids que ELA aplicou. */
export function reversaoValida(
  origem: { acao: string; promocao_id: string | null; status: string } | null,
  idsAplicados: Set<string>, pedido: { acao: AcaoStatus; ids: string[] },
): boolean {
  if (!origem || origem.promocao_id !== null || origem.status !== 'concluida') return false;
  if (origem.acao !== INVERSA_STATUS[pedido.acao]) return false;
  return pedido.ids.every((id) => idsAplicados.has(id));
}
