/**
 * Grava snapshot do vendedor só quando algo que nos interessa mudou (ou na 1ª vez).
 *
 * A UF entra na decisão junto com o volume: sem isso, um vendedor de volume estável nunca ganharia
 * uma linha nova e ficaria para sempre sem estado na tela, esperando uma venda que pode demorar.
 * Incluí-la faz um backfill único (o guardado é null, o novo não é) e depois se estabiliza — se o
 * ML não expuser o endereço, os dois lados ficam null e nada é regravado.
 */
export function deveGravarVendedor(
  anterior: { transactions_total: number | null; uf?: string | null } | null,
  atualTotal: number | null,
  atualUf: string | null = null,
): boolean {
  if (anterior == null) return true;
  if (anterior.transactions_total !== atualTotal) return true;
  return (anterior.uf ?? null) !== atualUf;
}

/**
 * UF do vendedor a partir de `/users/{id}`. O ML devolve o estado em `address.state` no formato
 * ISO `BR-SP`; aceitamos também a sigla crua, porque o formato já variou entre respostas.
 *
 * Só devolve duas letras: qualquer outra coisa (nome por extenso, país, string vazia) vira `null`.
 * Uma coluna "Estado" com "São Paulo" numa linha e "SP" na outra é pior do que uma célula vazia —
 * quebra o alinhamento da tabela e não dá para comparar de bater o olho.
 */
export function ufDoVendedor(json: unknown): string | null {
  const estado = (json as { address?: { state?: unknown } } | null)?.address?.state;
  if (typeof estado !== 'string') return null;
  const sigla = estado.trim().toUpperCase().replace(/^BR-/, '');
  return /^[A-Z]{2}$/.test(sigla) ? sigla : null;
}
