// ADR-0181 — estado puro do assistente de importação (sem React).
import { cfopAceito, conciliarItens, custoAquisicaoUnit, quantidadeEmEstoque, erroDistribuicao } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { Vinculo } from '@/lib/notas-compra';

export type LinhaEstado = LinhaDistribuicao & { travada?: boolean };
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'vinculo' | 'gtin' | 'manual' | null; candidatosGtin: string[]; distribuicao: LinhaEstado[];
}
export interface EstadoImportacao {
  nota: NotaCompraLida; itens: ItemConciliado[]; xml: string;
  avisoTotal: string | null; divergenciaTotal: number; aceitarDivergencia: boolean; decisoes: DecisaoItem[];
}

const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export function recusaInicial(
  nota: NotaCompraLida, cnpjEmpresa: string, existente: { status: string; importadaEm: string } | null,
): string | null {
  if (nota.destinatarioCnpj.replace(/\D/g, '') !== cnpjEmpresa.replace(/\D/g, '')) {
    return 'O destinatário da nota não é o CNPJ desta empresa.';
  }
  const ruim = nota.itens.find((i) => !cfopAceito(i.cfop));
  if (ruim) return `Item ${ruim.nItem}: CFOP ${ruim.cfop} não é de venda/revenda — nota recusada.`;
  if (existente?.status === 'importada') return `Esta nota já foi importada em ${dataBR(existente.importadaEm)}.`;
  if (existente) return `Esta nota está ${existente.status} e não pode ser importada de novo.`;
  return null;
}

export function estadoInicial(
  nota: NotaCompraLida, xml: string, vinculos: Vinculo[], porGtin: Record<string, string[]>,
  previas: Array<{ nItem: number; codigo: string; quantidade: number; custo: number | null }> = [],
): EstadoImportacao {
  const conc = conciliarItens(nota);
  if (!conc.ok) throw new Error(conc.erro);
  const porCprod = new Map(vinculos.map((v) => [v.cprod, v]));
  const custoDefault = (nItem: number) => {
    const it = conc.itens.find((i) => i.nItem === nItem)!;
    return Math.round(custoAquisicaoUnit(it, porCprod.get(it.cProd)?.fator ?? 1) * 100) / 100;
  };
  const travadas = (nItem: number): LinhaEstado[] => previas.filter((p) => p.nItem === nItem)
    .map((p) => ({ codigo: p.codigo, quantidade: p.quantidade, travada: true,
      custoPrecificacao: p.custo !== null && p.custo > 0 ? p.custo : custoDefault(nItem) }));
  return {
    nota, itens: conc.itens, xml, avisoTotal: conc.avisoTotal,
    divergenciaTotal: conc.divergenciaTotal, aceitarDivergencia: false,
    decisoes: nota.itens.map((i) => {
      const base = { nItem: i.nItem, fator: 1, candidatosGtin: [] as string[], distribuicao: travadas(i.nItem) };
      const v = porCprod.get(i.cProd);
      if (v) return { ...base, codigoPai: v.codigoPai, fator: v.fator, origemVinculo: 'vinculo' as const };
      const cands = i.gtin ? (porGtin[i.gtin] ?? []) : [];
      if (cands.length === 1) return { ...base, codigoPai: cands[0], origemVinculo: 'gtin' as const };
      return { ...base, codigoPai: null, origemVinculo: null, candidatosGtin: cands };
    }),
  };
}

const mudar = (e: EstadoImportacao, nItem: number, f: (d: DecisaoItem) => DecisaoItem): EstadoImportacao =>
  ({ ...e, decisoes: e.decisoes.map((d) => (d.nItem === nItem ? f(d) : d)) });

const soTravadas = (l: LinhaEstado[]) => l.filter((x) => x.travada);
export const definirProduto = (e: EstadoImportacao, nItem: number, codigoPai: string) =>
  mudar(e, nItem, (d) => (d.codigoPai === codigoPai ? d
    : { ...d, codigoPai, origemVinculo: 'manual', candidatosGtin: [], distribuicao: soTravadas(d.distribuicao) }));
export const definirFator = (e: EstadoImportacao, nItem: number, fator: number) => mudar(e, nItem, (d) => ({ ...d, fator }));
// Linhas travadas (já no ledger) são sempre preservadas com SKU e quantidade; de uma linha recebida com o
// mesmo código só se aproveita o custo de precificação (R4-B1).
export const definirDistribuicao = (e: EstadoImportacao, nItem: number, linhas: LinhaDistribuicao[]) =>
  mudar(e, nItem, (d) => {
    const porCod = new Map(linhas.map((l) => [l.codigo, l]));
    const fixas = soTravadas(d.distribuicao).map((f) =>
      ({ ...f, custoPrecificacao: porCod.get(f.codigo)?.custoPrecificacao ?? f.custoPrecificacao }));
    const cods = new Set(fixas.map((f) => f.codigo));
    return { ...d, distribuicao: [...fixas, ...linhas.filter((l) => !cods.has(l.codigo))] };
  });
export const aceitarDivergencia = (e: EstadoImportacao, aceita: boolean): EstadoImportacao => ({ ...e, aceitarDivergencia: aceita });

export function pendencias(e: EstadoImportacao): Array<{ nItem: number; erro: string }> {
  const out: Array<{ nItem: number; erro: string }> = [];
  if (e.divergenciaTotal !== 0 && !e.aceitarDivergencia) {
    out.push({ nItem: 0, erro: `Confirme a divergência do total da nota (R$ ${e.divergenciaTotal.toFixed(2)}).` });
  }
  for (const d of e.decisoes) {
    const item = e.itens.find((i) => i.nItem === d.nItem)!;
    if (!d.codigoPai) {
      out.push({ nItem: d.nItem, erro: d.candidatosGtin.length > 1
        ? `O GTIN casa com ${d.candidatosGtin.length} produtos — escolha qual.` : 'Escolha ou cadastre o produto.' });
      continue;
    }
    const q = quantidadeEmEstoque(item.qCom, d.fator);
    if (!q.ok) { out.push({ nItem: d.nItem, erro: q.erro }); continue; }
    const err = erroDistribuicao(q.quantidade, d.distribuicao);
    if (err) out.push({ nItem: d.nItem, erro: err });
  }
  return out;
}

export function payload(e: EstadoImportacao): { xml: string; decisoes: DecisaoImportacao[]; aceitarDivergenciaTotal: boolean } {
  if (pendencias(e).length > 0) throw new Error('Há pendências na importação.');
  return {
    xml: e.xml, aceitarDivergenciaTotal: e.aceitarDivergencia,
    decisoes: e.decisoes.map((d) => ({
      nItem: d.nItem, codigoPai: d.codigoPai!, fator: d.fator,
      distribuicao: d.distribuicao.map(({ codigo, quantidade, custoPrecificacao }) => ({ codigo, quantidade, custoPrecificacao })),
    })),
  };
}

/** Linhas de partida da distribuição: com 1 SKU a quantidade vem preenchida (editável); com vários, zerada. */
export function linhasIniciais(skus: Array<{ codigo: string }>, quantidade: number, custo: number): LinhaDistribuicao[] {
  return skus.map((s) => ({ codigo: s.codigo, quantidade: skus.length === 1 ? quantidade : 0, custoPrecificacao: custo }));
}
