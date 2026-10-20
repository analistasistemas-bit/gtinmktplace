// Aba Campanhas do /ads (emenda ADR-0179 de 2026-10-20, spike 057): campanhas e anúncios patrocinados como estão
// AGORA, com o ACOS de equilíbrio pelo preço de cada MLB. SÓ GET no ML. Puro: IO entra pelas deps (fiação na edge
// `ads-campanhas`), sem Deno — o vitest carrega.
import { resolverPack, type Cadastro } from '../promocoes/cadastro.ts';
import { liquidoNoPreco } from '../promocoes/projecao.ts';
import { emParalelo, type QueryTarifa } from '../promocoes/sincronizar.ts';
import type { Aliquotas, ItemML, Tarifa } from '../promocoes/tipos.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';
import { HEADERS_ADS, HEADERS_ADVERTISER, urlAdvertiser } from './fiacao.ts';
import { classificarResposta, parseAdvertiser } from './parsers.ts';

export interface CampanhaAds {
  id: number; nome: string; status: 'active' | 'paused'; estrategia: string | null;
  roasObjetivo: number | null; acosObjetivo: number | null; orcamentoDiario: number | null;
}
export interface ItemAgora { status: string; subStatus: string[]; estoque: number | null; preco: number | null }
export interface Equilibrio { acosPct: number | null; motivo: string | null }
export interface AnuncioPatrocinado {
  mlb: string; campanhaId: number; grupoId: number | null; statusAds: string; catalogo: boolean;
  titulo: string | null; thumbnail: string | null; permalink: string | null;
  item: ItemAgora | null; equilibrio: Equilibrio;
}
type AnuncioBase = Omit<AnuncioPatrocinado, 'item' | 'equilibrio'>;
export type RespostaCampanhas =
  | { ok: true; estado: 'sem_conexao' | 'sem_advertiser' | 'sem_acesso' | 'sem_permissao' }
  | { ok: true; estado: 'ok'; lidoEm: string; aliquotasConfirmadas: boolean; projecaoLimitada: boolean;
      publicadosPorFamilia: Record<string, string[]> | null; campanhas: CampanhaAds[]; anuncios: AnuncioPatrocinado[] };

/** Tetos de trabalho por leitura (plano 2026-10-20, revisão Codex): nada é truncado em silêncio. */
export const LIMITES_CAMPANHAS = { paginas: 40, cadastro: 20_000, mlbs: 200, cores: 300, tarifas: 600 };
export class LimiteTarifa extends Error {}

export interface RespostaGet { status: number; corpo: unknown }
export interface DepsCampanhas {
  /** GET no ML; nunca lança por status HTTP. */
  get(path: string, headers: Record<string, string>): Promise<RespostaGet>;
  /** Hoje em BRT, `YYYY-MM-DD`. */
  hoje: string;
  contarCadastro(): Promise<number>;
  carregarCadastro(): Promise<Cadastro>;
  lerAliquotas(): Promise<Aliquotas | null>;
  buscarItensML(ids: string[]): Promise<Map<string, ItemML>>;
  tarifaEm(q: QueryTarifa): Promise<Tarifa>;
  lerPublicados(): Promise<Record<string, string[]>>;
}

const BASE = '/marketplace/advertising/MLB';
const LIMITE_PAGINA = 50;
const MLB_RE = /^MLB\d+$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const idPositivo = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const numOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOuNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const totalDe = (c: Obj): number | null => {
  const t = obj(c.paging) ? c.paging.total : null;
  return typeof t === 'number' && Number.isInteger(t) && t >= 0 ? t : null;
};

export const urlCampanhas = (adv: number, desde: string, ate: string, offset: number) =>
  `${BASE}/advertisers/${adv}/product_ads/campaigns/search?limit=${LIMITE_PAGINA}&offset=${offset}`
  + `&date_from=${desde}&date_to=${ate}&filters[status]=active,paused`;
