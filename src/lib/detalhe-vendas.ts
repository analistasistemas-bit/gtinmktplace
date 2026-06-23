import type { Venda } from './faturamento';
import { ehFaturavel } from './resumo-vendas';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LinhaVenda {
  id: string;
  titulo: string;
  /** Código do produto (codigo do item). null para itens fora do PubliAI. */
  codigo: string | null;
  /** EAN/GTIN do item. null para itens fora do PubliAI. */
  ean: string | null;
  unidades: number;
  valor: number;
  pctTotal: number;
}
export interface SecaoVendas { linhas: LinhaVenda[]; unidades: number; valor: number; pctTotal: number }
export interface DetalheVendas { total: number; pedidos: number; app: SecaoVendas; externo: SecaoVendas }

function secao(linhas: LinhaVenda[], total: number): SecaoVendas {
  const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
  const valor = round2(linhas.reduce((a, l) => a + l.valor, 0));
  return { linhas, unidades, valor, pctTotal: total > 0 ? (valor / total) * 100 : 0 };
}

interface Grupo { unidades: number; valor: number; titulo: string | null; codigo: string | null; ean: string | null; publiai: boolean }

/**
 * Compõe o detalhe do faturamento a partir das vendas de `ml_vendas` (fonte única — ADR-0038), a
 * MESMA que alimenta o card de Faturamento (calcularResumo). Antes esta tela lia a edge
 * `metricas-vendas` (API do ML em tempo real), que divergia do card por não contar reembolsos
 * parciais. Agrupa os itens por anúncio (ml_item_id) e separa anúncios do app (is_publiai) dos
 * externos. `total`/`pedidos` consideram só vendas faturáveis (paid/partially_refunded/refunded).
 */
export function montarDetalheVendas(vendas: Venda[]): DetalheVendas {
  let total = 0;
  let pedidos = 0;
  const grupos = new Map<string, Grupo>();

  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    total += v.total_amount;
    pedidos += 1;
    for (const it of v.itens) {
      const key = it.ml_item_id ?? it.id;
      const g = grupos.get(key)
        ?? { unidades: 0, valor: 0, titulo: null, codigo: null, ean: null, publiai: it.is_publiai };
      g.unidades += it.quantity;
      g.valor += it.unit_price * it.quantity;
      g.titulo ??= it.titulo;
      g.codigo ??= it.codigo;
      g.ean ??= it.ean;
      grupos.set(key, g);
    }
  }
  total = round2(total);

  const pct = (valor: number) => (total > 0 ? (valor / total) * 100 : 0);
  const app: LinhaVenda[] = [];
  const externo: LinhaVenda[] = [];
  for (const [id, g] of grupos) {
    const linha: LinhaVenda = {
      id,
      titulo: g.titulo ?? id,
      // Itens fora do PubliAI não têm código/EAN do catálogo do app.
      codigo: g.publiai ? g.codigo : null,
      ean: g.publiai ? g.ean : null,
      unidades: g.unidades,
      valor: round2(g.valor),
      pctTotal: pct(g.valor),
    };
    (g.publiai ? app : externo).push(linha);
  }
  app.sort((a, b) => b.valor - a.valor);
  externo.sort((a, b) => b.valor - a.valor);

  return { total, pedidos, app: secao(app, total), externo: secao(externo, total) };
}
