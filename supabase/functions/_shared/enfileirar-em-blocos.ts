// Lógica pura de publicação em blocos — sem import específico do Deno, pra ser testável
// direto (queue.ts importa `npm:@upstash/qstash`, que o Vite/vitest do frontend não resolve).
//
// `montarMsg` fica a cargo do caller porque as mensagens variam: publish simples usa só
// {url, body, retries}; a fila serial do ML (ADR-0034) precisa de queueName + retryDelay.
export type PublicarBloco<TMsg> = (msgs: TMsg[]) => Promise<{ messageId: string }[]>;

// Lote #44 (03/08, 3299 linhas): ingest-lote enfileirava 1 publish por família num loop
// sequencial e o QStash devolveu "Rate limit exceeded for trace ..., Retry after 42349ms" já
// na 1ª chamada, derrubando o lote inteiro — 18 famílias travadas em 'pendente' sem nenhuma
// mensagem enfileirada. NÃO é o "burst rate limit" documentado da Upstash (esse não existe
// para publish/batch, só para endpoints de gestão como queues/schedules) — a causa exata dessa
// mensagem específica não foi confirmada. Ainda assim, 1 requisição HTTP por bloco é estritamente
// melhor que 1 por família (menos latência, menos superfície de falha), então mantém.
// ponytail: bloco de 100 sem limite documentado da API — mesmo tamanho do DEFAULT_BULK_COUNT
// do próprio SDK; sobe se algum lote legítimo passar disso.
export async function enfileirarEmBlocos<TJob, TMsg>(
  jobs: TJob[],
  montarMsg: (job: TJob) => TMsg,
  publicarBloco: PublicarBloco<TMsg>,
  tamanhoBloco = 100,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < jobs.length; i += tamanhoBloco) {
    const bloco = jobs.slice(i, i + tamanhoBloco);
    let respostas: { messageId: string }[];
    try {
      respostas = await publicarBloco(bloco.map(montarMsg));
    } catch (e) {
      // Blocos anteriores já publicaram de verdade (mensagem viva no QStash) — o caller
      // precisa saber quais pra não marcar 'erro' por cima de família que já está sendo
      // processada. `enfileirados` é o prefixo de `jobs` confirmado antes deste bloco falhar.
      const erro = e instanceof Error ? e : new Error(String(e));
      (erro as Error & { enfileirados?: TJob[] }).enfileirados = jobs.slice(0, i);
      throw erro;
    }
    // Corrupção silenciosa (messageId de uma família gravado em outra) é pior que falhar alto.
    if (respostas.length !== bloco.length) {
      const erro = new Error(`enfileirarEmBlocos: batch devolveu ${respostas.length} ids para ${bloco.length} jobs`);
      (erro as Error & { enfileirados?: TJob[] }).enfileirados = jobs.slice(0, i);
      throw erro;
    }
    ids.push(...respostas.map((r) => r.messageId));
  }
  return ids;
}
