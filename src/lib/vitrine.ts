import { diaBRT } from '@/lib/calendario-brt';

export type ItemVitrine = {
  ml_item_id: string; titulo: string | null; codigo_pai: string | null; status: string | null; em_ads: boolean;
  visitas: number; pedidos: number; receita: number; pares_ok: number; pares_total: number;
  visitas_ant: number; pedidos_ant: number; receita_ant: number; pares_ok_ant: number; pares_total_ant: number;
  visitas_ult7: number; dias_ok_ult7: number;
  variacao: string | null; permalink: string | null;
};
export type SemanaVitrine = { semana: string; visitas: number; pedidos: number; receita: number; pares_ok: number; pares_total: number };
export type DiaSemanaVitrine = { dow: number; visitas: number; pedidos: number; semanas: number; pares_ok: number; pares_total: number };
export type ResumoVitrine = { inicio: string; fim: string; itens: ItemVitrine[]; semanas: SemanaVitrine[]; dias_semana: DiaSemanaVitrine[] };
export type Preset = '4s' | '12s' | '6m';
// visitas/conversao/vendaPorVisita = valores EXIBÍVEIS: null quando cobertura < 80% (nunca 0)
export type Recorte = { visitas: number | null; pedidos: number; receita: number; cobertura: number;
  conversao: number | null; vendaPorVisita: number | null; avisoCobertura: boolean };
export type KpisVitrine = { atual: Recorte; anterior: Recorte };
export type PontoSerie = { semana: string; dias: number; visitasDia: number | null; conv: number | null };
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

// semana = segunda..domingo; dias = quantos caem dentro de [inicio, fim] (1ª/última semana são parciais)
const diasNoPeriodo = (semana: string, inicio: string, fim: string): number => {
  let n = 0;
  for (let k = 0; k < 7; k++) { const d = somaDias(semana, k); if (d >= inicio && d <= fim) n++; }
  return n;
};

export const serieVitrine = (semanas: SemanaVitrine[], inicio: string, fim: string): PontoSerie[] =>
  semanas.map((s) => {
    const dias = diasNoPeriodo(s.semana, inicio, fim);
    return valida(s.pares_ok, s.pares_total) && dias > 0
      ? { semana: s.semana, dias, visitasDia: s.visitas / dias, conv: taxa(s.pedidos, s.visitas) }
      : { semana: s.semana, dias, visitasDia: null, conv: null };
  });

// Δ absoluto (atual − anterior) em pontos percentuais; usado na Conversão
export const deltaPP = (atual: number | null, anterior: number | null): number | null =>
  atual == null || anterior == null ? null : (atual - anterior) * 100;

export const delta = (atual: number | null, anterior: number | null): number | null =>
  atual == null || anterior == null || anterior === 0 ? null : (atual - anterior) / anterior;

// ponytail: limites calibrados contra a Avil em 02/10/2026 (ADR-0176 D-6).
export const LIMITES = { minVisitasSemVenda: 100, fatorSemVenda: 0.5, minPedidosConverte: 5,
  fatorConverte: 1.5, minVisitasAntQueda: 100, quedaPerdendo: 0.3, diasInvisivel: 7, coberturaItem: 0.8,
  esperadoInvisivel: 3, percentilConverte: 0.75 } as const;
export type Rotulo = 'invisivel' | 'sem_venda' | 'converte' | 'perdendo';
export type ItemAcao = { item: ItemVitrine; rotulo: Rotulo; emJogo: number };

const percentil = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * p)];
};
export function esperado7(i: ItemVitrine): number {
  const diasOutros = i.pares_ok - i.dias_ok_ult7;
  return diasOutros > 0 ? (i.visitas - i.visitas_ult7) * 7 / diasOutros : 0;
}
export const linkML = (i: Pick<ItemVitrine, 'ml_item_id' | 'permalink'>): string =>
  i.permalink?.trim() ? i.permalink : `https://produto.mercadolivre.com.br/MLB-${i.ml_item_id.replace(/\D/g, '')}`;
const cobre = (ok: number, total: number) => total > 0 && ok / total >= LIMITES.coberturaItem;

