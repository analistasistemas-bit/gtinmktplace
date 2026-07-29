/**
 * Lê todas as páginas de uma query, evitando o teto padrão (~1000 linhas) do PostgREST —
 * equivalente Deno de `buscarTodasPaginas` (src/lib/paginacao-supabase.ts). Sem isso, contas
 * com mais de 1000 linhas perdem registros silenciosamente.
 *
 * Espelha a `paginarTudo` privada de `_shared/faturamento/io.ts` (E6b, ADR-0094), que não
 * é exportada. Diferença deliberada: aqui o `error` do PostgREST é TRATADO — na versão do
 * io.ts um erro de página vira "acabou a lista" em silêncio, o que numa reconciliação (a
 * última rede de recuperação) esconderia justamente o que ela existe para achar.
 *
 * A cópia do io.ts foi deixada como está de propósito: fazê-la lançar mudaria a semântica
 * de erro de um caminho financeiro em produção sem teste que cubra isso. Unificar as duas
 * é follow-up, não parte deste épico.
 */
export async function paginarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw new Error(`paginarTudo: falha na página ${de}: ${error.message}`);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < tamanho) break;
  }
  return todas;
}
