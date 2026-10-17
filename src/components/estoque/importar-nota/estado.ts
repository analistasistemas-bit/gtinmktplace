// ADR-0181 — estado puro do assistente de importação (sem React).
import { cfopAceito, conciliarItens, custoAquisicaoUnit, quantidadeEmEstoque, erroDistribuicao } from '../../../../supabase/functions/_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { SugestaoDistribuicao, Vinculo } from '@/lib/notas-compra';

// codigoPai: só do front (SKU de outro produto, D-7) — para invalidar o cache; payload() não o envia.
// sugerida: veio da sugestão do cadastro pela nota — o custo é recalculado ao semear a etapa 3 (custoPadraoSku).
export type LinhaEstado = LinhaDistribuicao & { travada?: boolean; codigoPai?: string; sugerida?: boolean };
export interface DecisaoItem {
  nItem: number; codigoPai: string | null; fator: number;
  origemVinculo: 'nota' | 'vinculo' | 'gtin' | 'manual' | null; candidatosGtin: string[]; candidatosNota: string[];
  distribuicao: LinhaEstado[];
  /** Por que a sugestão do cadastro não entrou inteira (fator mudou / SKU não existe mais). */
  avisoSugestao?: string | null;
}
export const AVISO_FATOR_MUDOU = 'Sugestão do cadastro descartada: fator da nota mudou';
export const AVISO_SKU_SUMIU = 'Parte da sugestão é de SKUs que não existem mais — redistribua';
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
    : { ...d, codigoPai, origemVinculo: 'manual', distribuicao: soTravadas(d.distribuicao), avisoSugestao: null }));

/** Semeia a sugestão (linhas `sugerida`) por cima das travadas, que sempre vencem. O custo é só um
 *  placeholder seguro (custo da nota com o fator da sugestão) — a etapa 3 recalcula por SKU.
 *  `codigosValidos` (SKUs canônicos atuais): código fora dela é descartado com aviso. */
function semearSugestao(e: EstadoImportacao, d: DecisaoItem, s: SugestaoDistribuicao, codigosValidos?: string[]): DecisaoItem {
  const item = e.itens.find((i) => i.nItem === d.nItem)!;
  const custo = Math.round(custoAquisicaoUnit(item, s.fator) * 100) / 100;
  const fixas = soTravadas(d.distribuicao);
  const travados = new Set(fixas.map((f) => f.codigo));
  const validas = codigosValidos ? s.linhas.filter((l) => codigosValidos.includes(l.codigo)) : s.linhas;
  return {
    ...d, fator: s.fator, avisoSugestao: validas.length < s.linhas.length ? AVISO_SKU_SUMIU : null,
    distribuicao: [...fixas, ...validas.filter((l) => !travados.has(l.codigo))
      .map((l) => ({ codigo: l.codigo, quantidade: l.quantidade, custoPrecificacao: custo, sugerida: true }))],
  };
}

/** Produtos já cadastrados DESTA nota (refNota) superam vínculo/GTIN; escolha `manual` nunca é tocada.
 *  Com um só produto e sugestão gravada, semeia a distribuição — só se não há linha não travada (edição
 *  do operador / SKU de outro produto); vínculo com fator diferente descarta a sugestão com aviso. */
export function aplicarCadastradosDaNota(
  e: EstadoImportacao,
  lista: Array<{ nItem: number; codigosPai: string[]; sugestao?: SugestaoDistribuicao | null; codigosValidos?: string[] }>,
): EstadoImportacao {
  return {
    ...e,
    decisoes: e.decisoes.map((d) => {
      const x = lista.find((y) => y.nItem === d.nItem);
      const cods = x?.codigosPai ?? [];
      if (d.origemVinculo === 'manual' || cods.length === 0) return d;
      if (cods.length > 1) return { ...d, codigoPai: null, origemVinculo: null, candidatosNota: cods, distribuicao: soTravadas(d.distribuicao), avisoSugestao: null };
      const novo: DecisaoItem = d.codigoPai === cods[0] ? { ...d, origemVinculo: 'nota', candidatosNota: [] }
        : { ...d, codigoPai: cods[0], origemVinculo: 'nota', candidatosNota: [], distribuicao: soTravadas(d.distribuicao) };
      const s = x?.sugestao;
      if (!s || novo.distribuicao.some((l) => !l.travada)) return novo;
      if (d.origemVinculo === 'vinculo' && d.fator !== s.fator) return { ...novo, avisoSugestao: AVISO_FATOR_MUDOU };
      return semearSugestao(e, novo, s, x?.codigosValidos);
    }),
  };
}