export function ondeAgir(itens: ItemVitrine[], convMedia: number | null): ItemAcao[] {
  const ativos = itens.filter((i) => i.status === 'active');
  const p75 = percentil(ativos.filter((i) => i.pedidos >= 1 && cobre(i.pares_ok, i.pares_total)).map((i) => i.visitas), LIMITES.percentilConverte);
  const out: ItemAcao[] = [];
  for (const i of ativos) {
    if (i.dias_ok_ult7 >= LIMITES.diasInvisivel && i.visitas_ult7 === 0 && esperado7(i) >= LIMITES.esperadoInvisivel) {
      out.push({ item: i, rotulo: 'invisivel', emJogo: i.pedidos_ant });
      continue;
    }
    if (convMedia == null || !cobre(i.pares_ok, i.pares_total)) continue;
    const conv = taxa(i.pedidos, i.visitas) ?? 0;
    const cands: ItemAcao[] = [];
    if (i.visitas >= LIMITES.minVisitasSemVenda && conv < LIMITES.fatorSemVenda * convMedia)
      cands.push({ item: i, rotulo: 'sem_venda', emJogo: i.visitas * (convMedia - conv) });
    if (i.pedidos >= LIMITES.minPedidosConverte && conv >= LIMITES.fatorConverte * convMedia && i.visitas < p75)
      cands.push({ item: i, rotulo: 'converte', emJogo: 0.5 * i.visitas * conv });
    if (cobre(i.pares_ok_ant, i.pares_total_ant) && i.visitas_ant >= LIMITES.minVisitasAntQueda
        && i.visitas < i.visitas_ant * (1 - LIMITES.quedaPerdendo))
      cands.push({ item: i, rotulo: 'perdendo', emJogo: (i.visitas_ant - i.visitas) * (taxa(i.pedidos_ant, i.visitas_ant) ?? 0) });
    if (cands.length) out.push(cands.reduce((a, b) => (b.emJogo > a.emJogo ? b : a)));
  }
  return out.sort((a, b) =>
    Number(b.rotulo === 'invisivel') - Number(a.rotulo === 'invisivel') || b.emJogo - a.emJogo);
}

const DOW = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const MIN_PEDIDOS = 30;
const Z = 1.96;

export function zProp(x1: number, n1: number, x2: number, n2: number): number {
  if (!n1 || !n2) return 0;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (x1 / n1 - x2 / n2) / se : 0;
}

export function frasesVitrine(r: ResumoVitrine, k: KpisVitrine, acoes: ItemAcao[]): string[] {
  const f: string[] = [];
  const { atual: a, anterior: b } = k;
  if (a.conversao != null && b.conversao != null && a.pedidos >= MIN_PEDIDOS && b.pedidos >= MIN_PEDIDOS
      && pct(a.conversao) !== pct(b.conversao)
      && Math.abs(zProp(a.pedidos, a.visitas ?? 0, b.pedidos, b.visitas ?? 0)) >= Z)
    f.push(`Conversão ${a.conversao > b.conversao ? 'subiu' : 'caiu'} de ${pct(b.conversao)} para ${pct(a.conversao)} contra o período anterior.`);

  // CADA dia da semana: ≥ 12 datas medidas E cobertura ≥ 80% dos pares (1 MLB ok por data não basta)
  if (r.dias_semana.length === 7 && r.dias_semana.every((d) =>
      d.semanas >= 12 && d.pares_total > 0 && d.pares_ok / d.pares_total >= COBERTURA_MINIMA)) {
    const melhor = r.dias_semana.reduce((x, y) => ((taxa(y.pedidos, y.visitas) ?? 0) > (taxa(x.pedidos, x.visitas) ?? 0) ? y : x));
    const resto = r.dias_semana.filter((d) => d.dow !== melhor.dow);
    const rv = resto.reduce((s, d) => s + d.visitas, 0);
    const rp = resto.reduce((s, d) => s + d.pedidos, 0);
    if (melhor.pedidos >= MIN_PEDIDOS && rp >= MIN_PEDIDOS && zProp(melhor.pedidos, melhor.visitas, rp, rv) >= Z)
      f.push(`${DOW[melhor.dow]} converte mais: ${pct(melhor.pedidos / melhor.visitas)} contra ${pct(rp / rv)} nos outros dias.`);
  }

  const n = acoes.filter((x) => x.rotulo === 'invisivel').length;
  if (n === 1) f.push('1 anúncio ativo está sem visita há 7 dias — veja abaixo.');
  else if (n > 1) f.push(`${n} anúncios ativos estão sem visita há 7 dias — veja abaixo.`);
  return f.slice(0, 3);
}
