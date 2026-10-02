// Agregador geográfico de vendas por UF/cidade (ADR-0039 — Fase 2b Geografia).
// Puro e testável: recebe Pedido[] e devolve GeografiaVendas sem I/O.
import type { Pedido } from './pedidos-faturamento';
import { round2 } from './formato';

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface UfAgregado {
  uf: string;
  pedidos: number;
  unidades: number;
  valor: number;
  pctPedidos: number;
  /** % do valor faturável total (com UF), 1 casa. */
  pctValor: number;
  ticketMedio: number;
  /** Frete do vendedor por pedido (pedido sem frete conta como 0). */
  freteMedio: number;
  /** (Σ líquido − Σ custo) ÷ Σ custo, só dos pedidos com custo. null = nenhum com custo. */
  markup: number | null;
}

export interface CidadeAgregado {
  cidade: string;
  uf: string;
  pedidos: number;
  valor: number;
}

export interface GeografiaVendas {
  /** Ranking de UFs por nº de pedidos faturáveis (desc). */
  porUf: UfAgregado[];
  /** Ranking de cidades (agrupadas por cidade+uf) por nº de pedidos faturáveis (desc). */
  porCidade: CidadeAgregado[];
  /** Nº de UFs distintas com ao menos 1 pedido faturável. */
  estadosAtingidos: number;
  /** Total de pedidos faturáveis que possuem UF (entram em porUf/porCidade). */
  totalPedidos: number;
  /** Pedidos faturáveis sem UF (null) — excluídos dos rankings mas contados aqui. */
  semGeo: number;
  /** Σ valor faturável do período, inclusive pedidos sem UF (denominador do % e da concentração). */
  valorTotal: number;
  /** Menor nº de UFs (por valor desc) que soma ≥ 80% do valor. null sem valor ou se as UFs não chegam a 80%. */
  concentracao: { estados: number; pctValor: number } | null;
}

export function agruparPorGeografia(pedidos: Pedido[]): GeografiaVendas {
  const porUfMap = new Map<string, {
    pedidos: number; unidades: number; valor: number; frete: number; liqComCusto: number; custo: number;
  }>();
  const porCidadeMap = new Map<string, { cidade: string; uf: string; pedidos: number; valor: number }>();

  let totalPedidos = 0;
  let semGeo = 0;
  let valorSemGeo = 0;

  for (const p of pedidos) {
    // `faturavel`/`brutoFaturavel`, não `status`/`bruto`: num pack misto o status representativo
    // (membro mais antigo) pode ser o cancelado, e o bruto inclui o valor dele.
    if (!p.faturavel) continue;

    if (p.uf == null) {
      semGeo += 1;
      valorSemGeo += p.brutoFaturavel;
      continue;
    }

    totalPedidos += 1;

    // Agrega por UF
    const ufAcc = porUfMap.get(p.uf) ?? { pedidos: 0, unidades: 0, valor: 0, frete: 0, liqComCusto: 0, custo: 0 };
    ufAcc.pedidos += 1;
    ufAcc.unidades += p.unidadesFaturaveis;
    ufAcc.valor += p.brutoFaturavel;
    ufAcc.frete += p.frete ?? 0;
    if (p.custo != null && p.custo > 0) {
      ufAcc.liqComCusto += p.liquido;
      ufAcc.custo += p.custo;
    }
    porUfMap.set(p.uf, ufAcc);

    // Agrega por cidade+uf
    if (p.cidade != null) {
      const cidadeKey = `${p.cidade}|${p.uf}`;
      const cidadeAcc = porCidadeMap.get(cidadeKey) ?? { cidade: p.cidade, uf: p.uf, pedidos: 0, valor: 0 };
      cidadeAcc.pedidos += 1;
      cidadeAcc.valor += p.brutoFaturavel;
      porCidadeMap.set(cidadeKey, cidadeAcc);
    }
  }

  const valorTotal = round2(Array.from(porUfMap.values()).reduce((s, acc) => s + acc.valor, valorSemGeo));
  const porUf: UfAgregado[] = Array.from(porUfMap.entries())
    .map(([uf, acc]) => ({
      uf,
      pedidos: acc.pedidos,
      unidades: acc.unidades,
      valor: round2(acc.valor),
      pctPedidos: totalPedidos > 0 ? round1((acc.pedidos / totalPedidos) * 100) : 0,
      pctValor: valorTotal > 0 ? round1((acc.valor / valorTotal) * 100) : 0,
      ticketMedio: round2(acc.valor / acc.pedidos),
      freteMedio: round2(acc.frete / acc.pedidos),
      markup: acc.custo > 0 ? (acc.liqComCusto - acc.custo) / acc.custo : null,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  const porCidade: CidadeAgregado[] = Array.from(porCidadeMap.values())
    .map((acc) => ({
      cidade: acc.cidade,
      uf: acc.uf,
      pedidos: acc.pedidos,
      valor: round2(acc.valor),
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  let concentracao: GeografiaVendas['concentracao'] = null;
  if (valorTotal > 0) {
    let acumulado = 0;
    let estados = 0;
    for (const u of [...porUf].sort((a, b) => b.valor - a.valor)) {
      acumulado += u.valor;
      estados += 1;
      if (acumulado >= valorTotal * 0.8) break;
    }
    if (acumulado >= valorTotal * 0.8) {
      concentracao = { estados, pctValor: round1((acumulado / valorTotal) * 100) };
    }
  }

  return {
    porUf,
    porCidade,
    estadosAtingidos: porUfMap.size,
    totalPedidos,
    semGeo,
    valorTotal,
    concentracao,
  };
}
