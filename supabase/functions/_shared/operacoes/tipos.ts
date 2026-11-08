// ADR-0174 — tipos do motor de operações em massa (aderir/sair de promoções DEAL/SMART do ML).
import type { Semaforo } from '../promocoes/tipos.ts';
import type { Passo } from './reajuste/tipos.ts';

/** `alterar_preco` (emenda 2026-11-03): PUT do deal_price de item DEAL já participando. */
export type Acao = 'aderir' | 'sair' | 'alterar_preco';
export type TipoPromocao = 'DEAL' | 'SMART' | 'LIGHTNING' | 'SMART_LIGHTNING' | 'PRICE_MATCHING';
/** Emenda 2026-11-03: ofertas de preço fixo com preço revalidado, etapa durável e saída só por `candidate`. */
export const ofertaFixaNova = (t: string): t is 'SMART_LIGHTNING' | 'PRICE_MATCHING' =>
  t === 'SMART_LIGHTNING' || t === 'PRICE_MATCHING';
export type StatusItem =
  | 'rascunho' | 'pendente' | 'enviando' | 'conferindo'
  | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';

export interface ItemRow {
  ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number;
  semaforo: Semaforo | null; confirmado_risco: boolean;
  proxima_conferencia: string | null;   // ISO; null = sem conferência agendada
  saida_pedida_em: string | null;       // ISO do 1º DELETE aceito; relógio das 24 h
  // alterar_preco: etapa durável antes do PUT, preço lido no ML antes de escrever e (Reverter) o preço que a
  // operação de origem deixou — preço vivo diferente vira `mudou`.
  etapa?: 'escrita_pedida' | 'ml_confirmado' | null; preco_anterior?: number | null; preco_esperado?: number | null;
  offer_id?: string | null;
}
export interface CamposItem {
  status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number;
  proxima_conferencia: string | null; saida_pedida_em: string | null;
  // ADR-0178 (reajuste): etapa da escrita no ML, preço antes do reajuste, item marcado no rascunho.
  etapa: 'escrita_pedida' | 'ml_confirmado' | null; preco_anterior: number | null; incluido: boolean;
  // ADR-0196: gravados no rascunho; o estado de cada passo muda só por `reajuste_passo_marcar`.
  passos: Passo[] | null; avaliacoes: unknown[] | null;
}

/** Leitura fresca da visão da campanha para UM item; null = o item não aparece na campanha. */
export interface ItemNaCampanha {
  status: string;                 // candidate | started | pending | ...
  preco_min: number | null; preco_max: number | null;
  offer_id: string | null;        // CANDIDATE-... (convidado) ou OFFER-... (participando); LIGHTNING vem em ref_id
  estoque_min: number | null;     // stock.min (LIGHTNING/SMART_LIGHTNING); null nos outros tipos ou ausente
  /** `price` da visão da campanha: no participante é o preço promocional vigente (spike 03/11). */
  preco?: number | null;
  /** Relâmpago: convite aberto para outro horário de um anúncio que já participa (emenda 2026-11-08 (2)). */
  convite?: ItemNaCampanha;
}
/** Relâmpago na visão POR ITEM (/seller-promotions/items/{id}): a única com máximo e sugerido. null = não aparece. */
export interface OfertaNoItem {
  preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; estoque_min: number | null;
  inicio: string | null; fim: string | null;  // start_date/finish_date sem fuso (horário de Brasília, spike)
}
export interface Relacoes {
  catalog_listing: boolean; relacionados: { id: string; catalog_listing: boolean }[];
  disponivel: number | null;      // available_quantity do item (estoque que a Relâmpago reserva)
}
export interface PedidoItem { ml_item_id: string; preco: number | null; esperado?: number | null }
export type Decisao =
  | { tipo: 'post'; body: Record<string, unknown> }
  | { tipo: 'put'; body: Record<string, unknown> }
  | { tipo: 'delete'; query: string }
  | { tipo: 'fim'; status: Exclude<StatusItem, 'rascunho' | 'pendente' | 'enviando' | 'conferindo'>; mensagem: string | null };

/** Emenda 2026-10-04 — 2º tipo do motor: status do anúncio (ADR-0060), sem promoção. */
export type AcaoStatus = 'pausar' | 'reativar';
