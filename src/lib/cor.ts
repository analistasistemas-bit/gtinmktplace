// Compara duas variações pelo nome da cor (cai no código quando sem cor), em ordem
// alfabética pt-BR: case/acento-insensível e com sufixo numérico natural (ex.: "Azul 2"
// antes de "Azul 10"). Espelha `ordenarCoresAlfabetica` do backend (descrição do ML).
export function compararCor(
  a: { cor: string | null; codigo: string },
  b: { cor: string | null; codigo: string },
): number {
  return (a.cor || a.codigo).localeCompare(b.cor || b.codigo, 'pt-BR', {
    sensitivity: 'base',
    numeric: true,
  });
}
