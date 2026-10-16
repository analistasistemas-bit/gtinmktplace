// ADR-0181 Plano 2a — relatório de vendas (xlsx). Chave/número/série como texto; valores em reais (2 casas).
import * as XLSX from 'xlsx';
import { totaisPorGrupo, rotuloTipo, rotuloStatus, type LeituraPacote } from './tipos';
import { dataHoraBR, linhasConferencia, reais, type Cabecalho } from './cabecalho';

const CABECALHO = ['Data de emissão', 'Tipo', 'Status', 'Número', 'Série', 'Chave', 'Produtos', 'Frete', 'Desconto', 'Total', 'Carta de correção'];

export function gerarRelatorioXlsx(l: LeituraPacote, cab: Cabecalho): Uint8Array {
  const c = l.conferencia;
  const aoa: Array<Array<string | number>> = [];
  if (c.parcial) aoa.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`], []);
  aoa.push([`Relatório de vendas · ${cab.org} · ${c.mes}`], [], CABECALHO);
  for (const n of l.notas) {
    aoa.push([dataHoraBR(n.instante), rotuloTipo(n.tipo), rotuloStatus(n.status), n.numero, n.serie, n.chave,
      reais(n.produtosC), reais(n.freteC), reais(n.descontoC), reais(n.totalC), n.cartaCorrecao ? 'sim' : '']);
  }
  aoa.push([], ['Grupo', 'Quantidade', 'Produtos', 'Frete', 'Desconto', 'Total']);
  for (const t of totaisPorGrupo(l.notas)) {
    aoa.push([t.grupo, t.quantidade, reais(t.produtosC), reais(t.freteC), reais(t.descontoC), reais(t.totalC)]);
  }
  const vendas = XLSX.utils.aoa_to_sheet(aoa);   // strings viram células 't: s' — chave de 44 dígitos fica texto
  for (const ref of Object.keys(vendas)) {
    if (ref.startsWith('!')) continue;
    const cel = vendas[ref] as XLSX.CellObject;
    if (cel.t === 'n' && !Number.isInteger(cel.v)) cel.z = '#,##0.00';
  }
  vendas['!cols'] = [{ wch: 16 }, { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 6 }, { wch: 46 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];

  const conf = XLSX.utils.aoa_to_sheet(linhasConferencia(l, cab));
  conf['!cols'] = [{ wch: 60 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, vendas, 'Vendas');
  XLSX.utils.book_append_sheet(wb, conf, 'Conferência');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
