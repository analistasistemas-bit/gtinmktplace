// Acesso de agentes (ADR-0210, fatia 1): margem e ROAS mínimo por anúncio de UMA organização. Puro: todo IO chega
// pelas deps, já fechadas na organização da conexão (edge `agentes`); `orgId` só assina o cursor do catálogo.
// O cálculo é o do ACOS de equilíbrio da aba Campanhas (`detalheEquilibrioDoMlb`), sem fórmula própria.
import { detalheEquilibrioDoMlb, LimiteTarifa, type ItemAgora } from '../ads/campanhas.ts';
import type { Cadastro } from '../promocoes/cadastro.ts';
import { emParalelo, type QueryTarifa } from '../promocoes/sincronizar.ts';
import type { Aliquotas, ItemML, Tarifa } from '../promocoes/tipos.ts';
import { type DepsAlvo, resolverAlvo } from './alvo.ts';
import type { Candidato } from './busca.ts';

export interface DepsMargens {
  orgId: string;
  resolver: DepsAlvo;
  carregarCadastro(): Promise<Cadastro>;
  lerAliquotas(): Promise<Aliquotas | null>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  lerPrecos(ids: string[]): Promise<Map<string, ItemAgora>>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  reservarTarifas(n: number): Promise<'ok' | 'limite' | 'falha'>;
  /** Leituras de item e preço no ML (multigets de 20). */
  reservarLeituras(n: number): Promise<'ok' | 'limite' | 'falha'>;
  listarMlbs(depois: string | null, limite: number): Promise<string[]>;
  agora: Date;
}

export type MargemAnuncio = {
  mlb: string; titulo: string | null; sku: string | null; preco_brl: number | null; preco_tabela_brl: number | null;
  em_promocao: boolean | null; custo_brl: number | null; comissao_brl: number | null; frete_brl: number | null;
  imposto_brl: number | null; liquido_brl: number | null; margem_pct: number | null; roas_minimo: number | null;
  motivo: string | null;
};
export type MargemSimulada = MargemAnuncio & { preco_atual_brl: number | null };
export type Referencia = { margem_pct: number | null; roas_minimo: number | null; mlb: string | null; motivo: string | null };
type Falha = { estado: 'sem_aliquota' | 'limite_tarifas' | 'limite_leituras' | 'indisponivel' };
type Lido = { lido_em: string; tarifa_idade_max_horas: number };
export type RespostaAlvo<A = MargemAnuncio> =
  | ({ estado: 'ok'; anuncios: A[]; referencia: Referencia } & Lido)
  | { estado: 'candidatos'; candidatos: Candidato[]; lista_cortada: boolean }
  | { estado: 'nao_encontrado' | 'alvo_grande' }
  | Falha;
export type RespostaCatalogo =
  | ({ estado: 'ok'; anuncios: MargemAnuncio[]; proximo_cursor: string | null; parcial: boolean } & Lido)
  | { estado: 'cursor_invalido' }
  | Falha;

/** Comissão e frete vêm do cache `promo:` de `criarTarifaEm`, que dura até 8 horas. */
const TARIFA_IDADE_MAX_HORAS = 8;
const MAX_MLBS_ALVO = 60;
const POR_PAGINA = 50;
const MULTIGET = 20;
const PRECO_MAX = 1_000_000;
const MLB_RE = /^MLB\d+$/;
const r2 = (x: number) => Math.round(x * 100) / 100;
const roas = (m: number | null) => (m != null && m > 0 ? 100 / m : null);
const espaco = (m: number | null) => (m != null && m <= 0 ? 'sem_espaco_para_ads' : null);
// Insumo ausente nunca vira zero: o cálculo compartilhado trata comissão nula como 0 e inflaria a margem.
const naoNeg = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const utilizavel = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0;
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const aliquotasValidas = (a: unknown): a is Aliquotas => obj(a) && naoNeg(a.nacional) && naoNeg(a.importado);
const tarifaValida = (t: unknown): t is Tarifa =>
  obj(t) && obj(t.comissao) && naoNeg(t.comissao.percentual) && naoNeg(t.comissao.fixa) && naoNeg(t.frete);

/**
 * Margem de cada MLB, na ordem pedida. `precoSimulado` substitui o preço lido em todos. Reserva o orçamento de
 * tarifas uma vez, antes de calcular (2 consultas por cor). Sem item → `anuncio_indisponivel`; fora da simulação,
 * também sem a leitura de preço. A primeira `LimiteTarifa` para a fila: nada novo consulta tarifa depois dela.
 */
