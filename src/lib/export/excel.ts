import * as XLSX from 'xlsx';
import type { ReportData, Celula, Coluna } from './tipos';

interface OpcoesWorkbook {
  /** Inclui as sublinhas (conteúdo expandido) abaixo de cada linha-pai. Default true. */
  incluirSublinhas?: boolean;
}

type Aoa = Array<Array<string | number | null>>;

function valoresLinha(colunas: Coluna[], celulas: Celula): Array<string | number | null> {
  return colunas.map((c) => celulas[c.chave] ?? '');
}

/** Monta o workbook em memória (puro, testável sem download). */
export function montarWorkbook(data: ReportData, opcoes: OpcoesWorkbook = {}): XLSX.WorkBook {
  const incluirSublinhas = opcoes.incluirSublinhas ?? true;
  const wb = XLSX.utils.book_new();

  // --- Aba Resumo: título, período, filtros e KPIs ---
  const resumo: Aoa = [[data.titulo]];
  if (data.periodo) resumo.push(['Período', data.periodo]);
  if (data.filtros?.length) resumo.push(['Filtros', data.filtros.join('; ')]);
  if (data.kpis?.length) {
    resumo.push([]);
    resumo.push(['Indicador', 'Valor']);
    for (const k of data.kpis) resumo.push([k.label, k.valor]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');

  // --- Aba Dados: tabela principal (+ sublinhas indentadas) ---
  const dados: Aoa = [data.colunas.map((c) => c.titulo)];
  for (const linha of data.linhas) {
    dados.push(valoresLinha(data.colunas, linha.celulas));
    if (incluirSublinhas && linha.sublinhas) {
      const { colunas: subCols, linhas: subLinhas } = linha.sublinhas;
      dados.push(['  ↳', ...subCols.map((c) => c.titulo)]);
      for (const sl of subLinhas) {
        dados.push(['', ...valoresLinha(subCols, sl)]);
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dados), 'Dados');

  return wb;
}

/** Gera e baixa o arquivo .xlsx. */
export function gerarExcel(data: ReportData, nome: string, opcoes: OpcoesWorkbook = {}): void {
  const wb = montarWorkbook(data, opcoes);
  XLSX.writeFile(wb, nome);
}
