import type { ItemInventario, LeituraInventario } from './tipos-inventario';
import { dataHoraBR } from './cabecalho';

export const COLUNAS_LIVRO = ['Código', 'Descrição', 'NCM', 'Unidade', 'Cor', 'Tamanho', 'Quantidade', 'Qtd. avaliada', 'Custo médio unitário',
  'Valor total', 'Qtd. sem nota de compra', 'Marcas'];
export const COLUNAS_CONFERENCIA_INV = ['Código', 'Descrição', 'Sistema', 'Contada', 'Diferença', 'Justificativa', 'Marcas'];

const MARCAS_CONFERENCIA = ['saldo_negativo', 'historico_incompleto', 'ncm_ausente'];
const ms = (iso: string) => dataHoraBR(Date.parse(iso));

export function statusInventario(c: LeituraInventario['cabecalho']): string {
  if (c.status === 'hoje') return 'Inventário de hoje — não é foto, não confirmado';
  const dm = `${c.data_base.slice(8, 10)}/${c.data_base.slice(5, 7)}`;
  if (c.status === 'confirmado') return `Confirmado em ${c.confirmado_em ? ms(c.confirmado_em) : '—'} por ${c.confirmado_por_nome ?? '—'}`;
  if (c.status === 'aberto') return `Foto de ${dm} — aguardando contagem`;
  return `Foto de ${dm} — geração falhou`;
}

/** Valores do Livro: confirmado → *_final; aberto e hoje → foto/cálculo. A contagem em andamento nunca entra aqui. */
export interface LinhaLivro { item: ItemInventario; qtd: number; avaliada: number; semNota: number; valor: number }
export function linhasLivro(l: LeituraInventario): LinhaLivro[] {
  const conf = l.cabecalho.status === 'confirmado';
  return l.itens.map((item): LinhaLivro => conf
    ? { item, qtd: item.qtd_final ?? 0, avaliada: item.qtd_valorizada_final ?? 0, semNota: item.qtd_sem_nota_final ?? 0, valor: item.valor_final ?? 0 }
    : { item, qtd: item.quantidade_sistema, avaliada: item.qtd_valorizada, semNota: item.qtd_sem_nota, valor: item.valor_total })
    .filter((x) => x.qtd > 0);
}

export function totaisInventario(livro: LinhaLivro[]) {
  return {
    valor: livro.reduce((s, x) => s + Math.round(x.valor * 100), 0) / 100,
    avaliadas: livro.reduce((s, x) => s + x.avaliada, 0),
    semNota: livro.reduce((s, x) => s + x.semNota, 0),
  };
}

/** Divergências da contagem (inclusive as que terminam em zero) + SKUs marcados. Sempre 7 células, como COLUNAS_CONFERENCIA_INV. */
export function linhasConferenciaInv(l: LeituraInventario): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [];
  for (const i of l.itens) {
    const contada = i.quantidade_contada ?? null;
    const diverge = contada !== null && contada !== i.quantidade_sistema;
    if (!diverge && !i.marcas.some((m) => MARCAS_CONFERENCIA.includes(m))) continue;
    out.push([i.codigo, i.descricao ?? '', i.quantidade_sistema, contada ?? '', contada === null ? '' : contada - i.quantidade_sistema,
      i.justificativa ?? '', i.marcas.join(', ')]);
  }
  return out;
}

/** Bloco de texto do topo (xlsx e PDF): empresa, data-base, status e saldo lido. */
export function linhasCabecalhoInv(l: LeituraInventario): Array<[string, string]> {
  const c = l.cabecalho;
  return [['Razão social', c.razao_social ?? '—'], ['CNPJ', c.cnpj ?? '—'], ['IE', c.inscricao_estadual ?? '—'],
    ['Data-base', c.data_base.split('-').reverse().join('/')], ['Status', statusInventario(c)], ['Saldo lido em', ms(c.gerado_em)]];
}