async function calcular(mlbs: string[], d: DepsMargens, precoSimulado: number | null): Promise<MargemSimulada[] | Falha> {
  const aliq = await d.lerAliquotas();
  if (!aliquotasValidas(aliq)) return { estado: 'sem_aliquota' };
  // Orçamento de leituras antes de tocar o ML: itens + preços, um multiget de 20 MLBs cada.
  const leituras = await d.reservarLeituras(2 * Math.ceil(mlbs.length / MULTIGET));
  if (leituras === 'limite') return { estado: 'limite_leituras' };
  if (leituras !== 'ok') return { estado: 'indisponivel' };
  const [itens, precos] = await Promise.all([d.buscarItensML(mlbs), d.lerPrecos(mlbs)]);
  // 2 consultas por cor é teto real porque a edge desliga as retentativas de comissão (Tarefa 6).
  // Um só predicado decide reserva e cálculo: anúncio sem preço utilizável nunca consulta tarifa.
  const atualDe = (m: string) => { const p = precos.get(m)?.preco; return utilizavel(p) ? p : null; };
  const precoDe = (m: string) => precoSimulado ?? atualDe(m);
  const n = mlbs.reduce((s, m) => {
    const it = itens.get(m);
    return it && precoDe(m) != null ? s + 2 * Math.max(1, it.variacoes.length) : s;
  }, 0);
  if (n > 0) {
    const res = await d.reservarTarifas(n);
    if (res === 'limite') return { estado: 'limite_tarifas' };
    if (res !== 'ok') return { estado: 'indisponivel' };
  }
  const cad = await d.carregarCadastro();
  let parou = false;
  const tarifa = async (q: QueryTarifa): Promise<Tarifa> => {
    if (parou) throw new LimiteTarifa();
    let t: unknown;
    try {
      t = await d.tarifaEm(q);
    } catch (e) {
      if (e instanceof LimiteTarifa) parou = true;
      throw e;
    }
    // Erro comum: `detalheEquilibrioDoMlb` o converte em `erro_tarifa`.
    if (!tarifaValida(t)) throw new Error('tarifa_invalida');
    return t;
  };
  try {
    return await emParalelo(mlbs, 4, async (mlb): Promise<MargemSimulada> => {
      if (parou) throw new LimiteTarifa();
      const ml = itens.get(mlb) ?? null;
      const agora = precos.get(mlb) ?? null;
      const atual = atualDe(mlb);
      const tabela = utilizavel(agora?.precoTabela) ? agora!.precoTabela : null;
      const preco = precoDe(mlb);
      const base: MargemSimulada = {
        mlb, titulo: ml?.titulo ?? null, sku: null, preco_brl: preco == null ? null : r2(preco),
        preco_tabela_brl: tabela == null ? null : r2(tabela),
        em_promocao: atual == null ? null : tabela != null && tabela > atual,
        custo_brl: null, comissao_brl: null, frete_brl: null, imposto_brl: null, liquido_brl: null,
        margem_pct: null, roas_minimo: null, motivo: null, preco_atual_brl: atual == null ? null : r2(atual),
      };
      if (!ml || (precoSimulado == null && !agora)) return { ...base, motivo: 'anuncio_indisponivel' };
      if (preco == null) return { ...base, motivo: 'sem_preco' };
      const det = await detalheEquilibrioDoMlb(ml, preco, cad, aliq, tarifa);
      const p = det.pior;
      if (det.motivo || !p || det.acosPct == null) return { ...base, motivo: det.motivo ?? 'sem_preco' };
      const finitos = [det.acosPct, p.custo, p.comissao, p.frete, p.imposto, p.liquido].every(Number.isFinite);
      if (!finitos) return { ...base, motivo: 'erro_calculo' };
      // Cada componente `_brl` é arredondado à parte (soma pode diferir 1–2 centavos); `margem_pct` vem do cálculo cru.
      return {
        ...base, sku: p.sku, custo_brl: r2(p.custo), comissao_brl: r2(p.comissao), frete_brl: r2(p.frete),
        imposto_brl: r2(p.imposto), liquido_brl: r2(p.liquido),
        // Sem arredondar: quem compara com ACOS-alvo arredonda na tela.
        margem_pct: det.acosPct, roas_minimo: roas(det.acosPct), motivo: espaco(det.acosPct),
      };
    });
  } catch (e) {
    if (e instanceof LimiteTarifa) return { estado: 'limite_tarifas' };
    throw e;
  }
}