export const urlAnunciosCampanha = (adv: number, campanha: number, desde: string, ate: string, offset: number) =>
  `${BASE}/advertisers/${adv}/product_ads/ads/search?limit=${LIMITE_PAGINA}&offset=${offset}`
  + `&date_from=${desde}&date_to=${ate}&filters[campaign_id]=${campanha}`;

/** `campaigns/search` (uma página). Status fora de active/paused é ignorado (o filtro já pede só esses). */
export function parseCampanhas(corpo: unknown): { total: number; campanhas: CampanhaAds[] } | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const total = totalDe(corpo);
  if (total == null) return null;
  const campanhas: CampanhaAds[] = [];
  for (const c of corpo.results) {
    if (!obj(c)) return null;
    const id = idPositivo(c.id);
    if (id == null || typeof c.status !== 'string') return null;
    if (c.status !== 'active' && c.status !== 'paused') continue;
    campanhas.push({
      id, nome: strOuNull(c.name) ?? `Campanha ${id}`, status: c.status, estrategia: strOuNull(c.strategy),
      roasObjetivo: numOuNull(c.roas_target), acosObjetivo: numOuNull(c.acos_target),
      orcamentoDiario: numOuNull(c.daily_budget) ?? numOuNull(c.budget),
    });
  }
  return { total, campanhas };
}

/** `ads/search` (uma página). MLB inválido ou sem campanha → null: lista parcial nunca é devolvida. */
export function parseAnunciosPatrocinados(corpo: unknown): { total: number; anuncios: AnuncioBase[] } | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const total = totalDe(corpo);
  if (total == null) return null;
  const anuncios: AnuncioBase[] = [];
  for (const a of corpo.results) {
    if (!obj(a) || typeof a.item_id !== 'string' || !MLB_RE.test(a.item_id)) return null;
    const campanhaId = idPositivo(a.campaign_id);
    if (campanhaId == null || typeof a.status !== 'string') return null;
    anuncios.push({
      mlb: a.item_id, campanhaId, grupoId: idPositivo(a.ad_group_id), statusAds: a.status,
      catalogo: a.catalog_listing === true, titulo: strOuNull(a.title), thumbnail: strOuNull(a.thumbnail),
      permalink: strOuNull(a.permalink),
    });
  }
  return { total, anuncios };
}

export const CAMPOS_ITEM_AGORA = 'id,status,sub_status,available_quantity,price';

/** `/items/bulk` com CAMPOS_ITEM_AGORA → status por MLB. Só entra o 200 com `status`; o resto fica desconhecido. */
export function parseItensBulk(json: unknown, ids: readonly string[]): Map<string, ItemAgora> {
  const m = new Map<string, ItemAgora>();
  const env = comoEnvelopeAntigo(json, ids);
  if (!Array.isArray(env)) return m;
  for (const e of env) {
    if (!obj(e) || e.code !== 200 || !obj(e.body)) continue;
    const b = e.body;
    if (typeof b.id !== 'string' || typeof b.status !== 'string' || b.status === '') continue;
    const estoque = numOuNull(b.available_quantity);
    m.set(b.id, {
      status: b.status,
      subStatus: Array.isArray(b.sub_status) ? b.sub_status.filter((s): s is string => typeof s === 'string') : [],
      estoque, preco: numOuNull(b.price),
    });
  }
  return m;
}

/** As cores do anúncio, como em `projetarItem` (promocoes/sincronizar.ts). */
function coresDe(ml: ItemML) {
  return ml.variacoes.length
    ? ml.variacoes.map((v) => ({ variation_id: v.variation_id, sku: v.sku ?? ml.sku, gtin: v.gtin ?? ml.gtin, unidades: v.unidades ?? ml.unidades }))
    : [{ variation_id: null, sku: ml.sku, gtin: ml.gtin, unidades: ml.unidades }];
}

