// Kit Virtual: "Você recebe vendendo avulso" por componente. `recebe` sai direto da tarifa oficial do
// tipo do anúncio (já líquido de frete e imposto); nada presumido (ADR-0107): tipo desconhecido,
// alíquota ausente ou cotação não oficial nunca viram número.
import { round2 } from '@/lib/formato';
import { provenienciaDaTarifa, type Tarifa } from '@/lib/tarifa';

export type EstadoRecebeAvulso = 'calculando' | 'indisponivel' | 'sem_listing_type' | 'sem_aliquota' | 'ok';
export interface RecebeAvulso {
  estado: EstadoRecebeAvulso; recebe: number | null; lucro: number | null; margemPct: number | null;
}

/** `tarifa`: undefined = ainda cotando; null = indisponível. */
export function recebeAvulso(p: {
  tarifa: Tarifa | null | undefined; listingTypeId: string | null; aliquotaPct: number | null;
  custo: number | null; preco: number;
}): RecebeAvulso {
  const fim = (estado: EstadoRecebeAvulso, recebe: number | null = null, lucro: number | null = null, margemPct: number | null = null): RecebeAvulso =>
    ({ estado, recebe, lucro, margemPct });
  if (p.listingTypeId !== 'gold_pro' && p.listingTypeId !== 'gold_special') return fim('sem_listing_type');
  if (p.aliquotaPct == null) return fim('sem_aliquota');
  if (p.tarifa === undefined) return fim('calculando');
  if (p.tarifa === null || provenienciaDaTarifa(p.tarifa).proveniencia !== 'official') return fim('indisponivel');
  const recebe = (p.listingTypeId === 'gold_pro' ? p.tarifa.premium : p.tarifa.classico).recebe;
  if (p.custo == null) return fim('ok', recebe);
  const lucro = round2(recebe - p.custo);
  return fim('ok', recebe, lucro, p.preco > 0 ? round2((lucro / p.preco) * 100) : null);
}

/** Σ recebe × quantidade; null se alguma linha não tem conta. */
export function somaRecebeAvulso(linhas: { recebe: number | null; quantidade: number }[]): number | null {
  if (linhas.some((l) => l.recebe == null)) return null;
  return round2(linhas.reduce((t, l) => t + l.recebe! * l.quantidade, 0));
}
