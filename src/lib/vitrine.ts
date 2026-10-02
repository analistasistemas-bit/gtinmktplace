import { diaBRT } from '@/lib/calendario-brt';

export type ItemVitrine = {
  ml_item_id: string; titulo: string | null; codigo_pai: string | null; status: string | null; em_ads: boolean;
  visitas: number; pedidos: number; receita: number; pares_ok: number; pares_total: number;
  visitas_ant: number; pedidos_ant: number; receita_ant: number; pares_ok_ant: number; pares_total_ant: number;
  visitas_ult7: number; dias_ok_ult7: number;
};
export type SemanaVitrine = { semana: string; visitas: number; pedidos: number; receita: number; pares_ok: number; pares_total: number };
export type DiaSemanaVitrine = { dow: number; visitas: number; pedidos: number; semanas: number; pares_ok: number; pares_total: number };
export type ResumoVitrine = { inicio: string; fim: string; itens: ItemVitrine[]; semanas: SemanaVitrine[]; dias_semana: DiaSemanaVitrine[] };
export type Preset = '4s' | '12s' | '6m';
// visitas/conversao/vendaPorVisita = valores EXIBÍVEIS: null quando cobertura < 80% (nunca 0)
export type Recorte = { visitas: number | null; pedidos: number; receita: number; cobertura: number;
  conversao: number | null; vendaPorVisita: number | null; avisoCobertura: boolean };
export type KpisVitrine = { atual: Recorte; anterior: Recorte };
export type PontoSerie = { semana: string; visitas: number | null; conv: number | null };
export const COBERTURA_AVISO = 0.95;
export const COBERTURA_MINIMA = 0.8;

const DIAS: Record<Preset, number> = { '4s': 28, '12s': 84, '6m': 182 };

const somaDias = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function periodoVitrine(preset: Preset, agoraMs: number) {
  // D-2 ainda é `pendente`: o coletor só marca ok 48 h após o FIM do dia (ADR-0176 D-4)
  const fim = somaDias(diaBRT(agoraMs), -3);
  return { inicio: somaDias(fim, -(DIAS[preset] - 1)), fim };
}

export const taxa = (pedidos: number, visitas: number): number | null => (visitas > 0 ? pedidos / visitas : null);

const valida = (ok: number, total: number) => total > 0 && ok / total >= COBERTURA_MINIMA;

function recorte(visitas: number, pedidos: number, receita: number, ok: number, total: number): Recorte {
  const cobertura = total > 0 ? ok / total : 0;
  const v = valida(ok, total);
  return {
    visitas: v ? visitas : null, pedidos, receita, cobertura,
    conversao: v ? taxa(pedidos, visitas) : null,
    vendaPorVisita: v && visitas > 0 ? receita / visitas : null,
    avisoCobertura: total > 0 && cobertura < COBERTURA_AVISO,
  };
}

export function kpisVitrine(itens: ItemVitrine[]): KpisVitrine {
  const s = (f: (i: ItemVitrine) => number) => itens.reduce((acc, i) => acc + f(i), 0);
  return {
    atual: recorte(s((i) => i.visitas), s((i) => i.pedidos), s((i) => i.receita), s((i) => i.pares_ok), s((i) => i.pares_total)),
    anterior: recorte(s((i) => i.visitas_ant), s((i) => i.pedidos_ant), s((i) => i.receita_ant), s((i) => i.pares_ok_ant), s((i) => i.pares_total_ant)),
  };
}

export const serieVitrine = (semanas: SemanaVitrine[]): PontoSerie[] =>
  semanas.map((s) => valida(s.pares_ok, s.pares_total)
    ? { semana: s.semana, visitas: s.visitas, conv: taxa(s.pedidos, s.visitas) }
    : { semana: s.semana, visitas: null, conv: null });

export const delta = (atual: number | null, anterior: number | null): number | null =>
  atual == null || anterior == null || anterior === 0 ? null : (atual - anterior) / anterior;
