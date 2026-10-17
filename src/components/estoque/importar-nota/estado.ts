// ADR-0181 — estado puro do assistente de importação (sem React).
import { cfopAceito, conciliarItens, custoAquisicaoUnit, quantidadeEmEstoque, erroDistribuicao } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { Vinculo } from '@/lib/notas-compra';

// codigoPai: só do front (SKU de outro produto, D-7) — para invalidar o cache; payload() não o envia.
export type LinhaEstado = LinhaDistribuicao & { travada?: boolean; codigoPai?: string };
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'nota' | 'vinculo' | 'gtin' | 'manual' | null; candidatosGtin: string[]; candidatosNota: string[];
  distribuicao: LinhaEstado[];
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
      const v = porCprod.get(i.cProd);
      const cands = i.gtin ? (porGtin[i.gtin] ?? []) : [];
      const base = { nItem: i.nItem, fator: 1, candidatosGtin: cands, candidatosNota: [] as string[], distribuicao: travadas(i.nItem) };
      if (v) return { ...base, codigoPai: v.codigoPai, fator: v.fator, origemVinculo: 'vinculo' as const };
      if (cands.length === 1) return { ...base, codigoPai: cands[0], origemVinculo: 'gtin' as const };
      return { ...base, codigoPai: null, origemVinculo: null };
    }),
  };
}

const mudar = (e: EstadoImportacao, nItem: number, f: (d: DecisaoItem) => DecisaoItem): EstadoImportacao =>
  ({ ...e, decisoes: e.decisoes.map((d) => (d.nItem === nItem ? f(d) : d)) });

const soTravadas = (l: LinhaEstado[]) => l.filter((x) => x.travada);
// Escolha explícita é sempre `manual` (nada automático a sobrescreve depois); com o mesmo código só marca.
export const definirProduto = (e: EstadoImportacao, nItem: number, codigoPai: string) =>
  mudar(e, nItem, (d) => (d.codigoPai === codigoPai ? { ...d, origemVinculo: 'manual' }
    : { ...d, codigoPai, origemVinculo: 'manual', distribuicao: soTravadas(d.distribuicao) }));

/** Produtos já cadastrados DESTA nota (refNota) superam vínculo/GTIN; escolha `manual` nunca é tocada. */
export function aplicarCadastradosDaNota(
  e: EstadoImportacao, lista: Array<{ nItem: number; codigosPai: string[] }>,
): EstadoImportacao {
  return {
    ...e,
    decisoes: e.decisoes.map((d) => {
      const cods = lista.find((x) => x.nItem === d.nItem)?.codigosPai ?? [];
      if (d.origemVinculo === 'manual' || cods.length === 0) return d;
      if (cods.length > 1) return { ...d, codigoPai: null, origemVinculo: null, candidatosNota: cods, distribuicao: soTravadas(d.distribuicao) };
      if (d.codigoPai === cods[0]) return { ...d, origemVinculo: 'nota', candidatosNota: [] };
      return { ...d, codigoPai: cods[0], origemVinculo: 'nota', candidatosNota: [], distribuicao: soTravadas(d.distribuicao) };
    }),
  };
}

export function itemPronto(e: EstadoImportacao, d: DecisaoItem): boolean {
  const item = e.itens.find((i) => i.nItem === d.nItem);
  return !!d.codigoPai && !!item && quantidadeEmEstoque(item.qCom, d.fator).ok;
}
export const contarProntos = (e: EstadoImportacao) => ({ prontos: e.decisoes.filter((d) => itemPronto(e, d)).length, total: e.decisoes.length });
// Fator novo muda quantidade e custo por unidade: as linhas não travadas (calculadas com o fator antigo) saem
// e o semear recalcula o default. As travadas (já no ledger) ficam — mesma regra de definirProduto.
export const definirFator = (e: EstadoImportacao, nItem: number, fator: number) =>
  mudar(e, nItem, (d) => (d.fator === fator ? d : { ...d, fator, distribuicao: soTravadas(d.distribuicao) }));
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

/** D-8: "Falta um tamanho/cor?" — só produto publicado ganha SKU novo, e só por admin (ADR-0129). */
export const acaoVariacaoFaltante = (p: { publicado: boolean }, isAdmin: boolean) =>
  (!p.publicado ? 'recusar-nao-publicado' : isAdmin ? 'adicionar-publicado' : 'pedir-admin') as
    'adicionar-publicado' | 'pedir-admin' | 'recusar-nao-publicado';

/** D-8: SKU criado com a ref da nota já está no ledger — entra travado (substitui o mesmo código). */
export const travarLinhaNova = (e: EstadoImportacao, nItem: number, codigo: string, quantidade: number, custo: number) =>
  mudar(e, nItem, (d) => ({
    ...d,
    distribuicao: [...d.distribuicao.filter((l) => l.codigo !== codigo), { codigo, quantidade, custoPrecificacao: custo, travada: true }],
  }));

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

/** Por que o "Avançar" está travado (null = livre). Produtos exige produto e fator válidos; Distribuição,
 *  a soma exata (D-2). O texto vai para o rodapé — a trava nunca fica muda. */
export function motivoBloqueioEtapa(e: EstadoImportacao, etapa: number): string | null {
  if (etapa === 1) {
    for (const d of e.decisoes) {
      if (itemPronto(e, d)) continue;
      if (!d.codigoPai) return `Item ${d.nItem}: escolha ou cadastre o produto.`;
      const q = quantidadeEmEstoque(e.itens.find((i) => i.nItem === d.nItem)!.qCom, d.fator);
      return `Item ${d.nItem}: ${q.ok ? 'quantidade inválida.' : q.erro}`;
    }
  }
  if (etapa === 2) {
    const p = pendencias(e).find((x) => x.nItem !== 0);
    if (p) return `Item ${p.nItem}: ${p.erro}`;
  }
  return null;
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

/**
 * Buffer da etapa Distribuição ao montar: o que já foi salvo no estado manda (quantidade, custo, SKU de
 * outro produto); `linhasIniciais` só vale quando ainda não há nenhuma linha salva.
 */
export function semearDistribuicao(
  skus: Array<{ codigo: string }>, salva: LinhaEstado[], quantidade: number, custo: number,
): LinhaEstado[] {
  if (salva.length === 0) return linhasIniciais(skus, quantidade, custo);
  const porCod = new Map(salva.map((l) => [l.codigo, l]));
  const doProduto = new Set(skus.map((s) => s.codigo));
  return [
    ...skus.map((s) => porCod.get(s.codigo) ?? { codigo: s.codigo, quantidade: 0, custoPrecificacao: custo }),
    ...salva.filter((l) => !doProduto.has(l.codigo)),
  ];
}