/** Menor margem só se todos têm número: mínimo parcial esconderia o anúncio que pode estar no prejuízo. */
function referenciaDe(anuncios: MargemAnuncio[]): Referencia {
  if (!anuncios.length || anuncios.some((a) => a.margem_pct == null)) {
    return { margem_pct: null, roas_minimo: null, mlb: null, motivo: 'anuncio_sem_numero' };
  }
  const pior = anuncios.reduce((a, b) => (b.margem_pct! < a.margem_pct! ? b : a));
  return { margem_pct: pior.margem_pct, roas_minimo: roas(pior.margem_pct), mlb: pior.mlb, motivo: espaco(pior.margem_pct) };
}

const lido = (d: DepsMargens): Lido => ({ lido_em: d.agora.toISOString(), tarifa_idade_max_horas: TARIFA_IDADE_MAX_HORAS });
const semAtual = ({ preco_atual_brl: _, ...a }: MargemSimulada): MargemAnuncio => a;

async function doAlvo<A extends MargemAnuncio>(
  identificador: string, d: DepsMargens, precoSimulado: number | null, saida: (a: MargemSimulada) => A,
): Promise<RespostaAlvo<A>> {
  const alvo = await resolverAlvo(identificador, d.resolver);
  if (alvo.tipo === 'candidatos') return { estado: 'candidatos', candidatos: alvo.candidatos, lista_cortada: alvo.lista_cortada };
  if (alvo.tipo === 'nao_encontrado') return { estado: 'nao_encontrado' };
  if (alvo.mlbs.length > MAX_MLBS_ALVO) return { estado: 'alvo_grande' };
  const r = await calcular(alvo.mlbs, d, precoSimulado);
  if (!Array.isArray(r)) return r;
  const anuncios = r.map(saida);
  return { estado: 'ok', ...lido(d), anuncios, referencia: referenciaDe(anuncios) };
}

export function margemDoAlvo(identificador: string, d: DepsMargens): Promise<RespostaAlvo> {
  return doAlvo(identificador, d, null, semAtual);
}

/** Mesmo retorno de `margemDoAlvo` com o preço informado em todos os anúncios; `preco_atual_brl` traz o lido. */
export function simularMargem(
  identificador: string, precoBrl: unknown, d: DepsMargens,
): Promise<RespostaAlvo<MargemSimulada> | { estado: 'preco_invalido' }> {
  // O ML só aceita 2 casas: arredonda antes de validar, e `preco_brl` é exatamente o preço da conta.
  const preco = typeof precoBrl === 'number' && Number.isFinite(precoBrl) ? r2(precoBrl) : NaN;
  if (!(preco > 0 && preco <= PRECO_MAX)) return Promise.resolve({ estado: 'preco_invalido' });
  return doAlvo(identificador, d, preco, (a) => a);
}

// Cursor opaco, não secreto: o campo `o` amarra a página à organização da conexão.
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cursorDe = (orgId: string, ultimo: string) => b64url(JSON.stringify({ o: orgId, d: ultimo }));
function lerCursor(c: string, orgId: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(c)) return null;
  try {
    const v: unknown = JSON.parse(atob(c.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const { o, d } = v as Record<string, unknown>;
    return o === orgId && typeof d === 'string' && MLB_RE.test(d) ? d : null;
  } catch {
    return null;
  }
}

/** 50 MLBs por página, em ordem crescente de MLB. `parcial`: algum anúncio sem número por falha de leitura. */
export async function margensDoCatalogo(cursor: string | null | undefined, d: DepsMargens): Promise<RespostaCatalogo> {
  let depois: string | null = null;
  if (cursor != null) {
    depois = typeof cursor === 'string' ? lerCursor(cursor, d.orgId) : null;
    if (depois == null) return { estado: 'cursor_invalido' };
  }
  const mlbs = await d.listarMlbs(depois, POR_PAGINA + 1);
  const pagina = mlbs.slice(0, POR_PAGINA);
  const proximo_cursor = mlbs.length > POR_PAGINA ? cursorDe(d.orgId, pagina[pagina.length - 1]) : null;
  if (!pagina.length) return { estado: 'ok', ...lido(d), anuncios: [], proximo_cursor, parcial: false };
  const r = await calcular(pagina, d, null);
  if (!Array.isArray(r)) return r;
  const anuncios = r.map(semAtual);
  const parcial = anuncios.some((a) => a.motivo === 'erro_tarifa' || a.motivo === 'anuncio_indisponivel');
  return { estado: 'ok', ...lido(d), anuncios, proximo_cursor, parcial };
}
