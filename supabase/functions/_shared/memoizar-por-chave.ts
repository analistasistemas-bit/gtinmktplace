// Memoiza uma operação idempotente por chave, dentro da vida do isolate. Sem import
// Deno-específico, pra ser testável direto (queue.ts importa `npm:@upstash/qstash`, que o
// vitest do frontend não resolve).
//
// Motivação (03/08): `garantirFilaSerialCanal` faz `queue().upsert()` e é chamada 1x POR ITEM
// dentro dos loops — `publicar-familias` (por família × canal) e `despacharPushPendente` (até
// MAX_PAGINAS × TAMANHO_PAGINA = 1000 grupos numa execução do `reconciliar-estoque`) — sempre
// com o MESMO nome de fila. A doc da Upstash é explícita: `queues` está no grupo de endpoints
// COM rate limit por segundo (ao contrário de publish/batch/enqueue, que não têm), então
// repetir a mesma chamada N vezes era o candidato real a estourar limite.
//
// Guarda a Promise, não um booleano: chamadas concorrentes com a mesma chave compartilham o
// mesmo voo em vez de dispararem duas. Falha remove a entrada — o próximo chamador tenta de
// novo em vez de assumir uma garantia que nunca aconteceu.
export function memoizarPorChave(
  fn: (chave: string) => Promise<void>,
): (chave: string) => Promise<void> {
  const emVoo = new Map<string, Promise<void>>();
  return (chave: string): Promise<void> => {
    const existente = emVoo.get(chave);
    if (existente) return existente;
    const voo = fn(chave).catch((e) => {
      emVoo.delete(chave);
      throw e;
    });
    emVoo.set(chave, voo);
    return voo;
  };
}
