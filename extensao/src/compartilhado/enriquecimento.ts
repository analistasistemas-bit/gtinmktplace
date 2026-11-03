// Enriquecimento dos catálogos da busca (ADR-0189 emenda 2026-11-02 + adendo 2026-11-03; plano, Revisão 03/11): o que o
// SW guarda na aba (por catálogo e por vendedor) e a vista de UM card para o Mini-bloco e o resumo do painel.
// Nada inventado: vendedor, tipo e comissão só da oferta exata (item do card); desconhecido fica desconhecido.
import type { ComissaoML } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import type { CardBusca } from '../leitura/busca';

// = Medalha de _shared/extensao/enriquecimento-busca.ts (não importado: o módulo puxa tipos do Deno para o tsc daqui).
export type Medalha = 'silver' | 'gold' | 'platinum' | 'sem';
/** Terminal: só o "Tentar novamente" (ou dado novo) volta a pedir. `motivo` = o da edge (MOTIVO) ou 'falha de rede'.
 *  Componente AUSENTE = em processamento (pedido em voo ou ainda não enviado). */
type Indisponivel = { estado: 'indisponivel'; motivo?: string };

export type ProdutoVista = { estado: 'ok'; criadoEm: string | null } | Indisponivel;
export type ComissaoVista = { estado: 'ok'; valor: ComissaoML } | { estado: 'indisponivel'; motivo: string };
/** Oferta do item do card no catálogo; `preco` = o preço do card enviado (a comissão só vale para ele). */
export type ExataVista =
  | { estado: 'ok'; preco: number; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null; comissao: ComissaoVista }
  | { estado: 'nao_encontrada'; preco: number }
  /** Item pedido depois (scroll) num catálogo já lido e não consultado nesta rodada: terminal, a leitura anterior fica. */
  | { estado: 'indisponivel'; preco: number; motivo: string };
export interface OfertasOk {
  estado: 'ok';
  total: number | null;
  lidas: number;
  vendedoresIdentificados: number;
  ofertasSemVendedor: number;
  /** false → "≥ N vendedores". */
  completa: boolean;
  exatas: Record<string, ExataVista>;
}
/** Indisponível: `itens` = item → preço já tentados (terminais); item ou preço novo do mesmo catálogo ainda é pedido. */
export type OfertasVista = OfertasOk | (Indisponivel & { itens?: Record<string, number> });
export interface CatalogoVista {
  produto?: ProdutoVista;
  ofertas?: OfertasVista;
}
export type VendedorVista = { estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null } | Indisponivel;

export interface EstadoEnriquecimento {
  catalogos: Record<string, CatalogoVista>;
  vendedores: Record<string, VendedorVista>;
  /** ms: Retry-After do ML na última rodada; o "Tentar novamente" só vale a partir daqui. null/ausente = já pode. */
  tentarAposEm?: number | null;
  /** Falha de rede numa rodada (o pedido dela ficou indisponível): o painel oferece "Tentar novamente". */
  falhou: boolean;
  /** Edge respondeu indisponível (ex.: sem conexão ML): motivo; nada mais é pedido nesta página. */
  indisponivel: string | null;
}

export const enriquecimentoVazio = (): EstadoEnriquecimento => ({ catalogos: {}, vendedores: {}, tentarAposEm: null, falhou: false, indisponivel: null });

/** Estado gravado antes da Task 11.3 (`aguardando`, `aguardandoJanela`, `retomarEm`, `perfis`): o componente em espera
 *  vira ausente (o planejamento pede de novo), o resto do legado some. */
const semLegado = <T extends { estado?: unknown }>(x: T | undefined): T | undefined => (x?.estado === 'aguardando' ? undefined : x);

/** Cópia defensiva (estado gravado por versão anterior não tem o campo, ou tem o legado). */
export function enriquecimentoDe(v: unknown): EstadoEnriquecimento {
  const e = (v && typeof v === 'object' ? v : {}) as Partial<EstadoEnriquecimento>;
  const catalogos: Record<string, CatalogoVista> = {};
  for (const [k, c] of Object.entries(e.catalogos ?? {})) {
    const produto = semLegado(c?.produto), ofertas = semLegado(c?.ofertas);
    catalogos[k] = { ...(produto ? { produto } : {}), ...(ofertas ? { ofertas } : {}) };
  }
  const vendedores: Record<string, VendedorVista> = {};
  for (const [k, x] of Object.entries(e.vendedores ?? {})) { const y = semLegado(x); if (y) vendedores[k] = y; }
  return {
    catalogos, vendedores,
    tentarAposEm: typeof e.tentarAposEm === 'number' ? e.tentarAposEm : null, falhou: e.falhou === true,
    indisponivel: typeof e.indisponivel === 'string' ? e.indisponivel : null,
  };
}

