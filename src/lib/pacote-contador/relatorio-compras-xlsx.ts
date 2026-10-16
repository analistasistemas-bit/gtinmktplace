// ADR-0181 Plano 2b-1 — relatório de compras (xlsx): uma linha por item; totais por nota (ICMSTot) e do mês.
import * as XLSX from 'xlsx';
import type { LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';
import { linhasConferenciaCompras } from './cabecalho-compras';

export const COLUNAS_COMPRAS = ['Data de emissão', 'Data de importação', 'Fornecedor', 'CNPJ', 'Número', 'Série', 'Chave', 'Finalidade',
  'Nº item', 'Código do fornecedor', 'Descrição', 'NCM', 'CFOP', 'Tipo trib.', 'Código trib.', 'Quantidade', 'Unidade',
  'Produtos', 'Frete', 'Seguro', 'Desconto', 'Outras', 'IPI', 'ST', 'FCP-ST'];
const COL_QTD = 15;
const DINHEIRO_ITEM = [17, 18, 19, 20, 21, 22, 23, 24];
export const COLUNAS_TOTAIS = ['Chave', 'Número', 'Fornecedor', 'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST', 'vFCPST', 'vNF', 'Diferença', 'Divergência aceita'];

export function gerarRelatorioComprasXlsx(l: LeituraCompras, cab: Cabecalho): Uint8Array {
  const c = l.conferencia;
  const aoa: Array<Array<string | number>> = [];
  const formatar: Array<{ r: number; c: number; z: string }> = [];
  if (c.parcial) aoa.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`], []);
  aoa.push([`Relatório de compras · ${cab.org} · ${c.mes}`], [], COLUNAS_COMPRAS);
  for (const x of l.linhas) {
    const r = aoa.length;
    aoa.push([dataHoraBR(x.instante), dataHoraBR(Date.parse(x.importacao)), x.fornecedor, x.cnpj, x.numero, x.serie, x.chave, x.finalidade,
      x.nItem, x.cProd, x.xProd, x.ncm, x.cfop, x.tribTipo || 'não informado', x.tribCodigo, x.qCom, x.uCom,
      reais(x.produtosC), reais(x.freteC), reais(x.seguroC), reais(x.descontoC), reais(x.outrasC), reais(x.ipiC), reais(x.stC), reais(x.fcpstC)]);
    for (const k of DINHEIRO_ITEM) formatar.push({ r, c: k, z: '#,##0.00' });
    formatar.push({ r, c: COL_QTD, z: '#,##0.####' });
  }
  aoa.push([], ['Totais por nota (do ICMSTot)'], COLUNAS_TOTAIS);
  for (const t of l.totaisNota) {
    const r = aoa.length;
    aoa.push([t.chave, t.numero, t.fornecedor, reais(t.vProdC), reais(t.vFreteC), reais(t.vSegC), reais(t.vDescC), reais(t.vOutroC),
      reais(t.vIPIC), reais(t.vSTC), reais(t.vFCPSTC), reais(t.vNFC), reais(t.diferencaC), t.divergenciaAceitaC == null ? '' : reais(t.divergenciaAceitaC)]);
    for (let k = 3; k <= 13; k++) formatar.push({ r, c: k, z: '#,##0.00' });
  }
  aoa.push([]);
  formatar.push({ r: aoa.length, c: 1, z: '#,##0.00' });
  aoa.push(['Total do mês', reais(c.totalMesC)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);   // strings → 't: s' (chave, NCM, CFOP, CNPJ ficam texto)
  for (const f of formatar) {
    const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })] as XLSX.CellObject | undefined;
    if (cel?.t === 'n') cel.z = f.z;
  }
  const conf = XLSX.utils.aoa_to_sheet(linhasConferenciaCompras(l, cab));
  conf['!cols'] = [{ wch: 60 }, { wch: 80 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência de compras');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
