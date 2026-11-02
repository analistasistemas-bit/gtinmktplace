// Volume mínimo ao preço atual (ADR-0189, emenda 2026-11-02): piso da faixa de vendidos × preço atual do mesmo card.
// Não é faturamento: a faixa é um piso e o preço de hoje não é o das vendas passadas.
import { pisoDosVendidos } from './quanto-vende';

/** Centavos; null se faltar o piso ou o preço (nunca zero). */
export function volumeMinimoAoPrecoAtual(vendidosTexto: string | null, preco: number | null): number | null {
  const piso = pisoDosVendidos(vendidosTexto);
  if (piso === null || preco === null || !Number.isFinite(preco) || preco <= 0) return null;
  return Math.round(piso * preco * 100);
}
