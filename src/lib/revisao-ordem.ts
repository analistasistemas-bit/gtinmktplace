import type { Familia } from '@/lib/tipos-dominio';
import { familiaIncompleta } from '@/lib/publicavel';

/**
 * Urgência da família na Revisão (menor = mais urgente, vai pro topo).
 * 0 erro · 1 precisa de ação (incompleta) · 2 aviso de preço · 3 pronto ok · 4 publicado.
 */
export function prioridadeExcecao(f: Familia): number {
  if (f.status === 'erro') return 0;
  if (f.status === 'publicado' || f.status === 'publicando') return 4;
  if (familiaIncompleta(f)) return 1;
  if (f.precoAbaixo20pc) return 2;
  return 3;
}

/** Ordena a lista por exceção (problemas primeiro). Sort estável: preserva a ordem
 *  original dentro de cada nível. Não muta o array recebido. */
export function ordenarPorExcecao(familias: Familia[]): Familia[] {
  return [...familias].sort((a, b) => prioridadeExcecao(a) - prioridadeExcecao(b));
}
