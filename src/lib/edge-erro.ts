// `supabase.functions.invoke` NÃO popula `data` em resposta não-2xx — o corpo fica em
// `error.context`. Sem estes helpers, toda mensagem das edges (validação, 403 de módulo,
// 409 de duplicata) chega na tela como um erro genérico inútil.
//
// ATENÇÃO: `Response.json()` só pode ser consumido UMA vez. Quem precisa dos campos do
// corpo usa `corpoDoErroDaEdge` e decide a partir do resultado — nunca as duas funções
// para o mesmo erro.

/** Extrai a mensagem real do corpo de erro de uma edge; devolve o Error a lançar. */
export async function erroDaEdge(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== 'function') {
    return error instanceof Error ? error : new Error(String(error));
  }
  const corpo = await ctx.json().catch(() => ({})) as {
    error?: string; erros?: Array<{ campo: string; mensagem: string }>;
  };
  if (corpo.erros?.length) return new Error(corpo.erros.map((e) => e.mensagem).join('\n'));
  if (corpo.error) return new Error(corpo.error);
  return error instanceof Error ? error : new Error(String(error));
}

/** Lê o corpo de erro bruto — para quem precisa dos campos (ex.: o 409 com familiaId). */
export async function corpoDoErroDaEdge(
  error: unknown,
): Promise<{ status: number; corpo: Record<string, unknown> } | null> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  return { status: ctx.status, corpo: await ctx.json().catch(() => ({})) as Record<string, unknown> };
}
