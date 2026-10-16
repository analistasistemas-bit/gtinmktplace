import { AVISOS_COMPRAS, type LeituraCompras } from './tipos-compras';
import { dataHoraBR, reais, type Cabecalho } from './cabecalho';

const brl = (c: number) => reais(c).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quando = (iso: string | null) => (iso ? dataHoraBR(Date.parse(iso)) : '—');

/** Linhas da Conferência de compras. Sempre [rótulo, valor] (o PDF depende das 2 colunas). */
export function linhasConferenciaCompras(l: LeituraCompras, cab: Cabecalho): Array<[string, string]> {
  const c = l.conferencia;
  const out: Array<[string, string]> = [];
  if (c.parcial) out.push([`PACOTE PARCIAL — ${c.motivosParcial.join('; ')}`, '']);
  out.push(['Organização', cab.org], ['CNPJ', cab.cnpj ?? '—'], ['Mês', c.mes], ['Gerado em', dataHoraBR(cab.geradoEm.getTime())],
    ['Notas selecionadas no mês', String(c.selecionadas)], ['Notas detalhadas', String(c.detalhadas)], ['Itens', String(c.itens)],
    ['Notas desfeitas', String(c.desfeitas.length)], ['Notas marcadas canceladas', String(c.canceladas.length)], ['Notas com falha', String(c.comFalha)],
    ['Total do mês (notas detalhadas)', brl(c.totalMesC)]);
  if (c.totalSemDetalheC) out.push(['Total das notas sem detalhe (valor registrado na importação)', brl(c.totalSemDetalheC)]);
  if (c.vazio) out.push(['Nenhuma nota de compra no mês', '']);
  for (const a of AVISOS_COMPRAS) out.push([a, '']);
  const secao = (titulo: string, itens: Array<[string, string]>) => { if (itens.length) out.push(['', ''], [titulo, ''], ...itens); };
  secao('Notas desfeitas (fora da planilha e dos totais)', c.desfeitas.map((d) => [d.chave, `nº ${d.numero} · ${d.fornecedor} · desfeita no PubliAI em ${quando(d.em)}${d.comXml ? '' : ' · sem XML'}`]));
  secao('Notas marcadas canceladas (fora da planilha e dos totais)', c.canceladas.map((d) => [d.chave, `nº ${d.numero} · ${d.fornecedor} · marcada cancelada no PubliAI em ${quando(d.em)}${d.comXml ? '' : ' · sem XML'}`]));
  secao('Cópias sem assinatura digital', c.semAssinatura.map((ch) => [ch, '']));
  secao('Finalidade diferente de normal (finNFe ≠ 1)', c.finalidadeAtipica.map((f) => [f.chave, `finNFe ${f.finNFe}`]));
  secao('XML indisponível', c.indisponiveis.map((x) => [x.chave, x.motivo]));
  secao('Integridade não comprovada (sem hash registrado)', c.semHash.map((ch) => [ch, '']));
  secao('XML diferente do importado', c.divergentes.map((ch) => [ch, '']));
  secao('XML ilegível (incluído no pacote)', c.ilegiveis.map((x) => [x.chave, x.erro]));
  return out;
}
