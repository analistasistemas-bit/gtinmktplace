// I5 / ADR-0178 — etapa QStash do reajuste (executar/conferir). Conta sem acesso nunca usa encerrarComErro: item com
// etapa (escrita possível no ML) fica `conferindo` com a reserva, e a operação só conclui sem nada a conferir (C3).
import { MLApiError } from '../../ml/erro-ml.ts';
import { MSG_RECONECTAR, MSG_SEM_CONEXAO } from '../falhas.ts';
import { agendarOuConcluir, type DepsLaco } from '../laco.ts';
import type { DepsReajuste, OperacaoReajusteRow } from './executar.ts';

type Resultado = { processados: number; continuou: boolean };
export interface DepsEtapaReajuste<Cx> {
  /** null = org sem conta ML (ausência real); erro de leitura/refresh lança. */
  conexao(): Promise<Cx | null>;
  /** Só banco (sem conexão ML): o `itensAConferir` tem de enxergar `conferindo`. */
  banco: DepsLaco & Pick<DepsReajuste, 'encerrarSemEtapa'>;
  executar(cx: Cx): Promise<Resultado>;
}

export async function etapaReajuste<Cx>(
  op: OperacaoReajusteRow, deps: DepsEtapaReajuste<Cx>,
): Promise<({ ok: true } & Resultado) | { ok: false; erro: string }> {
  let cx: Cx | null;
  try {
    cx = await deps.conexao();
  } catch (e) {
    // invalid_grant não se resolve sozinho; demais erros são transitórios → relança (500, QStash reentrega).
    if (!(e instanceof MLApiError && e.oauthError === 'invalid_grant')) throw e;
    return encerrar(op, deps.banco, MSG_RECONECTAR);
  }
  if (!cx) return encerrar(op, deps.banco, MSG_SEM_CONEXAO);
  return { ok: true, ...(await deps.executar(cx)) };
}

async function encerrar(op: OperacaoReajusteRow, banco: DepsEtapaReajuste<unknown>['banco'], erro: string) {
  await banco.encerrarSemEtapa(op.id, erro);
  await agendarOuConcluir(banco, await banco.itensAConferir(op.id));
  return { ok: false as const, erro };
}
