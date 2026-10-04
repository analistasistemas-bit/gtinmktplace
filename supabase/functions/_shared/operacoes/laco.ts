// ADR-0174 — laço do motor de operações em massa, comum a todas as ações: orçamento de tempo e teto por contagem
// (continua via QStash), claim por item antes de escrever no ML, finalização (espera `enviando`, agenda conferência
// ou conclui). A regra de cada ação vive no `processar` (promoção: executar.ts; status: executar-status.ts).
import type { CamposItem, ItemRow } from './tipos.ts';

export interface DepsLaco {
  agora(): number;
  /** Claim pendente (ou enviando antigo) → enviando; false = outro worker já pegou. */
  reivindicar(operacaoId: string, mlItemId: string): Promise<boolean>;
  /** `pendente` + `enviando` com atualizado_em > 2 min (worker morreu no meio). */
  itensPendentes(operacaoId: string, limite: number): Promise<ItemRow[]>;
  /** Há algum `enviando` (qualquer idade)? */
  temEnviando(operacaoId: string): Promise<boolean>;
  /** `saida_solicitada` com `proxima_conferencia` não nula. */
  itensAConferir(operacaoId: string): Promise<ItemRow[]>;
  gravarItem(operacaoId: string, mlItemId: string, campos: Partial<CamposItem>): Promise<void>;
  continuar(delaySeg?: number): Promise<void>;
  agendarConferencia(delaySeg: number): Promise<void>;
  concluir(): Promise<void>;
}
/** `encerrar` (opcional): encerra TODOS os itens não terminais da operação (inclusive `enviando` recente) e o
 *  laço finaliza: conclui, ou agenda a conferência dos itens que ficaram a conferir (reajuste com etapa). Sem ele, comportamento da promoção (varre `itensPendentes`). */
export interface Fatal { eh(e: unknown): boolean; mensagem: string; encerrar?: (mensagem: string) => Promise<void> }

const ESPERA_ENVIANDO_SEG = 150; // > 2 min: o enviando do worker morto já volta em itensPendentes

export const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export class FalhaPosEscrita extends Error {
  constructor(readonly causa: unknown) { super(mensagemDe(causa)); }
}
/** Escrita no ML já aceita: falha ao gravar relança e o item fica `enviando` para o retry redecidir. */
export const gravarPos = (p: Promise<void>) => p.catch((e) => { throw new FalhaPosEscrita(e); });

/** Sem pendentes: espera `enviando` de outro worker, senão agenda a conferência, senão conclui. */
async function finalizar(operacaoId: string, deps: DepsLaco, processados: number) {
  if (await deps.temEnviando(operacaoId)) {
    await deps.continuar(ESPERA_ENVIANDO_SEG);
    return { processados, continuou: true };
  }
  await agendarOuConcluir(deps, await deps.itensAConferir(operacaoId));
  return { processados, continuou: false };
}

/** Agenda a próxima conferência para quando o primeiro item vencer; sem itens → conclui. */
export async function agendarOuConcluir(deps: DepsLaco, aConferir: ItemRow[]): Promise<void> {
  const vencimentos = aConferir.map((i) => Date.parse(i.proxima_conferencia ?? '')).filter(Number.isFinite);
  if (!vencimentos.length) return deps.concluir();
  await deps.agendarConferencia(Math.max(1, Math.ceil((Math.min(...vencimentos) - deps.agora()) / 1000)));
}

export async function laco(
  operacaoId: string, deps: DepsLaco, opts: { limiteMs: number; lote: number; maxItens?: number },
  processar: (it: ItemRow) => Promise<void>, fatal?: Fatal,
): Promise<{ processados: number; continuou: boolean }> {
  const inicio = deps.agora();
  let processados = 0;
  for (;;) {
    const lote = await deps.itensPendentes(operacaoId, opts.lote);
    if (!lote.length) break;
    for (const it of lote) {
      // Teto por contagem (ADR-0173 §4): o Supabase derruba por CPU (2 s), não por relógio.
      if (processados >= (opts.maxItens ?? Infinity) || deps.agora() - inicio >= opts.limiteMs) {
        await deps.continuar();
        return { processados, continuou: true };
      }
      if (!(await deps.reivindicar(operacaoId, it.ml_item_id))) continue;
      processados++;
      try {
        await processar(it);
      } catch (e) {
        if (e instanceof FalhaPosEscrita) throw e.causa;
        if (!fatal?.eh(e)) {
          await deps.gravarItem(operacaoId, it.ml_item_id, { status: 'erro', mensagem: mensagemDe(e) });
          continue;
        }
        // Fatal (ex.: sem permissão na conta): nada mais passa — encerra este e todos os restantes.
        // `jaGravado`: o processar já deixou o item no estado certo (reajuste com etapa → conferindo).
        if (!(e as { jaGravado?: boolean }).jaGravado) {
          await deps.gravarItem(operacaoId, it.ml_item_id, { status: 'erro', mensagem: fatal.mensagem });
        }
        if (fatal.encerrar) {
          // Status: também há itens `enviando` recentes (retentáveis aguardando a continuação) que itensPendentes
          // não devolve por 2 min — sem isto eles escreveriam no ML depois do encerramento fatal.
          await fatal.encerrar(fatal.mensagem);
          // Reajuste: itens com etapa ficam `conferindo` → agenda a conferência em vez de concluir.
          return finalizar(operacaoId, deps, processados);
        }
        for (let resto = await deps.itensPendentes(operacaoId, opts.lote); resto.length; resto = await deps.itensPendentes(operacaoId, opts.lote)) {
          for (const r of resto) await deps.gravarItem(operacaoId, r.ml_item_id, { status: 'erro', mensagem: fatal.mensagem });
        }
        return finalizar(operacaoId, deps, processados);
      }
    }
  }
  return finalizar(operacaoId, deps, processados);
}
