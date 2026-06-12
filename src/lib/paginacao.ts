export interface ResultadoPaginacao<T> {
  itensPagina: T[];
  paginaAtual: number;
  totalPaginas: number;
  inicio: number;
  fim: number;
  total: number;
}

export function paginar<T>(itens: T[], pagina: number, tamanho: number): ResultadoPaginacao<T> {
  const total = itens.length;
  const tam = Math.max(1, Math.floor(tamanho));
  const totalPaginas = Math.max(1, Math.ceil(total / tam));
  const paginaAtual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas);
  const offset = (paginaAtual - 1) * tam;
  const itensPagina = itens.slice(offset, offset + tam);
  const inicio = total === 0 ? 0 : offset + 1;
  const fim = total === 0 ? 0 : offset + itensPagina.length;
  return { itensPagina, paginaAtual, totalPaginas, inicio, fim, total };
}
