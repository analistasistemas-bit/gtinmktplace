// Painel de Ads com margem real (I2, ADR-0179 D1–D4; spikes 053/054). Regra pura: cruza o gasto por grupo
// (ad_group_id) com o lucro por família. Grupo é atribuído inteiro a UMA família ou fica compartilhado —
// nunca rateado. A reconciliação com a série da conta é em centavos inteiros; só a saída volta a reais.
// Gasto parcial (fora da cobertura) ou lucro desconhecido (antes do histórico) nunca vira resultado.
import { atribuicaoFinal, diaCoberto, diasEntre, historicoCobre } from './sku-ads';
import type { FonteCusto } from './vendas-sku';

export interface SyncPainel {
  estado: string; erro: string | null; ultimo_ok_em: string | null; carga_inicial_ok: boolean;
  cobertura_desde: string | null; conta_cobertura_desde: string | null;
}
export interface ContaDia { dia: string; cost: number; clicks: number; prints: number; direct_amount: number;
  indirect_amount: number; total_amount: number; coletado_em: string }
export interface GrupoPainel { ad_group_id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; status: string; cost: number;
  clicks: number; prints: number; direct_amount: number; indirect_amount: number; total_amount: number; membros: string[] }
export interface FontePainelAds { sync: SyncPainel | null; conta: ContaDia[]; grupos: GrupoPainel[] }
export interface LucroFamilia { nome: string | null; lucro: number | null; brutoComCusto: number; fonteCusto: FonteCusto }
export interface MetricasAds { custo: number; vendasDiretas: number; vendasTotais: number; cliques: number;
  impressoes: number; roas: number | null; roasDireto: number | null; acos: number | null }
export type EstadoPainel = 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso' | 'coletando' | 'sem_ads' | 'ok';
export type Semaforo = 'dentro' | 'acima' | 'sem_espaco';
export type MotivoFamilia = 'compartilhado' | 'cobertura' | 'historico' | 'sem_vendas' | 'sem_custo' | 'custo_parcial' | null;
export interface FamiliaPainel extends MetricasAds {
  codigoPai: string; nome: string | null;
  /** Grupos exclusivos da família (os compartilhados só entram em `custoCompartilhado`). */
  grupos: number;
  custoCompartilhado: number;           // Σ dos grupos compartilhados que tocam esta família (NÃO somado em `custo`)
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null;
  acosDireto: number | null;            // custo ÷ vendas diretas — a base do semáforo
  acosEquilibrio: number | null; semaforo: Semaforo | null; motivo: MotivoFamilia;
  fonteCusto: FonteCusto | null;
}
export interface ContaPainel extends MetricasAds {
  lucroAntes: number | null; resultado: number | null; margemConsumida: number | null; fonteCusto: FonteCusto | null;
  emFamilias: number; compartilhado: number;
  naoIdentificado: number | null; naoIdentificadoPct: number | null;   // null quando divergente
  divergente: boolean;                  // Σ grupos com membro > total da conta (em centavos): decomposição suspensa
  diasAbertos: number;
}
export interface PainelAds {
  estado: EstadoPainel; desatualizado: boolean;
  gruposCobertos: boolean;              // período inteiro dentro da cobertura dos grupos (mesma regra do dossiê)
  semaforoLiberado: boolean;            // = baseAcosValidada
  conta: ContaPainel | null;            // null = série da conta não cobre o período
  contaMotivo: 'cobertura' | null;
  familias: FamiliaPainel[];            // ordenadas por custo desc
  compartilhados: { id: number; custo: number; familias: string[]; semCodigo: number }[];
}

/** Liga o semáforo. Ligado pelo Diego em 05/10/2026 com os números do spike 055 (mesma base de preço; o ML conta
 *  canceladas, ACOS 1,5–7 % otimista). Custo parcial, compartilhado, cobertura e histórico seguem sem semáforo. */
export const BASE_ACOS_VALIDADA = true;

const DESATUALIZADO_MS = 48 * 3_600_000;
const cents = (x: number) => Math.round(x * 100);
const div = (a: number, b: number) => (b !== 0 ? a / b : null);

interface Soma { custoC: number; diretasC: number; totaisC: number; cliques: number; impressoes: number }
const somaVazia = (): Soma => ({ custoC: 0, diretasC: 0, totaisC: 0, cliques: 0, impressoes: 0 });
function acumular(s: Soma, l: { cost: number; direct_amount: number; total_amount: number; clicks: number; prints: number }) {
  s.custoC += cents(l.cost); s.diretasC += cents(l.direct_amount); s.totaisC += cents(l.total_amount);
  s.cliques += l.clicks; s.impressoes += l.prints;
}
/** Métricas por Σ/Σ; denominador 0 → null. */
function somarMetricas(s: Soma): MetricasAds {
  const custo = s.custoC / 100; const vendasDiretas = s.diretasC / 100; const vendasTotais = s.totaisC / 100;
  return { custo, vendasDiretas, vendasTotais, cliques: s.cliques, impressoes: s.impressoes,
    roas: div(vendasTotais, custo), roasDireto: div(vendasDiretas, custo), acos: div(custo, vendasTotais) };
}

