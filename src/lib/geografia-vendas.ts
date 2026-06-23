// Agregador geográfico de vendas por UF/cidade (ADR-0039 — Fase 2b Geografia).
// Puro e testável: recebe Pedido[] e devolve GeografiaVendas sem I/O.
import type { Pedido } from './pedidos-faturamento';
import { ehFaturavel } from './resumo-vendas';

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface UfAgregado {
  uf: string;
  pedidos: number;
  unidades: number;
  valor: number;
  pctPedidos: number;
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
}

export function agruparPorGeografia(pedidos: Pedido[]): GeografiaVendas {
  const porUfMap = new Map<string, { pedidos: number; unidades: number; valor: number }>();
  const porCidadeMap = new Map<string, { cidade: string; uf: string; pedidos: number; valor: number }>();

  let totalPedidos = 0;
  let semGeo = 0;

  for (const p of pedidos) {
    if (!ehFaturavel(p.status)) continue;

    if (p.uf == null) {
      semGeo += 1;
      continue;
    }

    totalPedidos += 1;

    // Agrega por UF
    const ufAcc = porUfMap.get(p.uf) ?? { pedidos: 0, unidades: 0, valor: 0 };
    ufAcc.pedidos += 1;
    ufAcc.unidades += p.unidades;
    ufAcc.valor += p.bruto;
    porUfMap.set(p.uf, ufAcc);

    // Agrega por cidade+uf
    if (p.cidade != null) {
      const cidadeKey = `${p.cidade}|${p.uf}`;
      const cidadeAcc = porCidadeMap.get(cidadeKey) ?? { cidade: p.cidade, uf: p.uf, pedidos: 0, valor: 0 };
      cidadeAcc.pedidos += 1;
      cidadeAcc.valor += p.bruto;
      porCidadeMap.set(cidadeKey, cidadeAcc);
    }
  }

  const porUf: UfAgregado[] = Array.from(porUfMap.entries())
    .map(([uf, acc]) => ({
      uf,
      pedidos: acc.pedidos,
      unidades: acc.unidades,
      valor: Math.round(acc.valor * 100) / 100,
      pctPedidos: totalPedidos > 0 ? round1((acc.pedidos / totalPedidos) * 100) : 0,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  const porCidade: CidadeAgregado[] = Array.from(porCidadeMap.values())
    .map((acc) => ({
      cidade: acc.cidade,
      uf: acc.uf,
      pedidos: acc.pedidos,
      valor: Math.round(acc.valor * 100) / 100,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  return {
    porUf,
    porCidade,
    estadosAtingidos: porUfMap.size,
    totalPedidos,
    semGeo,
  };
}