/**
 * ACOS de equilíbrio pelo preço (glossário): (líquido − custo) ÷ preço, pior cor. Qualquer cor sem referência deixa
 * o MLB sem referência — nunca mínimo parcial. Não usa `projetarCor` porque ele exige piso, que não entra aqui.
 * Comissão/frete estimados chegam como exceção da tarifa (TarifaEstimada) → `erro_tarifa`; sem dimensão o frete
 * sairia do pacote padrão (ml/frete.ts) → `sem_dimensao`. `LimiteTarifa` sobe para o orquestrador.
 */
export async function equilibrioDoMlb(
  ml: ItemML, preco: number | null, cad: Cadastro, aliq: Aliquotas, tarifaEm: (q: QueryTarifa) => Promise<Tarifa>,
): Promise<Equilibrio> {
  const sem = (motivo: string): Equilibrio => ({ acosPct: null, motivo });
  const resolvidas = [];
  for (const c of coresDe(ml)) {
    const r = resolverPack(cad, { item_id: ml.id, variation_id: c.variation_id, sku: c.sku, gtin: c.gtin }, c.unidades, ml.formato_kit);
    if (typeof r === 'string') return sem(r);
    if (!r) return sem('sem_cadastro');
    // Decisão Codex B (2026-10-20): `r.kit` é o pacote efetivo; escalado a partir de um cadastro que não é kit
    // próprio, nada prova que o custo era unitário (Avil: custo do pacote ×10 → −344 %). Nesta tela não sai número;
    // a Central de Promoções e o resolverPack seguem como estão (correção compartilhada exige ADR próprio).
    const fonte = cad.porId.get(r.variacao_id);
    if (!fonte) return sem('sem_cadastro');
    if (r.kit > 1 && fonte.kit === 1) return sem('pacote_a_conferir');
    if (r.custo == null || r.custo <= 0) return sem('sem_custo');
    if (r.origem == null) return sem('sem_origem');
    if (r.dim == null) return sem('sem_dimensao');
    resolvidas.push({ custo: r.custo, origem: r.origem, dim: r.dim });
  }
  if (preco == null || preco <= 0) return sem('sem_preco');
  if (!ml.categoria || !ml.listing_type_id) return sem('sem_categoria');
  let menor = Infinity;
  for (const r of resolvidas) {
    let t: Tarifa;
    try {
      t = await tarifaEm({ preco, categoria: ml.categoria, listingType: ml.listing_type_id, dim: r.dim });
    } catch (e) {
      if (e instanceof LimiteTarifa) throw e;
      return sem('erro_tarifa');
    }
    const aliquota = r.origem === 'importado' ? aliq.importado : aliq.nacional;
    menor = Math.min(menor, ((liquidoNoPreco(preco, t, aliquota) - r.custo) * 100) / preco);
  }
  // Sem arredondar: 19,996 % virando 20 % esconderia o alerta contra um ACOS-alvo de 20 % (arredonda a tela).
  return { acosPct: menor, motivo: null };
}

/** Pai (`anuncios_externos`) + filhos UP (`anuncios_externos_itens`) → MLBs publicados por código pai, sem repetir. */
export function montarPublicados(
  pais: { id: string; codigo_pai: string; item_externo_id: string | null }[],
  filhos: { anuncio_externo_id: string; item_externo_id: string | null }[],
): Record<string, string[]> {
  const codigoDoPai = new Map(pais.map((p) => [p.id, p.codigo_pai]));
  const por = new Map<string, Set<string>>();
  const add = (codigo: string | undefined, mlb: string | null) => {
    if (!codigo || !mlb) return;
    if (!por.has(codigo)) por.set(codigo, new Set());
    por.get(codigo)!.add(mlb);
  };
  for (const p of pais) add(p.codigo_pai, p.item_externo_id);
  for (const f of filhos) add(codigoDoPai.get(f.anuncio_externo_id), f.item_externo_id);
  return Object.fromEntries([...por].map(([k, s]) => [k, [...s]]));
}

