// Emenda ADR-0174 (2026-11-03) — busca e "mesmo preço/desconto" para um produto e suas variações no detalhe
// da campanha. Regras puras; o líquido no preço escolhido vem SEMPRE do servidor (etapa 'simular').
import type { ItemPromocao, SemaforoPromo, CorProjetada } from '@/lib/promocoes';

export type ModoAlvo = 'desconto' | 'preco';
export type ResultadoSimulacao =
  | { ml_item_id: string; status: 'simulado'; preco: number; projecao: CorProjetada[]; pior_semaforo: SemaforoPromo }
  | { ml_item_id: string; status: 'ignorado'; motivo: string };

/** Mesmo teto do servidor (`_shared/operacoes/simular.ts#MAX_SIMULAR`). */
export const MAX_SIMULAR = 50;
const PRECO_MIN_RELAMPAGO = 19;

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reais = (n: number) => n.toFixed(2).replace('.', ',');

/** Todas as palavras precisam aparecer no título, MLB (inclusive o normal do par) ou SKU de alguma cor. */
export function filtrarPorBusca(itens: ItemPromocao[], termo: string): ItemPromocao[] {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return itens;
  return itens.filter((it) => {
    const texto = normalizar([it.titulo, it.ml_item_id, it.anuncio_normal_id, ...it.projecao.map((c) => c.sku)].filter(Boolean).join(' '));
    return palavras.every((p) => texto.includes(p));
  });
}

/** Preço pedido para o anúncio: desconto % sobre o preço original, ou o mesmo preço para todos. */
export function precoAlvo(it: ItemPromocao, modo: ModoAlvo, valor: number): number | null {
  if (!Number.isFinite(valor)) return null;
  if (modo === 'preco') return valor > 0 ? Math.round(valor * 100) / 100 : null;
  if (it.preco_original == null || valor <= 0 || valor >= 100) return null;
  return Math.round(it.preco_original * (1 - valor / 100) * 100) / 100;
}

/** Mesmas travas de `operacoes/validar.ts` (o preview bloqueia; aqui só avisa). */
export function foraDaFaixa(it: ItemPromocao, preco: number, tipo: string): string | null {
  if (it.preco_min != null && it.preco_max != null && (preco < it.preco_min || preco > it.preco_max)) {
    return `Fora da faixa do ML (R$ ${reais(it.preco_min)} a R$ ${reais(it.preco_max)})`;
  }
  if (tipo === 'LIGHTNING' && preco < PRECO_MIN_RELAMPAGO) return 'Abaixo de R$ 19 o comprador perde o frete grátis';
  return null;
}

/** Simulação sobre o item ATUAL: preço, projeção e semáforo do servidor; o "até quanto descer" fica o do sync —
 *  depende da faixa e do piso, não do preço escolhido (a simulação não o recalcula). */
export function sobreporSimulacao(atual: ItemPromocao, simulado: ItemPromocao): ItemPromocao {
  const projecao = simulado.projecao.map((c) => {
    // Achados Codex: só a mesma cor (nunca por posição) e só com as mesmas premissas — custo/piso/alíquota
    // relidos diferentes invalidam o limite antigo (poderia levar a prejuízo).
    const o = atual.projecao.find((x) => x.variation_id === c.variation_id);
    const valido = o != null && o.custo === c.custo && o.piso === c.piso && o.aliquota_pct === c.aliquota_pct;
    return { ...c, ate_quanto: valido ? o.ate_quanto : null, ate_quanto_motivo: valido ? o.ate_quanto_motivo : null };
  });
  return { ...atual, preco_avaliado: simulado.preco_avaliado, projecao, pior_semaforo: simulado.pior_semaforo };
}

/** Mesmo "Você recebe por venda" de Publicados, decomposto a partir da tarifa que o servidor gravou na cor.
 *  `recebe` é o líquido do servidor; sem tarifa/custo → null (nunca zero). */
export function detalheLiquido(c: CorProjetada, preco: number | null): {
  comissao: number; comissaoPct: number; imposto: number; aliquotaPct: number; frete: number; recebe: number; lucro: number;
  markup: number; margem: number | null;
} | null {
  if (preco == null || c.liquido == null || c.custo == null || c.comissao_pct == null || c.frete == null || c.aliquota_pct == null) return null;
  const lucro = c.liquido - c.custo;
  return {
    comissao: preco * c.comissao_pct / 100 + (c.comissao_fixa ?? 0), comissaoPct: c.comissao_pct,
    imposto: preco * c.aliquota_pct / 100, aliquotaPct: c.aliquota_pct, frete: c.frete,
    recebe: c.liquido, lucro, markup: c.custo > 0 ? lucro / c.custo : 0,
    // Margem sobre a venda (lucro ÷ preço), mesma régua de cascata-pedido.ts e Vendas SKU.
    margem: preco > 0 ? lucro / preco : null,
  };
}

/** Itens simulados com o preço, a projeção e o semáforo calculados pelo servidor naquele preço. */
export function aplicarSimulacao(itens: ItemPromocao[], resultados: ResultadoSimulacao[]): Map<string, ItemPromocao> {
  const porId = new Map(itens.map((i) => [i.ml_item_id, i]));
  const out = new Map<string, ItemPromocao>();
  for (const r of resultados) {
    const it = porId.get(r.ml_item_id);
    if (r.status !== 'simulado' || !it) continue;
    out.set(r.ml_item_id, { ...it, preco_avaliado: r.preco, projecao: r.projecao, pior_semaforo: r.pior_semaforo });
  }
  return out;
}
