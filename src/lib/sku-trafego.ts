// Dossiê do SKU (Vendas SKU, Fatia 2b): tráfego e oferta. "Unidades por visita" = Σ unidades ÷ Σ visitas
// nos mesmos MLBs e dias, só com todos os dias `ok` — nunca média de taxas, nunca rateio entre cores.
// Dia = data literal BRT (spike 052): a série usa os mesmos intervalos BRT do faturamento.
import type { Venda } from './faturamento';
import type { Pedido } from './pedidos-faturamento';
import { diaBRT, type Intervalo } from './calendario-brt';
import { dentroDaJanela } from './vendas-sku';
import { vinculoDoMlb, type AlvoDossie, type Vinculo } from './sku-dossie';
import type { VisitaDia, PrecoDia, TrafegoSync } from './sku-dossie-dados';

/** sku = MLBs exclusivos do código; anuncio = só compartilhados (métrica do anúncio inteiro, todas as
 *  cores); familia = MLBs com todos os códigos na família; indisponivel = nenhum MLB serve. */
export type AlcanceTrafego = 'sku' | 'anuncio' | 'familia' | 'indisponivel';
export type EstadoColeta = 'carregando' | 'erro' | 'sem_coleta' | 'parcial' | 'ok';

export interface PontoTrafego {
  intervalo: Intervalo;
  /** Σ visitas; null se algum dia (MLB × dia até hoje) não é `ok` — dia ausente ≠ zero. */
  visitas: number | null;
  /** MLB × dia do intervalo (até hoje, BRT) por estado; `ausente` = sem linha. */
  estados: { ok: number; pendente: number; falha: number; ausente: number };
  /** Numerador: itens faturáveis fora de kit dos MLBs considerados (vínculo atual). */
  unidades: number;
  /** null com visitas null ou 0. Pode passar de 1 (não é "%" de conversão). */
  unidadesPorVisita: number | null;
  precoObservado: { min: number; max: number } | null;
}

export interface TrafegoDossie {
  /** Sempre 'brt' (spike 052); 'utc' fica para uma fonte que defina o dia em UTC. */
  calendario: 'utc' | 'brt';
  alcance: AlcanceTrafego;
  /** Todos os MLBs do dossiê (vínculo atual); `considerado` = entra na métrica. */
  porMlb: Array<{ mlb: string; vinculo: Vinculo; codigos: string[]; considerado: boolean }>;
  /** Vazia em carregando/erro/indisponível. */
  serie: PontoTrafego[];
  /** Dia `ok` mais antigo dos MLBs considerados, dentro da faixa lida. */
  coberturaDesde: string | null;
  estadoColeta: EstadoColeta;
  /** Última observação de preço de oferta dos MLBs considerados (cabeçalho). */
  precoAtual: { preco: number; observadoEm: string; mlb: string } | null;
  /** Por que a coleta parou (`ml_trafego_sync.estado`); null = coletando normalmente ou nunca rodou. */
  motivo: 'sem_acesso' | 'erro' | null;
}

export type FonteTrafego = { visitas: VisitaDia[]; precos: PrecoDia[]; sync: TrafegoSync | null };

const DIA_MS = 86_400_000;
const ESPERA_MS = 48 * 3_600_000;
/** Fim do dia BRT (YYYY-MM-DD) = 03:00Z do dia seguinte. */
const fimDoDia = (dia: string) => Date.parse(`${dia}T03:00:00Z`) + DIA_MS;

/** Dias BRT do intervalo, cortados em hoje (BRT): dia futuro não é ausente. */
export function diasDoIntervalo(iv: Intervalo, agora: Date): string[] {
  const hoje = diaBRT(agora.getTime());
  const ultimo = diaBRT(Date.parse(iv.fim) - 1);
  const out: string[] = [];
  for (let t = Date.parse(`${diaBRT(Date.parse(iv.inicio))}T00:00:00Z`); ; t += DIA_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d > ultimo || d > hoje) break;
    out.push(d);
  }
  return out;
}

/** Faixa de dias a ler: do 1º dia do 1º intervalo (pode começar antes do período) ao último. */
export function faixaTrafego(intervalos: Intervalo[]): { desde: string; ate: string } | null {
  if (!intervalos.length) return null;
  return { desde: diaBRT(Date.parse(intervalos[0].inicio)), ate: diaBRT(Date.parse(intervalos[intervalos.length - 1].fim) - 1) };
}

/** MLBs que entram na métrica e códigos de fora cujas vendas também contam (alcance anúncio). */
export function conjuntoTrafego(alvo: AlvoDossie, codigos: string[], mlbs: Map<string, string[]>):
  { alcance: AlcanceTrafego; mlbs: string[]; codigosExtras: string[] } {
  const cods = new Set(codigos);
  const entradas = [...mlbs.entries()].filter(([, cs]) => cs.length > 0).sort(([a], [b]) => a.localeCompare(b));
  const pega = (alcance: AlcanceTrafego, es: typeof entradas) => ({
    alcance, mlbs: es.map(([m]) => m),
    codigosExtras: [...new Set(es.flatMap(([, cs]) => cs.filter((c) => !cods.has(c))))].sort(),
  });
  const nenhum = { alcance: 'indisponivel' as const, mlbs: [], codigosExtras: [] };
  if (alvo.tipo === 'familia') {
    const daFamilia = entradas.filter(([, cs]) => cs.every((c) => cods.has(c)));
    return daFamilia.length ? pega('familia', daFamilia) : nenhum;
  }
  const exclusivos = entradas.filter(([, cs]) => cs.length === 1 && cods.has(cs[0]));
  if (exclusivos.length) return pega('sku', exclusivos);
  const compartilhados = entradas.filter(([, cs]) => cs.length > 1);
  return compartilhados.length ? pega('anuncio', compartilhados) : nenhum;
}

