// Enriquecimento dos catálogos da busca (ADR-0189 emenda 2026-11-02 + adendo 2026-11-03; plano, Revisão 03/11): o que o
// SW guarda na aba (por catálogo e por vendedor) e a vista de UM card para o Mini-bloco e o resumo do painel.
// Nada inventado: vendedor, tipo e comissão só da oferta exata (item do card); desconhecido fica desconhecido.
import type { ComissaoML } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import type { CardBusca } from '../leitura/busca';

// = Medalha de _shared/extensao/enriquecimento-busca.ts (não importado: o módulo puxa tipos do Deno para o tsc daqui).
export type Medalha = 'silver' | 'gold' | 'platinum' | 'sem';
/** Legado (gravado antes da Task 11.3): o SW não produz mais; o planejamento o pede de novo uma vez. */
type Aguardando = { estado: 'aguardando'; retomarEm: number | null; tentativas: number };
/** Terminal: só o "Tentar novamente" (ou dado novo) volta a pedir. `motivo` = o da edge (MOTIVO) ou 'falha de rede'. */
type Indisponivel = { estado: 'indisponivel'; motivo?: string };

export type ProdutoVista = { estado: 'ok'; criadoEm: string | null } | Aguardando | Indisponivel;
export type ComissaoVista = { estado: 'ok'; valor: ComissaoML } | { estado: 'aguardando' } | { estado: 'indisponivel'; motivo: string };
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
export type OfertasVista = OfertasOk | Aguardando | Indisponivel;
export interface CatalogoVista {
  /** Legado (antes da Task 11.3; o SW não grava mais): cota esgotada aguardando a janela. */
  aguardandoJanela?: boolean;
  produto?: ProdutoVista;
  ofertas?: OfertasVista;
}
export type VendedorVista = { estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null } | Aguardando | Indisponivel;

export interface EstadoEnriquecimento {
  catalogos: Record<string, CatalogoVista>;
  vendedores: Record<string, VendedorVista>;
  /** Legado (antes da Task 11.3; sempre null agora): não há retomada automática do enriquecimento. */
  retomarEm: number | null;
  /** ms: Retry-After do ML na última rodada; o "Tentar novamente" só vale a partir daqui. null/ausente = já pode. */
  tentarAposEm?: number | null;
  /** Falha de rede numa rodada (o pedido dela ficou indisponível): o painel oferece "Tentar novamente". */
  falhou: boolean;
  /** Edge respondeu indisponível (ex.: sem conexão ML): motivo; nada mais é pedido nesta página. */
  indisponivel: string | null;
  /** Legado (antes da Task 11.3; não conta mais): sem teto de perfis por busca. */
  perfis: number;
}

export const enriquecimentoVazio = (): EstadoEnriquecimento => ({ catalogos: {}, vendedores: {}, retomarEm: null, tentarAposEm: null, falhou: false, indisponivel: null, perfis: 0 });

/** Cópia defensiva (estado gravado por versão anterior não tem o campo). */
export function enriquecimentoDe(v: unknown): EstadoEnriquecimento {
  const e = (v && typeof v === 'object' ? v : {}) as Partial<EstadoEnriquecimento>;
  return {
    catalogos: { ...e.catalogos }, vendedores: { ...e.vendedores },
    retomarEm: typeof e.retomarEm === 'number' ? e.retomarEm : null, tentarAposEm: typeof e.tentarAposEm === 'number' ? e.tentarAposEm : null, falhou: e.falhou === true,
    indisponivel: typeof e.indisponivel === 'string' ? e.indisponivel : null, perfis: typeof e.perfis === 'number' ? e.perfis : 0,
  };
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
    /** O que ainda falta, por componente (o que já chegou continua visível): 'dados' = ainda não pedido/respondido;
     *  'janela' = cota/orçamento esgotado; 'falha' = rede; 'indisponivel' = sem conexão. null = nada pendente. */
    espera: 'dados' | 'janela' | 'falha' | 'indisponivel' | null;
    /** Metadados (idade) e ofertas (vendedores/oferta exata do item) ainda pendentes. */
    faltaProduto: boolean;
    faltaOfertas: boolean;
    motivo?: string;
    criadoEm: string | null | undefined; // undefined = metadados não lidos
    produtoIndisponivel: boolean;
    ofertas: OfertasOk | null;
    ofertasEstado: 'ok' | 'aguardando' | 'indisponivel' | null;
    exata: ExataVista | null;
    vendedor: VendedorVista | null;
  };

export function vistaDoCard(card: Pick<CardBusca, 'itemId' | 'catalogProductId' | 'identidadeConflitante'> & { preco?: number | null }, e: EstadoEnriquecimento | undefined): VistaCard {
  if (!card.catalogProductId || card.identidadeConflitante) return null;
  const c = e?.catalogos[card.catalogProductId];
  const ofertas = c?.ofertas?.estado === 'ok' ? c.ofertas : null;
  const exata = ofertas?.exatas[card.itemId] ?? null;
  const sellerId = exata?.estado === 'ok' ? exata.sellerId : null;
  // Pendente = ausente ou aguardando com nova tentativa ainda possível (esgotado deixa de ser espera).
  const pendente = (x: ProdutoVista | OfertasVista | undefined) => !x || (x.estado === 'aguardando' && x.tentativas < 2);
  const faltaProduto = pendente(c?.produto);
  // Item do card ainda sem oferta exata numa leitura já feita (21º em diante, scroll): pendente também.
  const faltaOfertas = pendente(c?.ofertas) || (!!ofertas && !exata && typeof card.preco === 'number' && card.preco > 0);
  const aguarda = (x: ProdutoVista | OfertasVista | undefined) => x?.estado === 'aguardando';
  const espera = !faltaProduto && !faltaOfertas ? null : e?.indisponivel ? 'indisponivel' : e?.falhou ? 'falha'
    : c?.aguardandoJanela || aguarda(c?.produto) || aguarda(c?.ofertas) ? 'janela' : 'dados';
  return {
    espera, ...(espera === 'indisponivel' ? { motivo: e!.indisponivel! } : {}), faltaProduto, faltaOfertas,
    criadoEm: c?.produto?.estado === 'ok' ? c.produto.criadoEm : undefined,
    produtoIndisponivel: c?.produto?.estado === 'indisponivel',
    ofertas, ofertasEstado: c?.ofertas?.estado ?? null, exata,
    vendedor: sellerId !== null ? e?.vendedores[String(sellerId)] ?? null : null,
  };
}

export const NOME_MEDALHA: Record<Medalha, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', sem: 'Sem medalha' };
export const NOME_TIPO = { gold_special: 'Clássico', gold_pro: 'Premium' } as const;
