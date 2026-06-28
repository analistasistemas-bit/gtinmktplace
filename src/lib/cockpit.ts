// Agregadores puros do Dashboard-cockpit. Sem I/O — recebem as vendas já lidas (mesma base
// ml_vendas dos menus Publicados/Faturamento/Financeiro, ADR-0038) e devolvem o que cada bloco
// do cockpit precisa: ranking de produtos, intensidade por UF, calendário de caixa e a faixa
// de pendências cross-módulo. Testável (cockpit.test.ts).
import type { Venda } from './faturamento';
import type { VendaResumo } from './resumo-vendas';
import { ehFaturavel } from './resumo-vendas';
import { round2 } from './formato';

export interface ProdutoTop {
  mlItemId: string;
  titulo: string;
  unidades: number;
  valor: number;
}

/** Top N anúncios por valor vendido (bruto) no período, das vendas faturáveis. */
export function topProdutos(vendas: Venda[], n = 5): ProdutoTop[] {
  const m = new Map<string, { titulo: string; unidades: number; valor: number }>();
  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    for (const it of v.itens) {
      if (!it.ml_item_id) continue;
      const acc = m.get(it.ml_item_id) ?? { titulo: it.titulo ?? it.ml_item_id, unidades: 0, valor: 0 };
      if ((!acc.titulo || acc.titulo === it.ml_item_id) && it.titulo) acc.titulo = it.titulo;
      acc.unidades += it.quantity;
      acc.valor += it.unit_price * it.quantity;
      m.set(it.ml_item_id, acc);
    }
  }
  return [...m.entries()]
    .map(([mlItemId, a]) => ({ mlItemId, titulo: a.titulo, unidades: a.unidades, valor: round2(a.valor) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n);
}

/** uf → nº de pedidos faturáveis com aquela UF. Alimenta o mapa de calor (MapaBrasil). */
export function vendasPorUf(vendas: Venda[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vendas) {
    if (!ehFaturavel(v.status) || !v.uf) continue;
    out[v.uf] = (out[v.uf] ?? 0) + 1;
  }
  return out;
}

export interface DiaCaixa { data: string; total: number }

/** Próximos N dias com liberação de recebimento (money_release_date futuro), somando o líquido
 *  que cai em cada dia. Ordenado do mais próximo ao mais distante. */
export function calendarioCaixa(vendas: VendaResumo[], n = 6, agoraMs: number = Date.now()): DiaCaixa[] {
  const m = new Map<string, number>();
  for (const v of vendas) {
    if (!v.dataLiberacao) continue;
    const ms = Date.parse(v.dataLiberacao);
    if (Number.isNaN(ms) || ms <= agoraMs) continue;
    const dia = v.dataLiberacao.slice(0, 10);
    m.set(dia, (m.get(dia) ?? 0) + v.liquido);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([data, total]) => ({ data, total: round2(total) }));
}

export interface ItemAtencao { chave: string; label: string; destino: string }

/** Pendências acionáveis cross-módulo da faixa "Precisa de atenção". Só entra o que é > 0;
 *  vazio = tudo em dia (a faixa some). Singular/plural simples. */
export function montarAtencao(input: {
  aRevisar: number;
  comProblema: number;
  erros: number;
  errosDestino: string;
  perguntas: number;
  devolucoes: number;
}): ItemAtencao[] {
  const out: ItemAtencao[] = [];
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (input.aRevisar > 0)
    out.push({ chave: 'revisar', label: plural(input.aRevisar, 'lote a revisar', 'lotes a revisar'), destino: '/revisao' });
  if (input.comProblema > 0)
    out.push({ chave: 'problema', label: plural(input.comProblema, 'anúncio com problema', 'anúncios com problema'), destino: '/publicados' });
  if (input.erros > 0)
    out.push({ chave: 'erros', label: plural(input.erros, 'erro de publicação', 'erros de publicação'), destino: input.errosDestino });
  if (input.perguntas > 0)
    out.push({ chave: 'perguntas', label: plural(input.perguntas, 'pergunta sem resposta', 'perguntas sem resposta'), destino: '/faturamento' });
  if (input.devolucoes > 0)
    out.push({ chave: 'devolucoes', label: plural(input.devolucoes, 'devolução aberta', 'devoluções abertas'), destino: '/faturamento' });
  return out;
}
