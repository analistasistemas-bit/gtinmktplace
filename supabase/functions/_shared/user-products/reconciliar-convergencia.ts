// ADR-0088 — Reconciliador de CONVERGÊNCIA (seção "Reconciliador de convergência (mutável —
// PUT/atualizarStatus)"): retoma famílias User Products travadas em `mudando_composicao=true`
// (mudança de composição interrompida por crash), reusando a mini-saga já existente
// (`atualizarFamiliaUP`) por completo — não reimplementa composição/agregação.
//
// Escopo desta entrega: só `mudando_composicao=true` (o caso citado pela própria ADR como "o
// reconciliador" no passo 8 da saga e na mini-saga de composição). `estado_desejado='ativando'`
// (compensacao_pendente da saga de CRIAÇÃO) e `estado_desejado='pausando'` (sem produtor no
// código hoje) ficam de fora — automatizar 'ativando' exigiria reconstruir o `AnuncioCanonico`
// completo (fotos, desconto, dimensões) dentro do reconciliador, e hoje já converge via
// "Reenviar" manual (idempotente/resumível). Registrado em docs/TASKS.md como follow-up.
//
// O orçamento de rodadas É o mesmo já usado pelo worker QStash normal do UPDATE
// (`decidirRetryTransitorio`/`MAX_RETRIES_TRANSIENTES`, dentro de `atualizarFamiliaUP`) — o
// driver não precisa de um teto próprio: passa `reconciliacao_tentativas` (já incrementado
// atomicamente pelo claim) como o `tentativas` de `atualizarFamiliaUP`, que decide sozinho
// retry-vs-erro-terminal e já limpa `mudando_composicao`/`reconciliacao_tentativas` no
// esgotamento (revisão anterior). O driver só repassa o `estado` de volta.

export interface ClaimResultado {
  rootId: string;
  orgId: string;
  codigoPai: string;
  titulo: string | null;
  criadoEm: string | null;
  skusEsperados: string[];
  /** Referência durável à família QUE INICIOU o episódio (gravada por `iniciarComposicao` real —
   *  nunca inferida por recência: múltiplas famílias podem compartilhar o mesmo codigo_pai). */
  familiaId: string | null;
  /** `reconciliacao_tentativas` JÁ incrementado pelo claim atômico — é o valor a passar como
   *  `tentativas` pra `atualizarFamiliaUP` (nunca o valor lido antes do increment). */
  tentativas: number;
}

export interface PortasConvergencia {
  /** Claim atômico (RPC `reconciliar_convergencia_claim`): re-checa `mudando_composicao=true` e
   *  `atualizado_em` velho DENTRO do mesmo UPDATE que incrementa `reconciliacao_tentativas`.
   *  `null` = perdeu o claim (outra execução do reconciliador, ou o worker normal do UPDATE, já
   *  tocou esta raiz nesse meio-tempo) — nunca processar quando null. */
  claim(rootId: string): Promise<ClaimResultado | null>;
  /** Resume via `atualizarFamiliaUP` com `skusDesejadosOverride`+`tentativas` do claim. O
   *  mapeamento incompleto→retry/erro (e a limpeza de `mudando_composicao` no esgotamento) já é
   *  feito INTEIRAMENTE dentro de `atualizarFamiliaUP` — não duplica essa lógica aqui. */
  resumirComposicao(claim: ClaimResultado): Promise<{ estado: 'ok' | 'retry' | 'erro' }>;
}

export type ResultadoRaiz =
  | { rootId: string; tipo: 'convergiu' }
  | { rootId: string; tipo: 'retry' }
  | { rootId: string; tipo: 'erro'; motivo: string }
  | { rootId: string; tipo: 'perdeu_claim' }
  /** Raiz travada mas sem `mudando_composicao_familia_id` gravado — só possível pra episódios
   *  iniciados ANTES desta migration (dado histórico, não deveria acontecer em produção nova).
   *  Nunca adivinha a família por recência (achado real de revisão): fica pendente/ignorada,
   *  visível pro operador resolver via "Reenviar" manual como hoje. */
  | { rootId: string; tipo: 'sem_familia_referenciada' };

export async function reconciliarConvergencia(
  portas: PortasConvergencia,
  rootIds: string[],
): Promise<ResultadoRaiz[]> {
  const resultados: ResultadoRaiz[] = [];

  for (const rootId of rootIds) {
    try {
      const claim = await portas.claim(rootId);
      if (!claim) { resultados.push({ rootId, tipo: 'perdeu_claim' }); continue; }
      if (!claim.familiaId) { resultados.push({ rootId, tipo: 'sem_familia_referenciada' }); continue; }

      const r = await portas.resumirComposicao(claim);
      if (r.estado === 'ok') { resultados.push({ rootId, tipo: 'convergiu' }); continue; }
      if (r.estado === 'retry') { resultados.push({ rootId, tipo: 'retry' }); continue; }
      // 'erro': atualizarFamiliaUP JÁ marcou a família erro e limpou mudando_composicao/
      // reconciliacao_tentativas internamente (esgotamento do próprio orçamento) — não duplica.
      resultados.push({ rootId, tipo: 'erro', motivo: 'mudança de composição não convergiu (orçamento esgotado)' });
    } catch (e) {
      // Best-effort entre raízes: uma falha (rede, timeout) numa raiz não pode derrubar o
      // reconciliador inteiro — as demais raízes travadas ainda merecem a chance de convergir.
      console.error(`reconciliarConvergencia: falhou pra raiz ${rootId}:`, e);
      resultados.push({ rootId, tipo: 'erro', motivo: String(e) });
    }
  }

  return resultados;
}
