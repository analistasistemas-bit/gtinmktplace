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
