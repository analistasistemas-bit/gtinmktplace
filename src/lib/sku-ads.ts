// Dossiê do SKU (Vendas SKU, Fatia 2c): Ads por grupo (ad_group_id). Toda soma é por grupo, deduplicada;
// ROAS/ACOS/CPC por Σ/Σ; "Lucro após Ads" só com gasto exclusivo do alvo e período coberto. Dia = data BRT
// literal do ML; hoje nunca entra. Nada daqui vai para ranking, ABC, Financeiro ou billing.
import { diaBRT, type Intervalo } from './calendario-brt';
import { round2 } from './formato';
import { diasDoIntervalo } from './sku-trafego';
import type { AlvoDossie } from './sku-dossie';
import type { AdsDia, FonteAds } from './sku-dossie-dados';
import type { FonteCusto } from './vendas-sku';

export type AlcanceAds = 'sku' | 'anuncio' | 'familia' | 'indisponivel';
export type EstadoAds = 'carregando' | 'erro' | 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso'
  | 'parcial' | 'desatualizado' | 'sem_ads' | 'ok';
export type MotivoSemLucro = 'compartilhado' | 'sem_lucro' | 'cobertura' | 'fora_dos_grupos' | null;

export interface TotaisAds {
  custo: number; cliques: number; impressoes: number; vendasDiretas: number; vendasIndiretas: number; vendasTotais: number;
  unidadesDiretas: number; unidades: number; cpc: number | null; roas: number | null; acos: number | null;
}
export interface PontoAds {
  intervalo: Intervalo;
  /** null = algum dia do intervalo fora da cobertura ou carga inicial em curso ("sem dado").
   *  Dentro da cobertura, dia sem linha é gasto zero real (o worker só deixa de gravar o que não gastou). */
  custo: number | null;
  vendas: number | null;
  /** Algum dia do intervalo ainda pode ganhar vendas atribuídas (relido < 15 dias depois dele). */
  aberto: boolean;
}
export interface GrupoAdsDossie {
  id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; status: string; campanhaId: number | null;
  /** null na carga parcial (sem despesa até a carga inicial fechar). */
  custo: number | null;
  exclusivo: boolean; mlbs: string[]; codigos: string[]; semVinculo: number;
}
export interface AdsDossie {
  estado: EstadoAds;
  alcance: AlcanceAds;
  totais: TotaisAds | null;
  lucroAposAds: number | null;
  /** Custo por trás do lucro atual (parcial = só os itens com custo; estimado = custo do cadastro).
   *  null quando não há Lucro após Ads. */
  fonteLucro: Exclude<FonteCusto, 'sem_custo'> | null;
  motivoSemLucro: MotivoSemLucro;
  /** Códigos de fora do alvo e membros sem código nos grupos do alcance. */
  compartilhadoCom: { codigos: string[]; semVinculo: number };
  /** Pelos intervalos do dossiê (Semana/Mês). */
  serie: PontoAds[];
  /** Um ponto por dia do período até ontem (a aba Ads tem "Dia" além de Semana/Mês). */
  serieDiaria: PontoAds[];
  grupos: GrupoAdsDossie[];
  coberturaDesde: string | null;
  ultimoOkEm: string | null;
  /** Dias do período (até ontem) com atribuição ainda em aberto. */
  diasAbertos: number;
  /** Motivo gravado pelo worker (sem_permissao etc.). */
  erro: string | null;
}

const DIA_MS = 86_400_000;
const DESATUALIZADO_MS = 48 * 3_600_000;
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);
export function diasEntre(desde: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= ate; d = somarDias(d, 1)) out.push(d);
  return out;
}

/** A atribuição do dia fecha quando ele foi relido 15+ dias depois (D-1 + 14 dias de janela). Medido pelo
 *  coletado_em: com o worker parado, o dia continua em aberto por mais velho que seja. */
export const atribuicaoFinal = (dia: string, coletadoEm: string) => difDias(diaBRT(Date.parse(coletadoEm)), dia) >= 15;

/** Último dia que uma coleta ok cobriu (ela lê até D-1). Coberto = dentro de [cobertura_desde, ultimoDia].
 *  Dentro da cobertura, dia sem linha = gasto zero real (conferido no worker: ele grava a série densa de
 *  todo grupo com gasto na janela; grupo sem gasto não tem linha). Fora dela = sem dado. */
export function diaCoberto(d: string, sync: { cobertura_desde: string | null; ultimo_ok_em: string | null }): boolean {
  const ultimoDia = sync.ultimo_ok_em ? somarDias(diaBRT(Date.parse(sync.ultimo_ok_em)), -1) : null;
  return sync.cobertura_desde != null && ultimoDia != null && d >= sync.cobertura_desde && d <= ultimoDia;
}

