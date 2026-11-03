// Enriquecimento dos catálogos da busca (ADR-0189 emenda 2026-11-02 + adendo 2026-11-03; plano, Revisão 03/11): o que o
// SW guarda na aba (por catálogo e por vendedor) e a vista de UM card para o Mini-bloco e o resumo do painel.
// Nada inventado: vendedor, tipo e comissão só da oferta exata (item do card); desconhecido fica desconhecido.
import type { ComissaoML } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import type { CardBusca } from '../leitura/busca';

// = Medalha de _shared/extensao/enriquecimento-busca.ts (não importado: o módulo puxa tipos do Deno para o tsc daqui).
export type Medalha = 'silver' | 'gold' | 'platinum' | 'sem';
type Aguardando = { estado: 'aguardando'; retomarEm: number | null; tentativas: number };
type Indisponivel = { estado: 'indisponivel' };

export type ProdutoVista = { estado: 'ok'; criadoEm: string | null } | Aguardando | Indisponivel;
export type ComissaoVista = { estado: 'ok'; valor: ComissaoML } | { estado: 'aguardando' } | { estado: 'indisponivel'; motivo: string };
/** Oferta do item do card no catálogo; `preco` = o preço do card enviado (a comissão só vale para ele). */
export type ExataVista =
  | { estado: 'ok'; preco: number; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null; comissao: ComissaoVista }
  | { estado: 'nao_encontrada'; preco: number };
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
  /** Cota de enriquecimento esgotada: nada consultado ainda (a janela está em `EstadoEnriquecimento.retomarEm`). */
  aguardandoJanela?: boolean;
  produto?: ProdutoVista;
  ofertas?: OfertasVista;
}
export type VendedorVista = { estado: 'ok'; nome: string | null; medalha: Medalha | null; uf: string | null } | Aguardando | Indisponivel;

export interface EstadoEnriquecimento {
  catalogos: Record<string, CatalogoVista>;
  vendedores: Record<string, VendedorVista>;
  /** ms: cota de enriquecimento esgotada até este instante (pulso da página retoma). */
  retomarEm: number | null;
  /** Falha de rede na rodada: só o "Tentar novamente" do painel retoma (sem repetição automática). */
  falhou: boolean;
  /** Edge respondeu indisponível (ex.: sem conexão ML): motivo; nada mais é pedido nesta página. */
  indisponivel: string | null;
  /** Perfis consultados nesta busca (teto MAX_PERFIS_BUSCA). */
  perfis: number;
}

export const enriquecimentoVazio = (): EstadoEnriquecimento => ({ catalogos: {}, vendedores: {}, retomarEm: null, falhou: false, indisponivel: null, perfis: 0 });

/** Cópia defensiva (estado gravado por versão anterior não tem o campo). */
export function enriquecimentoDe(v: unknown): EstadoEnriquecimento {
  const e = (v && typeof v === 'object' ? v : {}) as Partial<EstadoEnriquecimento>;
  return {
    catalogos: { ...e.catalogos }, vendedores: { ...e.vendedores },
    retomarEm: typeof e.retomarEm === 'number' ? e.retomarEm : null, falhou: e.falhou === true,
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
    /** 'dados' = ainda não pedido/respondido; 'janela' = cota esgotada; 'falha' = rede; 'indisponivel' = sem conexão. */
    espera: 'dados' | 'janela' | 'falha' | 'indisponivel' | null;
    motivo?: string;
    criadoEm: string | null | undefined; // undefined = metadados não lidos
    produtoIndisponivel: boolean;
    ofertas: OfertasOk | null;
    ofertasEstado: 'ok' | 'aguardando' | 'indisponivel' | null;
    exata: ExataVista | null;
    vendedor: VendedorVista | null;
  };

export function vistaDoCard(card: Pick<CardBusca, 'itemId' | 'catalogProductId' | 'identidadeConflitante'>, e: EstadoEnriquecimento | undefined): VistaCard {
  if (!card.catalogProductId || card.identidadeConflitante) return null;
  const c = e?.catalogos[card.catalogProductId];
  const ofertas = c?.ofertas?.estado === 'ok' ? c.ofertas : null;
  const exata = ofertas?.exatas[card.itemId] ?? null;
  const sellerId = exata?.estado === 'ok' ? exata.sellerId : null;
  const temDado = !!(c?.produto || c?.ofertas);
  const espera = temDado ? null : e?.indisponivel ? 'indisponivel' : e?.falhou ? 'falha' : c?.aguardandoJanela ? 'janela' : 'dados';
  return {
    espera, ...(espera === 'indisponivel' ? { motivo: e!.indisponivel! } : {}),
    criadoEm: c?.produto?.estado === 'ok' ? c.produto.criadoEm : undefined,
    produtoIndisponivel: c?.produto?.estado === 'indisponivel',
    ofertas, ofertasEstado: c?.ofertas?.estado ?? null, exata,
    vendedor: sellerId !== null ? e?.vendedores[String(sellerId)] ?? null : null,
  };
}

export const NOME_MEDALHA: Record<Medalha, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', sem: 'Sem medalha' };
export const NOME_TIPO = { gold_special: 'Clássico', gold_pro: 'Premium' } as const;
