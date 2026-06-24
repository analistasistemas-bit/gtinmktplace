import type { ReportData, ExportConfig, ExportFormato } from './tipos';
import { gerarPdf } from './pdf';
import { gerarExcel } from './excel';

export * from './tipos';
export { gerarPdf } from './pdf';
export { gerarExcel, montarWorkbook } from './excel';

function slug(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Nome de arquivo: <slug-do-titulo>-<AAAA-MM-DD>.<ext> */
export function nomeArquivo(titulo: string, ext: 'pdf' | 'xlsx', data: Date = new Date()): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${slug(titulo)}-${ano}-${mes}-${dia}.${ext}`;
}

/**
 * Exporta o relatório no formato escolhido.
 * O adapter da tela já preencheu `data` respeitando expandido/incluirKpis;
 * aqui só decidimos o destino (download PDF/Excel ou abrir PDF p/ impressão).
 */
export function exportar(data: ReportData, config: ExportConfig | ExportFormato): void {
  const formato = typeof config === 'string' ? config : config.formato;

  if (formato === 'excel') {
    gerarExcel(data, nomeArquivo(data.titulo, 'xlsx'));
    return;
  }

  const doc = gerarPdf(data);
  if (formato === 'pdf') {
    doc.save(nomeArquivo(data.titulo, 'pdf'));
    return;
  }

  // imprimir: abre o PDF num visualizador limpo (nunca window.print() da tela)
  const url = URL.createObjectURL(doc.output('blob'));
  const aba = window.open(url, '_blank');
  // libera a URL quando a aba carregar (ou após um tempo, se popup bloqueado)
  if (aba) {
    aba.addEventListener?.('load', () => URL.revokeObjectURL(url));
  } else {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
