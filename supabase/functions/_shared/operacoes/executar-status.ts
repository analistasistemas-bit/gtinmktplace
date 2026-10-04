// ADR-0174 emenda 2026-10-04 — executor de pausar/reativar em massa. Escrita via conn.atualizarStatus (ADR-0060:
// propaga ao anúncio de catálogo relacionado antes do PUT do item). Status relido fresco antes de cada escrita.
// No item de status, `saida_pedida_em` = "escrita pedida ao ML em" e `conferencias` = tentativas retentáveis.
import type { ResultadoCanal, StatusAnuncioCanal } from '../canais/contrato.ts';
import { decidirStatus } from './decidir-status.ts';
import { MSG_RECONECTAR } from './falhas.ts';
import { gravarPos, laco, type DepsLaco } from './laco.ts';
import { SemAcessoStatusML } from './ml-status.ts';
import type { AcaoStatus, ItemRow } from './tipos.ts';

export interface OperacaoStatusRow { id: string; org_id: string; acao: AcaoStatus }
export interface DepsStatus extends DepsLaco {
  /** Status FRESCO no ML; null = o ML não devolveu o item. Lança SemAcessoStatusML em 401/403. */
  lerStatus(mlItemId: string): Promise<StatusAnuncioCanal | null>;
  /** Mensagem do guard de migração PxV (ADR-0161) ou null. */
  migracaoPxv(mlItemId: string): Promise<string | null>;
  atualizarStatus(mlItemId: string, alvo: 'ativo' | 'pausado'): Promise<ResultadoCanal<void>>;
  /** Fatal: todo item `pendente`/`enviando` da operação → `erro` com a mensagem. */
  encerrarRestantes(mensagem: string): Promise<void>;
}

export const MSG_FALHA_STATUS = 'Falha ao atualizar status no Mercado Livre.';
export const TENTATIVAS_STATUS = 3;

async function processarStatus(op: OperacaoStatusRow, it: ItemRow, deps: DepsStatus): Promise<void> {
  const id = it.ml_item_id;
  const [atual, migracao] = await Promise.all([deps.lerStatus(id), deps.migracaoPxv(id)]);
  const d = decidirStatus(op.acao, atual, migracao);
  if (d.tipo === 'fim') {
    // Recuperação: uma tentativa anterior já pediu a escrita e o anúncio está no alvo → foi esta operação
    // (sem isso o Reverter perderia o item). ponytail: se outra pessoa mudou o status entre a marca e o PUT,
    // conta como nosso — o Reverter revalida no ML antes de escrever.
    if (d.status === 'ja_estava' && it.saida_pedida_em) return gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null }));
    return deps.gravarItem(op.id, id, { status: d.status, mensagem: d.mensagem });
  }
  if (!it.saida_pedida_em) await deps.gravarItem(op.id, id, { saida_pedida_em: new Date(deps.agora()).toISOString() });
  const r = await deps.atualizarStatus(id, d.alvo);
  if (r.ok) return gravarPos(deps.gravarItem(op.id, id, { status: 'aplicado', mensagem: null }));
  if (r.erro?.codigo === 'AUTENTICACAO') throw new SemAcessoStatusML(r.erro.mensagemOperador);
  const mensagem = r.erro?.mensagemOperador ?? MSG_FALHA_STATUS;
  // Retentável — 5xx/429, ou falha de transporte sem HTTP (fetch lançou; o conector a marca não retentável, mas a
  // propagação ao catálogo pode já ter mudado um relacionado). O item FICA `enviando` com a tentativa contada e o
  // laço segue com os outros; no fim, `finalizar` vê o `enviando` e agenda continuação em 150 s, quando o item
  // (parado > 2 min) volta a `itensPendentes`. Nada relança: uma mensagem com vários 502 não esgota o retry do QStash.
  const retentavel = r.erro?.retentavel === true || (r.erro !== undefined && r.erro.status === undefined);
  if (retentavel && it.conferencias + 1 < TENTATIVAS_STATUS) {
    return deps.gravarItem(op.id, id, { conferencias: it.conferencias + 1, mensagem });
  }
  return deps.gravarItem(op.id, id, { status: 'erro', mensagem });
}

export function executarStatus(
  op: OperacaoStatusRow, deps: DepsStatus, opts: { limiteMs: number; lote: number; maxItens?: number },
): Promise<{ processados: number; continuou: boolean }> {
  return laco(op.id, deps, opts, (it) => processarStatus(op, it, deps),
    { eh: (e) => e instanceof SemAcessoStatusML, mensagem: MSG_RECONECTAR, encerrar: (m) => deps.encerrarRestantes(m) });
}
