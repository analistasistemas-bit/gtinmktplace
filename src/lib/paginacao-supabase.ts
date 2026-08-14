/** Lê todas as páginas de uma query Supabase, evitando o teto padrão (~1000) do PostgREST.
 *  `pagina(de, ate)` deve aplicar `.range(de, ate)` e ser thenable resolvendo { data, error }. */
export async function buscarTodasPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < tamanho) break;
  }
  return todas;
}

/** Como `buscarTodasPaginas`, mas busca páginas 1+ em paralelo quando a primeira veio cheia. */
export async function buscarTodasPaginasParalelo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 1000,
  paralelismo = 5,
): Promise<T[]> {
  const { data, error } = await pagina(0, tamanho - 1);
  if (error) throw new Error(error.message);
  const primeira = data ?? [];
  if (primeira.length < tamanho) return primeira;

  const resto: T[] = [];
  let paginaBase = 1;
  for (;;) {
    const lotes = await Promise.all(
      Array.from({ length: paralelismo }, (_, i) => {
        const idx = paginaBase + i;
        return pagina(idx * tamanho, (idx + 1) * tamanho - 1);
      }),
    );
    let algumaCheia = false;
    for (const r of lotes) {
      if (r.error) throw new Error(r.error.message);
      const lote = r.data ?? [];
      if (lote.length === 0) return [...primeira, ...resto];
      resto.push(...lote);
      if (lote.length === tamanho) algumaCheia = true;
    }
    if (!algumaCheia) break;
    paginaBase += paralelismo;
  }
  return [...primeira, ...resto];
}
