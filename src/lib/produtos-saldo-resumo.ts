// Agregados da faixa de KPIs da tela Estoque. Puro: recebe a lista já agrupada por
// `agruparProdutosComSaldo` (que já cortou para a família mais recente de cada codigo_pai).
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

export interface ResumoEstoque {
  produtos: number;
  skus: number;
  unidades: number;
  /** SKUs com saldo <= 0 — é o que o operador precisa repor. */
  skusSemEstoque: number;
  /** Σ custo × saldo, contando SÓ os SKUs que têm custo. */
  valorEmEstoque: number;
  /** SKUs com saldo > 0 e SEM custo cadastrado: ficaram DE FORA de `valorEmEstoque`. */
  skusSemCusto: number;
}

/**
 * `valorEmEstoque` é caminho financeiro: `variacoes.custo` é nullable (ADR-0094 D-9 aceita
 * entrada sem custo), então a soma sozinha subnotifica em silêncio. `skusSemCusto` existe para
 * a UI dizer LOUD o que ficou fora — mesma classe do incidente de ORIGEM em `ingest-lote`.
 * Saldo negativo (bug de ledger) não vira valor negativo: só soma saldo > 0.
 */
export function resumirEstoque(produtos: ProdutoComSaldo[]): ResumoEstoque {
  const r: ResumoEstoque = {
    produtos: produtos.length, skus: 0, unidades: 0,
    skusSemEstoque: 0, valorEmEstoque: 0, skusSemCusto: 0,
  };
  for (const p of produtos) {
    for (const v of p.variacoes) {
      r.skus += 1;
      if (v.estoque <= 0) { r.skusSemEstoque += 1; continue; }
      r.unidades += v.estoque;
      if (v.custo == null) r.skusSemCusto += 1;
      else r.valorEmEstoque += Number(v.custo) * v.estoque;
    }
  }
  return r;
}
