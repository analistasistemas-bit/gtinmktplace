// Limitador de concorrência da galeria (sem dependência: roda igual na edge e no vitest).

/** Cores trabalhadas ao mesmo tempo (vigência no Storage/banco/ML e elegibilidade no ML). */
export const CORES_POR_VEZ = 6;

/**
 * `fn` em até `limite` itens por vez; resultados na ordem de entrada. Depois de uma exceção não inicia itens novos,
 * espera os que estão em voo e lança a do menor índice (a mesma que um laço sequencial lançaria primeiro).
 */
export async function emParalelo<T, R>(itens: readonly T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const res = new Array<R>(itens.length);
  const erros: Array<{ i: number; e: unknown }> = [];
  let prox = 0;
  const vaga = async () => {
    while (prox < itens.length && erros.length === 0) {
      const i = prox++;
      try { res[i] = await fn(itens[i], i); } catch (e) { erros.push({ i, e }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, vaga));
  if (erros.length > 0) throw erros.sort((a, b) => a.i - b.i)[0].e;
  return res;
}