/** Família exclusiva do grupo, ou compartilhado (MLB sem código, código sem família ou 2+ famílias). */
function bucketDoGrupo(g: GrupoPainel, codigosPorMlb: Map<string, string[]>, familiaDoCodigo: Map<string, string>) {
  const familias = new Set<string>();
  let semCodigo = 0;
  for (const m of g.membros) {
    const cods = codigosPorMlb.get(m) ?? [];
    if (!cods.length) semCodigo++;
    for (const c of cods) {
      const f = familiaDoCodigo.get(c);
      if (f == null) semCodigo++; else familias.add(f);
    }
  }
  const fams = [...familias].sort();
  return semCodigo === 0 && fams.length === 1 ? { exclusiva: fams[0] } : { exclusiva: null, familias: fams, semCodigo };
}

/** Lucro antes de Ads e motivo próprio do lucro (precedência do primeiro que casar). */
function lucroDaFamilia(l: LucroFamilia | undefined): { lucroAntes: number | null; motivo: MotivoFamilia } {
  if (!l) return { lucroAntes: 0, motivo: 'sem_vendas' };
  if (l.lucro == null && l.fonteCusto === 'sem_custo') return { lucroAntes: null, motivo: 'sem_custo' };
  if (l.lucro == null) return { lucroAntes: 0, motivo: 'sem_vendas' };
  return { lucroAntes: l.lucro, motivo: l.fonteCusto === 'parcial' ? 'custo_parcial' : null };
}

/** Compara o ACOS direto (venda do próprio anúncio) com o ACOS de equilíbrio. */
function semaforo(acosEquilibrio: number | null, vendasDiretas: number, acosDireto: number | null): Semaforo | null {
  if (acosEquilibrio == null) return null;
  if (acosEquilibrio <= 0) return 'sem_espaco';
  if (vendasDiretas === 0 || acosDireto == null) return 'acima';
  return acosDireto <= acosEquilibrio ? 'dentro' : 'acima';
}

function estadoDo(sync: SyncPainel | null, contaCoberta: boolean, contaCustoC: number, gruposComCusto: boolean): EstadoPainel {
  if (!sync) return 'sem_coleta';
  if (sync.estado === 'sem_permissao' || sync.estado === 'sem_advertiser' || sync.estado === 'sem_acesso') return sync.estado;
  if (!sync.carga_inicial_ok) return 'coletando';
  // Sem cobertura nunca afirma zero.
  if (contaCoberta && contaCustoC === 0 && !gruposComCusto) return 'sem_ads';
  return 'ok';
}

