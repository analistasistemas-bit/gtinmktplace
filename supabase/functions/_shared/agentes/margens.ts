// Acesso de agentes (ADR-0210, fatia 1): margem e ROAS mínimo por anúncio de UMA organização. Puro: todo IO chega
// pelas deps, já fechadas na organização da conexão (edge `agentes`); `orgId` só assina o cursor do catálogo.
// O cálculo é o do ACOS de equilíbrio da aba Campanhas (`detalheEquilibrioDoMlb`), sem fórmula própria.
import { detalheEquilibrioDoMlb, LimiteTarifa, type ItemAgora } from '../ads/campanhas.ts';
import type { Cadastro } from '../promocoes/cadastro.ts';
import { emParalelo, type QueryTarifa } from '../promocoes/sincronizar.ts';
import type { Aliquotas, ItemML, Tarifa } from '../promocoes/tipos.ts';
import { type Candidato, type DepsAlvo, resolverAlvo } from './alvo.ts';

export interface DepsMargens {
  orgId: string;
  resolver: DepsAlvo;
  carregarCadastro(): Promise<Cadastro>;
  lerAliquotas(): Promise<Aliquotas | null>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  lerPrecos(ids: string[]): Promise<Map<string, ItemAgora>>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  reservarTarifas(n: number): Promise<'ok' | 'limite' | 'falha'>;
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
type Falha = { estado: 'sem_aliquota' | 'limite_tarifas' | 'indisponivel' };
type Lido = { lido_em: string; tarifa_idade_max_horas: number };
export type RespostaAlvo<A = MargemAnuncio> =
  | ({ estado: 'ok'; anuncios: A[]; referencia: Referencia } & Lido)
  | { estado: 'candidatos'; candidatos: Candidato[] }
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
const PRECO_MAX = 1_000_000;
const MLB_RE = /^MLB\d+$/;
const r2 = (x: number) => Math.round(x * 100) / 100;
const roas = (m: number | null) => (m != null && m > 0 ? 100 / m : null);
const espaco = (m: number | null) => (m != null && m <= 0 ? 'sem_espaco_para_ads' : null);

/**
 * Margem de cada MLB, na ordem pedida. `precoSimulado` substitui o preço lido em todos. Reserva o orçamento de
 * tarifas uma vez, antes de calcular (2 consultas por cor). MLB sem item ou sem preço lido → `anuncio_indisponivel`.
 */
async function calcular(mlbs: string[], d: DepsMargens, precoSimulado: number | null): Promise<MargemSimulada[] | Falha> {
  const aliq = await d.lerAliquotas();
  if (!aliq) return { estado: 'sem_aliquota' };
  const [itens, precos] = await Promise.all([d.buscarItensML(mlbs), d.lerPrecos(mlbs)]);
  const n = mlbs.reduce((s, m) => { const it = itens.get(m); return it ? s + 2 * Math.max(1, it.variacoes.length) : s; }, 0);
  if (n > 0) {
    const res = await d.reservarTarifas(n);
    if (res === 'limite') return { estado: 'limite_tarifas' };
    if (res !== 'ok') return { estado: 'indisponivel' };
  }
  const cad = await d.carregarCadastro();
  try {
    return await emParalelo(mlbs, 4, async (mlb): Promise<MargemSimulada> => {
      const ml = itens.get(mlb) ?? null;
      const agora = precos.get(mlb) ?? null;
      const atual = agora?.preco ?? null;
      const tabela = agora?.precoTabela ?? null;
      const preco = precoSimulado ?? atual;
      const base: MargemSimulada = {
        mlb, titulo: ml?.titulo ?? null, sku: null, preco_brl: preco == null ? null : r2(preco),
        preco_tabela_brl: tabela == null ? null : r2(tabela),
        em_promocao: atual == null ? null : tabela != null && tabela > atual,
        custo_brl: null, comissao_brl: null, frete_brl: null, imposto_brl: null, liquido_brl: null,
        margem_pct: null, roas_minimo: null, motivo: null, preco_atual_brl: atual == null ? null : r2(atual),
      };
      if (!ml || !agora) return { ...base, motivo: 'anuncio_indisponivel' };
      const det = await detalheEquilibrioDoMlb(ml, preco, cad, aliq, d.tarifaEm);
      const p = det.pior;
      if (det.motivo || !p || det.acosPct == null) return { ...base, motivo: det.motivo ?? 'sem_preco' };
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
  if (alvo.tipo === 'candidatos') return { estado: 'candidatos', candidatos: alvo.candidatos };
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
  if (typeof precoBrl !== 'number' || !Number.isFinite(precoBrl) || precoBrl <= 0 || precoBrl > PRECO_MAX) {
    return Promise.resolve({ estado: 'preco_invalido' });
  }
  return doAlvo(identificador, d, precoBrl, (a) => a);
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
export async function margensDoCatalogo(cursor: string | null, d: DepsMargens): Promise<RespostaCatalogo> {
  let depois: string | null = null;
  if (cursor !== null) {
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
