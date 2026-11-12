// Kit vinculado: "Você recebe" do preço digitado, com a mesma conta do simulador do kit com variação
// (`resumoDaTarifa`: tarifa oficial, sem fórmula nova). Cotação não oficial nunca vira número.
import { resumoDaTarifa } from '@/lib/kit-variacao-simulacao';
import type { ResumoLucro } from '@/lib/promocao-simulacao';
import { provenienciaDaTarifa, type Tarifa } from '@/lib/tarifa';

export type EstadoRecebe = 'sem_preco' | 'sem_custo' | 'calculando' | 'indisponivel' | 'prejuizo' | 'ok';
export interface SimulacaoRecebe { estado: EstadoRecebe; resumo: ResumoLucro | null; semAliquota: boolean; precisaConfirmar: boolean }

/** `tarifa`: undefined = ainda cotando; null = indisponível. `precoEmDia`: a tarifa é do preço digitado. */
export function simularRecebe(p: {
  preco: number; precoEmDia: boolean; custo: number | null; tipo: 'gold_special' | 'gold_pro';
  aliquotaPct: number | null; tarifa: Tarifa | null | undefined;
}): SimulacaoRecebe {
  const semAliquota = p.aliquotaPct == null;
  const fim = (estado: EstadoRecebe, resumo: ResumoLucro | null, precisaConfirmar: boolean): SimulacaoRecebe =>
    ({ estado, resumo, semAliquota, precisaConfirmar });
  if (!(p.preco > 0)) return fim('sem_preco', null, false);
  if (p.custo == null) return fim('sem_custo', null, false);
  if (p.tarifa === undefined || !p.precoEmDia) return fim('calculando', null, false);
  if (p.tarifa === null || provenienciaDaTarifa(p.tarifa).proveniencia !== 'official') return fim('indisponivel', null, true);
  const resumo = resumoDaTarifa(p.tarifa, p.tipo, p.preco, p.custo, '', p.aliquotaPct ?? 0);
  const estado = resumo.lucro < 0 ? 'prejuizo' : 'ok';
  return fim(estado, resumo, estado === 'prejuizo' || semAliquota);
}