/** Σ por campo e razões Σ/Σ — nunca a média dos percentuais diários (o parser do worker nem os lê). */
export function totaisAds(linhas: AdsDia[]): TotaisAds {
  const soma = (k: 'cost' | 'clicks' | 'prints' | 'direct_amount' | 'indirect_amount' | 'total_amount' | 'direct_units' | 'units') =>
    linhas.reduce((s, l) => s + l[k], 0);
  const custo = round2(soma('cost'));
  const cliques = soma('clicks');
  const vendasTotais = round2(soma('total_amount'));
  return {
    custo, cliques, impressoes: soma('prints'),
    vendasDiretas: round2(soma('direct_amount')), vendasIndiretas: round2(soma('indirect_amount')), vendasTotais,
    unidadesDiretas: soma('direct_units'), unidades: soma('units'),
    cpc: cliques > 0 ? custo / cliques : null,
    roas: custo > 0 ? vendasTotais / custo : null,
    acos: vendasTotais > 0 ? custo / vendasTotais : null,
  };
}

/** Ads do alvo no período. Contrato com o chamador (T6):
 *  - decidir pelo `alcance` ANTES do `estado`: `alcance: 'indisponivel'` (alvo sem MLB) vem com `estado: 'ok'` e
 *    totais null — não há o que mostrar, e isso não é "sem Ads";
 *  - `estado: 'parcial'` → `totais` null e `grupos[].custo` null (nenhuma despesa até a carga inicial fechar);
 *  - `fonte` vem de `buscarFonteAds(mlbs, desde, ate)` com a faixa a partir do 1º dia do 1º intervalo da série
 *    (`faixaTrafego(intervalos)`, como na 2b) — o 1º intervalo pode começar antes do período e, sem essas
 *    linhas, fica sem valor no gráfico. */