/** Lê de 1000 em 1000 (max_rows do PostgREST) até a primeira página incompleta. */
export async function lerTodasPaginas<T>(pagina: (de: number, ate: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const p = await pagina(de, de + 999);
    out.push(...p);
    if (p.length < 1000) return out;
  }
}

const diaMenos = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

export async function lerCampanhasAds(deps: DepsCampanhas, lidoEm: string): Promise<RespostaCampanhas> {
  const exigir = (r: RespostaGet, oque: string) => {
    if (r.status < 200 || r.status >= 300) throw new Error(`ML ${r.status} em ${oque}`);
  };
  const adv = await deps.get(urlAdvertiser(), HEADERS_ADVERTISER);
  const classe = classificarResposta(adv);
  if (classe === 'sem_acesso' || classe === 'sem_permissao') return { ok: true, estado: classe };
  exigir(adv, 'advertisers');
  const advId = parseAdvertiser(adv.corpo);
  if (advId == null) return { ok: true, estado: 'sem_advertiser' };

  // Leituras do banco em paralelo com o ML (medido na Avil: o IO em série dominava). O `.catch` vazio só evita
  // rejeição não tratada se o ML falhar antes; cada promessa é aguardada (e o erro sobe) mais abaixo.
  const aliqP = deps.lerAliquotas();
  const contP = deps.contarCadastro();
  const cadP = Promise.all([aliqP, contP]).then(([a, n]) => (a && n <= LIMITES_CAMPANHAS.cadastro ? deps.carregarCadastro() : null));
  const pubP = deps.lerPublicados().then((x): Record<string, string[]> | null => x, (e) => {
    console.warn('[ads-campanhas] publicados indisponíveis', { erro: e instanceof Error ? e.message : String(e) });
    return null;
  });
  for (const pr of [aliqP, contP, cadP]) pr.catch(() => {});

  const ate = deps.hoje, desde = diaMenos(ate, 7);
  // Um contador por recurso: as páginas de campanhas não comem o teto dos anúncios.
  const paginas = { campanhas: 0, anuncios: 0 };
  const paginar = async <T>(url: (offset: number) => string, parse: (c: unknown) => { total: number; itens: T[] } | null,
    oque: string, conta: keyof typeof paginas) => {
    const out: T[] = [];
    for (let offset = 0; ; offset += LIMITE_PAGINA) {
      if (++paginas[conta] > LIMITES_CAMPANHAS.paginas) throw new Error(`teto de ${LIMITES_CAMPANHAS.paginas} páginas em ${oque}`);
      const r = await deps.get(url(offset), HEADERS_ADS);
      exigir(r, oque);
      const p = parse(r.corpo);
      if (!p) throw new Error(`${oque}: resposta inválida`);
      out.push(...p.itens);
      if (out.length >= p.total) return out;
      // Página vazia antes do total: lista incompleta nunca sai como sucesso.
      if (p.itens.length === 0) throw new Error(`${oque}: página vazia antes do total (${out.length} de ${p.total})`);
    }
  };
  const campanhas = await paginar((o) => urlCampanhas(advId, desde, ate, o),
    (c) => { const p = parseCampanhas(c); return p && { total: p.total, itens: p.campanhas }; }, 'campaigns/search', 'campanhas');
  campanhas.sort((a, b) => (a.status === b.status ? a.nome.localeCompare(b.nome) : a.status === 'active' ? -1 : 1));
  const porCampanha = await emParalelo(campanhas, 4, (c) => paginar((o) => urlAnunciosCampanha(advId, c.id, desde, ate, o),
    (x) => { const p = parseAnunciosPatrocinados(x); return p && { total: p.total, itens: p.anuncios }; }, 'ads/search', 'anuncios'));
  const bases: AnuncioBase[] = [];
  campanhas.forEach((c, i) => {
    const vistos = new Set<string>();
    // O filtro por campanha do ML não é confiável: na Avil a busca de uma campanha pausada trouxe 289 anúncios
    // `idle` de outra campanha, fora de active/paused (spike 057). Só fica o que é da campanha pedida.
    for (const a of porCampanha[i]) if (a.campanhaId === c.id && !vistos.has(a.mlb)) { vistos.add(a.mlb); bases.push(a); }
  });

  // Status do item agora: bloco com erro → itens desconhecidos (nunca "parado").
  const mlbs = [...new Set(bases.map((a) => a.mlb))];
  const itens = new Map<string, ItemAgora>();
  const blocos = Array.from({ length: Math.ceil(mlbs.length / 20) }, (_, i) => mlbs.slice(i * 20, i * 20 + 20));
  await emParalelo(blocos, 4, async (bloco) => {
    try {
      const r = await deps.get(caminhoMultiget(bloco, CAMPOS_ITEM_AGORA), {});
      if (r.status >= 200 && r.status < 300) for (const [k, v] of parseItensBulk(r.corpo, bloco)) itens.set(k, v);
    } catch (e) {
      console.warn('[ads-campanhas] items/bulk indisponível', { erro: e instanceof Error ? e.message : String(e) });
    }
  });
  const publicadosPorFamilia = await pubP;

  const ativas = new Set(campanhas.filter((c) => c.status === 'active').map((c) => c.id));
  const doAtivo = [...new Set(bases.filter((a) => ativas.has(a.campanhaId)).map((a) => a.mlb))];
  const equilibrio = new Map<string, Equilibrio>();
  const FORA: Equilibrio = { acosPct: null, motivo: 'fora_da_projecao' };
  let projecaoLimitada = false;
  const aliq = await aliqP;
  const cadastroNoTeto = (await contP) <= LIMITES_CAMPANHAS.cadastro;
  if (!aliq) {
    for (const m of doAtivo) equilibrio.set(m, { acosPct: null, motivo: 'sem_aliquota' });
  } else if (doAtivo.length && !cadastroNoTeto) {
    projecaoLimitada = true;
  } else if (doAtivo.length) {
    const candidatos = doAtivo.slice(0, LIMITES_CAMPANHAS.mlbs);
    if (candidatos.length < doAtivo.length) projecaoLimitada = true;
    const [ml, cad] = await Promise.all([deps.buscarItensML(candidatos), cadP.then((c) => c!)]);
    // Orçamento de cores decidido antes, em ordem: o MLB que não cabe inteiro corta ele e os seguintes.
    let restante = LIMITES_CAMPANHAS.cores, cortou = false;
    const selecionados: { mlb: string; ml: ItemML }[] = [];
    for (const m of candidatos) {
      if (cortou) continue;
      const it = ml.get(m);
      if (!it) { equilibrio.set(m, { acosPct: null, motivo: 'erro_item' }); continue; }
      const n = coresDe(it).length;
      if (n > restante) { cortou = true; projecaoLimitada = true; continue; }
      restante -= n;
      selecionados.push({ mlb: m, ml: it });
    }
    let consultas = 0;
    const tarifaLimitada = (q: QueryTarifa) => {
      if (++consultas > LIMITES_CAMPANHAS.tarifas) return Promise.reject(new LimiteTarifa());
      return deps.tarifaEm(q);
    };
    await emParalelo(selecionados, 8, async ({ mlb, ml: it }) => {
      try {
        equilibrio.set(mlb, await equilibrioDoMlb(it, itens.get(mlb)?.preco ?? null, cad, aliq, tarifaLimitada));
      } catch (e) {
        if (!(e instanceof LimiteTarifa)) throw e;
        projecaoLimitada = true;
      }
    });
  }

  return {
    ok: true, estado: 'ok', lidoEm, aliquotasConfirmadas: aliq != null, projecaoLimitada, publicadosPorFamilia,
    campanhas,
    anuncios: bases.map((a) => ({ ...a, item: itens.get(a.mlb) ?? null, equilibrio: equilibrio.get(a.mlb) ?? FORA })),
  };
}
