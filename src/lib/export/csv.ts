import type { ReportData } from './tipos';

function escapar(valor: string | number | null | undefined): string {
  const texto = valor == null ? '' : String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Serializa a tabela principal como CSV RFC 4180 com BOM para Excel. */
export function serializarCsv(data: ReportData): string {
  const linhas = [
    data.colunas.map((coluna) => escapar(coluna.titulo)).join(','),
    ...data.linhas.map((linha) => (
      data.colunas.map((coluna) => escapar(linha.celulas[coluna.chave])).join(',')
    )),
  ];
  return `\uFEFF${linhas.join('\r\n')}`;
}

/** Gera e baixa o arquivo .csv. */
export function gerarCsv(data: ReportData, nome: string): void {
  const blob = new Blob([serializarCsv(data)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}