export function montarAds(p: {
  alvo: AlvoDossie; codigos: string[];
  /** Mapa do dossiê (vendas_sku_mlbs): MLBs do alvo. */
  mlbs: Map<string, string[]>;
  intervalos: Intervalo[];
  /** Período do dossiê (ISO). */
  janela: { desde: string; ate: string };
  /** Lucro atual do período (linhaPeriodo.m.lucro); null = sem custo. */
  lucroPeriodo: number | null;
  /** linhaPeriodo.m.fonteCusto: a marca do lucro atual segue para o Lucro após Ads. */
  fonteCusto: FonteCusto | null;
  agora: Date;
  fonte: FonteAds | 'carregando' | 'erro';
}): AdsDossie {
  const cods = new Set(p.codigos);
  const mlbsAlvo = new Set([...p.mlbs].filter(([, cs]) => cs.some((c) => cods.has(c))).map(([m]) => m));
  const vazio = (estado: EstadoAds, erro: string | null = null): AdsDossie => ({
    estado, alcance: 'indisponivel', totais: null, lucroAposAds: null, fonteLucro: null, motivoSemLucro: null,
    compartilhadoCom: { codigos: [], semVinculo: 0 }, serie: [], serieDiaria: [], grupos: [], coberturaDesde: null, ultimoOkEm: null,
    diasAbertos: 0, erro,
  });
  if (!mlbsAlvo.size) return vazio('ok');
  if (p.fonte === 'carregando' || p.fonte === 'erro') return vazio(p.fonte);
  const f = p.fonte;
  const sync = f.sync;
  if (!sync) return vazio('sem_coleta');
  if (sync.estado === 'sem_permissao' || sync.estado === 'sem_advertiser' || sync.estado === 'sem_acesso') {
    return { ...vazio(sync.estado, sync.erro), ultimoOkEm: sync.ultimo_ok_em };
  }

  const hoje = diaBRT(p.agora.getTime());
  const ontem = somarDias(hoje, -1);
  const parcial = !sync.carga_inicial_ok;
  const coberto = (d: string) => diaCoberto(d, sync);
  const aberto = (d: string, coletadoEm: string | null) => !coletadoEm || !atribuicaoFinal(d, coletadoEm);

  const membros = new Map<number, Set<string>>();
  for (const m of f.membros) {
    const s = membros.get(m.ad_group_id) ?? new Set<string>();
    s.add(m.ml_item_id);
    membros.set(m.ad_group_id, s);
  }
  // Um grupo entra uma vez, por mais MLBs do alvo que ele tenha.
  const doAlvo = [...membros].filter(([, ms]) => [...ms].some((m) => mlbsAlvo.has(m))).map(([id]) => id);
  const ids = new Set(doAlvo);
  const linhas = [...new Map(f.dias.filter((d) => ids.has(d.ad_group_id) && d.dia <= ontem)
    .map((d) => [`${d.ad_group_id}|${d.dia}`, d] as const)).values()];
  const desdeDia = diaBRT(Date.parse(p.janela.desde));
  const fimJanela = diaBRT(Date.parse(p.janela.ate));
  const ateDia = fimJanela < ontem ? fimJanela : ontem;
  // Despesa do período = mesmo recorte do gráfico: só dia coberto. Na carga parcial não há despesa (totais null).
  const doPeriodo = linhas.filter((d) => d.dia >= desdeDia && d.dia <= ateDia && coberto(d.dia));
  const diasPeriodo = diasEntre(desdeDia, ateDia);

  const codigosDe = (m: string) => f.codigosDosMembros.get(m) ?? [];
  const meta = new Map(f.grupos.map((g) => [g.ad_group_id, g]));
  const grupos: GrupoAdsDossie[] = doAlvo.map((id) => {
    const ms = [...membros.get(id)!].sort();
    const codigos = [...new Set(ms.flatMap(codigosDe))].sort();
    const semVinculo = ms.filter((m) => codigosDe(m).length === 0).length;
    const g = meta.get(id); // a FK garante a linha; sem ela (RLS/leitura parcial) o grupo aparece como desconhecido
    return {
      id, tipo: g?.tipo ?? 'ITEM', status: g?.status ?? 'desconhecido', campanhaId: g?.campaign_id ?? null,
      custo: parcial ? null : round2(doPeriodo.filter((d) => d.ad_group_id === id).reduce((s, d) => s + d.cost, 0)),
      exclusivo: semVinculo === 0 && codigos.every((c) => cods.has(c)), mlbs: ms, codigos, semVinculo,
    };
  }).sort((a, b) => (b.custo ?? 0) - (a.custo ?? 0) || a.id - b.id);

  const alcance: AlcanceAds = grupos.every((g) => g.exclusivo) ? (p.alvo.tipo === 'sku' ? 'sku' : 'familia') : 'anuncio';
  const totais = parcial ? null : totaisAds(doPeriodo);
  const periodoCoberto = !parcial && diasPeriodo.length > 0 && diasPeriodo.every(coberto);
  // "Sem Ads" só se provado: zero de despesa num período inteiramente coberto.
  const estado: EstadoAds = !totais ? 'parcial'
    : !sync.ultimo_ok_em || p.agora.getTime() - Date.parse(sync.ultimo_ok_em) > DESATUALIZADO_MS ? 'desatualizado'
      : totais.custo === 0 && periodoCoberto ? 'sem_ads' : 'ok';
  // Gasto do anunciante fora de qualquer grupo listado (provável grupo excluído): a despesa do alcance pode
  // estar abaixo do real, então não há "Lucro após Ads" — a despesa continua aparecendo.
  const foraDosGrupos = sync.custo_resumo != null && sync.custo_listado != null && sync.custo_resumo - sync.custo_listado > 0.005;
  const motivoSemLucro: MotivoSemLucro = alcance === 'anuncio' ? 'compartilhado'
    : p.lucroPeriodo == null ? 'sem_lucro' : !periodoCoberto ? 'cobertura' : foraDosGrupos ? 'fora_dos_grupos' : null;
  const lucroAposAds = motivoSemLucro == null && p.lucroPeriodo != null && totais ? round2(p.lucroPeriodo - totais.custo) : null;
  const fonteLucro = lucroAposAds == null ? null : p.fonteCusto === 'parcial' || p.fonteCusto === 'estimado' ? p.fonteCusto : 'real';

  const abertoNoDia = (d: string, ls: AdsDia[]) => (ls.length ? ls.some((l) => aberto(d, l.coletado_em)) : aberto(d, sync.ultimo_ok_em));
  const porDia = new Map<string, AdsDia[]>();
  for (const l of linhas) porDia.set(l.dia, [...(porDia.get(l.dia) ?? []), l]);
  const ponto = (intervalo: Intervalo): PontoAds => {
    const ds = diasDoIntervalo(intervalo, p.agora).filter((d) => d <= ontem);
    const doIv = ds.flatMap((d) => porDia.get(d) ?? []);
    // Valor com todos os dias cobertos (dia sem linha soma 0); fora da cobertura ou carga parcial → sem valor.
    const provado = !parcial && ds.length > 0 && ds.every(coberto);
    return {
      intervalo,
      custo: provado ? round2(doIv.reduce((s, l) => s + l.cost, 0)) : null,
      vendas: provado ? round2(doIv.reduce((s, l) => s + l.total_amount, 0)) : null,
      aberto: provado && ds.some((d) => abertoNoDia(d, doIv.filter((l) => l.dia === d))),
    };
  };
  const intervaloDoDia = (d: string): Intervalo => ({
    inicio: `${d}T03:00:00.000Z`, fim: `${somarDias(d, 1)}T03:00:00.000Z`, rotulo: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
    incompleto: false, inicioParcial: false,
  });

  return {
    estado, alcance, totais, lucroAposAds, fonteLucro, motivoSemLucro,
    compartilhadoCom: {
      codigos: [...new Set(grupos.flatMap((g) => g.codigos.filter((c) => !cods.has(c))))].sort(),
      semVinculo: grupos.reduce((s, g) => s + g.semVinculo, 0),
    },
    serie: p.intervalos.map(ponto), serieDiaria: diasPeriodo.map((d) => ponto(intervaloDoDia(d))),
    grupos, coberturaDesde: sync.cobertura_desde, ultimoOkEm: sync.ultimo_ok_em,
    diasAbertos: diasPeriodo.filter((d) => abertoNoDia(d, doPeriodo.filter((l) => l.dia === d))).length,
    erro: sync.erro,
  };
}