/** Algo que o "Tentar novamente" refaria (mesmo critério de prepararNovaTentativa): o painel mostra o botão. */
export function haParaTentar(enr: EstadoEnriquecimento): boolean {
  return enr.falhou || Object.values(enr.vendedores).some((v) => v.estado !== 'ok') || Object.values(enr.catalogos).some((c) =>
    (!!c.produto && c.produto.estado !== 'ok') || (!!c.ofertas && c.ofertas.estado !== 'ok')
    || (c.ofertas?.estado === 'ok' && Object.values(c.ofertas.exatas).some((e) => e.estado === 'indisponivel' || (e.estado === 'ok' && e.comissao.estado !== 'ok'))));
}

const DIA = 86_400_000;
export type TomIdade = 'recente' | 'medio' | 'antigo';
/** Dias desde a criação do catálogo e o semáforo (≤ 180 recente, ≤ 365 médio, > 365 antigo). Futura/inválida → null. */
export function idadeDoCatalogo(criadoEm: string | null | undefined, agora = Date.now()): { dias: number; tom: TomIdade } | null {
  const t = criadoEm ? Date.parse(criadoEm) : NaN;
  if (!Number.isFinite(t) || t > agora) return null;
  const dias = Math.floor((agora - t) / DIA);
  return { dias, tom: dias <= 180 ? 'recente' : dias <= 365 ? 'medio' : 'antigo' };
}

/** Comissão em R$ ao preço do card (mesma regra de margem.ts: sale_fee_amount só se consultado a esse preço). */
export function valorDaComissao(c: ComissaoML, preco: number): number {
  const v = typeof c.saleFeeAmount === 'number' && Number.isFinite(c.saleFeeAmount) && c.precoConsultado === preco
    ? c.saleFeeAmount : preco * c.percentual / 100 + c.fixa;
  return Math.round(v * 100) / 100;
}

/** O que o Mini-bloco mostra do catálogo de UM card. null = card sem catálogo (só dados da página). */
export type VistaCard =
  | null
  | {
    /** Página inteira sem enriquecimento (ex.: sem conexão ML): o motivo. Nada mais é pedido. */
    indisponivel: string | null;
    /** Em processamento ("Consultando dados do catálogo"): componente ausente, ou item/preço do card ainda não pedido. */
    faltaProduto: boolean;
    faltaOfertas: boolean;
    criadoEm: string | null | undefined; // undefined = metadados não lidos
    /** Terminal parcial (429, tempo, orçamento, rede): motivo; o que já chegou fica. */
    produtoIndisponivel: string | null;
    ofertasIndisponivel: string | null;
    ofertas: OfertasOk | null;
    exata: ExataVista | null;
    vendedor: VendedorVista | null;
  };

const MOTIVO_PADRAO = 'dados indisponíveis';

export function vistaDoCard(card: Pick<CardBusca, 'itemId' | 'catalogProductId' | 'identidadeConflitante'> & { preco?: number | null }, e: EstadoEnriquecimento | undefined): VistaCard {
  if (!card.catalogProductId || card.identidadeConflitante) return null;
  const c = e?.catalogos[card.catalogProductId];
  const o = c?.ofertas;
  const ofertas = o?.estado === 'ok' ? o : null;
  const exata = ofertas?.exatas[card.itemId] ?? null;
  const sellerId = exata?.estado === 'ok' ? exata.sellerId : null;
  const temPreco = typeof card.preco === 'number' && card.preco > 0;
  // Ofertas indisponíveis valem só para o item/preço já tentado; item ou preço novo (scroll) ainda vai à edge.
  const tentado = o?.estado === 'indisponivel' && (!o.itens || !temPreco || o.itens[card.itemId] === card.preco);
  const indisponivel = e?.indisponivel ?? null;
  return {
    indisponivel,
    faltaProduto: !indisponivel && !c?.produto,
    faltaOfertas: !indisponivel && (!o || (o.estado === 'indisponivel' && !tentado) || (!!ofertas && !exata && temPreco)),
    criadoEm: c?.produto?.estado === 'ok' ? c.produto.criadoEm : undefined,
    produtoIndisponivel: c?.produto?.estado === 'indisponivel' ? c.produto.motivo ?? MOTIVO_PADRAO : null,
    ofertasIndisponivel: o?.estado === 'indisponivel' && tentado ? o.motivo ?? MOTIVO_PADRAO : null,
    ofertas, exata,
    vendedor: sellerId !== null ? e?.vendedores[String(sellerId)] ?? null : null,
  };
}

export const NOME_MEDALHA: Record<Medalha, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', sem: 'Sem medalha' };
export const NOME_TIPO = { gold_special: 'Clássico', gold_pro: 'Premium' } as const;
