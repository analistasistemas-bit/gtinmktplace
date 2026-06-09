/** Ordena os nomes de cor em ordem alfabética pt-BR (case/acento-insensível na
 *  comparação, mas preservando os nomes), com ordenação numérica natural do
 *  sufixo (ex.: "Azul 9" antes de "Azul 10"). Não muta a entrada. */
export function ordenarCoresAlfabetica(cores: string[]): string[] {
  return [...cores].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true })
  );
}