export function montarTrafego(p: {
  alvo: AlvoDossie; codigos: string[]; mlbs: Map<string, string[]>;
  /** Vendas do dossiê + (alcance anúncio) as dos outros códigos do anúncio; repetidas contam uma vez. */
  vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[];
  intervalos: Intervalo[]; agora: Date;
  fonte: FonteTrafego | 'carregando' | 'erro';
}): TrafegoDossie {
  const conj = conjuntoTrafego(p.alvo, p.codigos, p.mlbs);
  const set = new Set(conj.mlbs);
  const porMlb = [...p.mlbs.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([mlb, codigos]) => ({ mlb, vinculo: vinculoDoMlb(mlb, p.mlbs), codigos, considerado: set.has(mlb) }));
  const vazio = (estadoColeta: EstadoColeta): TrafegoDossie =>
    ({ calendario: 'brt', alcance: conj.alcance, porMlb, serie: [], coberturaDesde: null, estadoColeta, precoAtual: null, motivo: null });
  if (!set.size) return vazio('sem_coleta');
  if (p.fonte === 'carregando' || p.fonte === 'erro') return vazio(p.fonte);
  const { sync } = p.fonte;
  const motivo = sync?.estado === 'sem_acesso' || sync?.estado === 'erro' ? sync.estado : null;
  const agoraMs = p.agora.getTime();
  const visitas = p.fonte.visitas.filter((v) => set.has(v.ml_item_id));
  const precos = p.fonte.precos.filter((v) => set.has(v.ml_item_id));
  const porChave = new Map(visitas.map((v) => [`${v.ml_item_id}|${v.dia}`, v]));
  const vendas = [...new Map(p.vendas.map((v) => [v.id, v])).values()];

  const serie = p.intervalos.map((intervalo): PontoTrafego => {
    const dias = diasDoIntervalo(intervalo, p.agora);
    const estados = { ok: 0, pendente: 0, falha: 0, ausente: 0 };
    let soma = 0;
    for (const mlb of conj.mlbs) for (const dia of dias) {
      const v = porChave.get(`${mlb}|${dia}`);
      // Sem linha: dentro das 48 h o worker ainda nem devia ter o dia estável → pendente.
      if (!v) { estados[agoraMs - fimDoDia(dia) < ESPERA_MS ? 'pendente' : 'ausente']++; continue; }
      estados[v.estado]++;
      if (v.estado === 'ok') soma += v.visitas ?? 0;
    }
    const total = dias.length > 0 && estados.ok === dias.length * conj.mlbs.length ? soma : null;

    // Mesmo corte de serieDoSku: date_closed em [inicio, fim), agrupa, dentroDaJanela.
    const ini = Date.parse(intervalo.inicio); const fim = Date.parse(intervalo.fim);
    const janela = { desde: intervalo.inicio, ate: new Date(fim - 1).toISOString() };
    let unidades = 0;
    for (const ped of p.agrupar(vendas.filter((v) => v.date_closed && Date.parse(v.date_closed) >= ini && Date.parse(v.date_closed) < fim))) {
      if (!dentroDaJanela(ped.data, janela)) continue;
      for (const it of ped.itens) if (it.faturavel && !it.dentroDeKit && it.ml_item_id && set.has(it.ml_item_id)) unidades += it.quantity;
    }

    const doIv = new Set(dias);
    const ps = precos.filter((x) => doIv.has(x.dia)).map((x) => x.preco);
    return {
      intervalo, visitas: total, estados, unidades,
      unidadesPorVisita: total ? unidades / total : null,
      precoObservado: ps.length ? { min: Math.min(...ps), max: Math.max(...ps) } : null,
    };
  });

  const oks = visitas.filter((v) => v.estado === 'ok');
  const comDado = new Set(oks.map((v) => v.ml_item_id));
  const estadoColeta: EstadoColeta = !sync || !visitas.length ? 'sem_coleta'
    : !sync.carga_inicial_concluida_em || conj.mlbs.some((m) => !comDado.has(m)) ? 'parcial' : 'ok';
  const ultimo = precos.reduce<PrecoDia | null>((a, x) => (!a || Date.parse(x.observado_em) > Date.parse(a.observado_em) ? x : a), null);
  return {
    calendario: 'brt', alcance: conj.alcance, porMlb, serie, estadoColeta, motivo,
    coberturaDesde: oks.reduce<string | null>((a, v) => (!a || v.dia < a ? v.dia : a), null),
    precoAtual: ultimo && { preco: ultimo.preco, observadoEm: ultimo.observado_em, mlb: ultimo.ml_item_id },
  };
}