export function montarPainelAds(p: {
  fonte: FontePainelAds; janela: { desde: string; ate: string };   // dias BRT 'YYYY-MM-DD'
  codigosPorMlb: Map<string, string[]>;           // de buscarCodigosMlbs
  familiaDoCodigo: Map<string, string>;           // código → codigoPai (catálogo)
  nomeDaFamilia: Map<string, string>;             // codigoPai → nome (catálogo): família sem venda no período
  lucroPorFamilia: Map<string, LucroFamilia>;     // codigoPai → lucro do período (só famílias com linha de venda)
  lucroConta: { lucro: number | null; fonteCusto: FonteCusto };
  historicoDesde: string | null;                  // VendasSku.historicoDesde (ISO) — antes dele não há venda conhecida
  baseAcosValidada: boolean;                      // BASE_ACOS_VALIDADA (spike 055)
  agora: Date;
}): PainelAds {
  const { sync, grupos } = p.fonte;
  const dias = diasEntre(p.janela.desde, p.janela.ate);
  const gruposCobertos = !!sync && sync.carga_inicial_ok && dias.length > 0 && dias.every((d) => diaCoberto(d, sync));
  const historicoOk = historicoCobre(p.historicoDesde, p.janela.desde);

  // Grupos → famílias exclusivas ou compartilhados.
  const porFamilia = new Map<string, { soma: Soma; grupos: number; compartilhadoC: number }>();
  const fam = (c: string) => {
    let f = porFamilia.get(c);
    if (!f) porFamilia.set(c, (f = { soma: somaVazia(), grupos: 0, compartilhadoC: 0 }));
    return f;
  };
  const compartilhados: PainelAds['compartilhados'] = [];
  let emFamiliasC = 0; let compartilhadoC = 0;
  for (const g of grupos) {
    if (!g.membros.length) continue;   // sem membro → não identificado (entra pela diferença com a conta)
    const b = bucketDoGrupo(g, p.codigosPorMlb, p.familiaDoCodigo);
    const c = cents(g.cost);
    if (b.exclusiva != null) {
      const f = fam(b.exclusiva);
      acumular(f.soma, g); f.grupos++;
      emFamiliasC += c;
    } else {
      for (const codigo of b.familias) fam(codigo).compartilhadoC += c;
      compartilhados.push({ id: g.ad_group_id, custo: c / 100, familias: b.familias, semCodigo: b.semCodigo });
      compartilhadoC += c;
    }
  }
  compartilhados.sort((a, b) => b.custo - a.custo || a.id - b.id);

  const familias: FamiliaPainel[] = [...porFamilia].map(([codigoPai, f]) => {
    const m = somarMetricas(f.soma);
    const l = p.lucroPorFamilia.get(codigoPai);
    const proprio = lucroDaFamilia(l);
    const lucroAntes = historicoOk ? proprio.lucroAntes : null;
    const custoCompartilhado = f.compartilhadoC / 100;
    // Bloqueio do resultado: período parcial dos grupos, lucro desconhecido, despesa compartilhada.
    const motivo: MotivoFamilia = !gruposCobertos ? 'cobertura' : !historicoOk ? 'historico'
      : f.compartilhadoC > 0 ? 'compartilhado' : proprio.motivo;
    const bloqueado = motivo === 'cobertura' || motivo === 'historico' || motivo === 'compartilhado';
    const acosDireto = div(m.custo, m.vendasDiretas);
    const acosEquilibrio = proprio.motivo !== 'custo_parcial' && lucroAntes != null && l && l.brutoComCusto > 0
      ? lucroAntes / l.brutoComCusto : null;
    return {
      ...m, codigoPai, nome: l?.nome ?? p.nomeDaFamilia.get(codigoPai) ?? null, grupos: f.grupos, custoCompartilhado, lucroAntes,
      resultado: !bloqueado && lucroAntes != null ? (cents(lucroAntes) - f.soma.custoC) / 100 : null,
      margemConsumida: !bloqueado && lucroAntes != null && lucroAntes > 0 ? m.custo / lucroAntes : null,
      acosDireto, acosEquilibrio,
      semaforo: p.baseAcosValidada && !bloqueado ? semaforo(acosEquilibrio, m.vendasDiretas, acosDireto) : null,
      motivo, fonteCusto: l?.fonteCusto ?? null,
    };
  }).sort((a, b) => b.custo - a.custo || a.codigoPai.localeCompare(b.codigoPai));

  // Série da conta: só vale se cobre todo dia do período.
  const contaDias = p.fonte.conta.filter((d) => d.dia >= p.janela.desde && d.dia <= p.janela.ate);
  const contaCoberta = !!sync?.conta_cobertura_desde && sync.conta_cobertura_desde <= p.janela.desde
    && new Set(contaDias.map((d) => d.dia)).size >= dias.length;
  const somaConta = somaVazia();
  for (const d of contaDias) acumular(somaConta, d);
  let conta: ContaPainel | null = null;
  if (contaCoberta) {
    const custoC = somaConta.custoC;
    const divergente = emFamiliasC + compartilhadoC > custoC;   // um centavo já é divergência
    const naoIdentificadoC = custoC - emFamiliasC - compartilhadoC;
    const lucroAntes = historicoOk ? p.lucroConta.lucro : null;
    conta = {
      ...somarMetricas(somaConta),
      lucroAntes,
      resultado: lucroAntes != null ? (cents(lucroAntes) - custoC) / 100 : null,
      margemConsumida: lucroAntes != null && lucroAntes > 0 ? custoC / 100 / lucroAntes : null,
      fonteCusto: historicoOk ? p.lucroConta.fonteCusto : null,
      emFamilias: emFamiliasC / 100, compartilhado: compartilhadoC / 100,
      naoIdentificado: divergente ? null : naoIdentificadoC / 100,
      naoIdentificadoPct: divergente || custoC === 0 ? null : naoIdentificadoC / custoC,
      divergente,
      diasAbertos: contaDias.filter((d) => !atribuicaoFinal(d.dia, d.coletado_em)).length,
    };
  }

  return {
    estado: estadoDo(sync, contaCoberta, somaConta.custoC, grupos.some((g) => cents(g.cost) > 0)),
    desatualizado: !sync?.ultimo_ok_em || p.agora.getTime() - Date.parse(sync.ultimo_ok_em) > DESATUALIZADO_MS,
    gruposCobertos, semaforoLiberado: p.baseAcosValidada,
    conta, contaMotivo: conta ? null : 'cobertura',
    familias, compartilhados,
  };
}
