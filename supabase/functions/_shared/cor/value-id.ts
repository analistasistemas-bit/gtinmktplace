// Resolve a cor do cadastro contra o dicionário de COLOR da categoria (ADR-0026 / schema.ts).
//
// Por que existe (incidente 2026-09-20, grade de jaqueta): publicávamos COLOR só com
// `value_name` livre. O ML aceita, mas então *ele* decide: quando o nome bate com o dicionário,
// reescreve pela grafia dele ("Azul Marinho" → "Azul-marinho"); quando não bate, grava sem
// `value_id` e a cor fica fora dos filtros de cor da busca. Mandando `value_id` junto com o
// `value_name` do cadastro (validado contra a API real), a cor entra nos filtros E o anúncio
// mostra o nome que o operador cadastrou.
//
// Casamento por nome normalizado e EXATO: o dicionário do ML separa "Azul", "Azul-marinho" e
// "Azul-escuro", então prefixo/substring casaria cores diferentes — pior que não resolver.

/** minúsculas, sem acento, hífen vira espaço, espaços colapsados. Também é a chave de "mesma cor"
 *  do par cor × tamanho em `adicionar-variacoes-familia` e na tela de estender a grade. */
export function normalizarNomeCor(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `value_id` da cor no dicionário da categoria, ou null quando ela não existe lá. */
export function resolverCorValueId(
  cor: string | null | undefined,
  valores: readonly { id: string; nome: string }[],
): string | null {
  const alvo = normalizarNomeCor(cor ?? '');
  if (!alvo) return null;
  return valores.find((v) => normalizarNomeCor(v.nome) === alvo)?.id ?? null;
}