/** Sessão (`aoCadastrar`): aplica a sugestão que a edge acabou de gravar — códigos recém-gerados, sem
 *  validar. Fator diferente do que o item tem agora ⇒ descarta com aviso. Sem sugestão: estado igual. */
export function aplicarSugestaoCadastro(
  e: EstadoImportacao, nItem: number, s: SugestaoDistribuicao | null | undefined,
): EstadoImportacao {
  if (!s) return e;
  return mudar(e, nItem, (d) => (d.fator !== s.fator ? { ...d, avisoSugestao: AVISO_FATOR_MUDOU } : semearSugestao(e, d, s)));
}

export function itemPronto(e: EstadoImportacao, d: DecisaoItem): boolean {
  const item = e.itens.find((i) => i.nItem === d.nItem);
  return !!d.codigoPai && !!item && quantidadeEmEstoque(item.qCom, d.fator).ok;
}
export const contarProntos = (e: EstadoImportacao) => ({ prontos: e.decisoes.filter((d) => itemPronto(e, d)).length, total: e.decisoes.length });
// Fator novo muda quantidade e custo por unidade: as linhas não travadas (calculadas com o fator antigo) saem
// e o semear recalcula o default. As travadas (já no ledger) ficam — mesma regra de definirProduto.
export const definirFator = (e: EstadoImportacao, nItem: number, fator: number) =>
  mudar(e, nItem, (d) => (d.fator === fator ? d : { ...d, fator, distribuicao: soTravadas(d.distribuicao), avisoSugestao: null }));
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

/** ADR-0181 D-9 (emenda 2026-10-17): custo padrão do SKU na etapa 3. O custo cadastrado
 *  (`variacoes.custo`, sem arredondar) só vale com prova positiva de 1ª entrada do produto e saldo 0;
 *  qualquer outro caso (recompra, planilha, manual, consulta falhou) = custo de aquisição da nota. */
export function custoPadraoSku(
  sku: { custo: number | null; saldo: number }, produtoNuncaTeveEstoque: boolean, custoNota: number,
): number {
  return produtoNuncaTeveEstoque && sku.saldo === 0 && sku.custo != null && sku.custo > 0 ? sku.custo : custoNota;
}

type SkuSemente = { codigo: string; custo?: number | null; estoque?: number };
const custoDoSku = (s: SkuSemente, prova: boolean, custo: number) =>
  custoPadraoSku({ custo: s.custo ?? null, saldo: s.estoque ?? 0 }, prova, custo);

/** Linhas de partida da distribuição: com 1 SKU a quantidade vem preenchida (editável); com vários, zerada. */
export function linhasIniciais(skus: SkuSemente[], quantidade: number, custo: number, prova = false): LinhaDistribuicao[] {
  return skus.map((s) => ({ codigo: s.codigo, quantidade: skus.length === 1 ? quantidade : 0, custoPrecificacao: custoDoSku(s, prova, custo) }));
}

/**
 * Buffer da etapa Distribuição ao montar: o que já foi salvo no estado manda (quantidade, custo, SKU de
 * outro produto); `linhasIniciais` só vale quando ainda não há nenhuma linha salva.
 */
export function semearDistribuicao(
  skus: SkuSemente[], salva: LinhaEstado[], quantidade: number, custo: number, prova = false,
): LinhaEstado[] {
  if (salva.length === 0) return linhasIniciais(skus, quantidade, custo, prova);
  const porCod = new Map(salva.map((l) => [l.codigo, l]));
  const doProduto = new Set(skus.map((s) => s.codigo));
  return [
    ...skus.map((s) => {
      const l = porCod.get(s.codigo);
      if (!l) return { codigo: s.codigo, quantidade: 0, custoPrecificacao: custoDoSku(s, prova, custo) };
      // Sugestão do cadastro: quantidade dela, custo pelo SKU (o do estado é só placeholder).
      return l.sugerida ? { codigo: l.codigo, quantidade: l.quantidade, custoPrecificacao: custoDoSku(s, prova, custo) } : l;
    }),
    // Sugerida fora do produto nunca vira "SKU de outro produto".
    ...salva.filter((l) => !doProduto.has(l.codigo) && !l.sugerida),
  ];
}
