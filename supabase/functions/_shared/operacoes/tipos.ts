// ADR-0174 — tipos do motor de operações em massa (aderir/sair de promoções DEAL/SMART do ML).
import type { Semaforo } from '../promocoes/tipos.ts';

export type Acao = 'aderir' | 'sair';
export type TipoPromocao = 'DEAL' | 'SMART';
export type StatusItem = 'pendente' | 'enviando' | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';

export interface ItemRow {
  ml_item_id: string; preco: number | null; status: StatusItem; conferencias: number;
  semaforo: Semaforo | null; confirmado_risco: boolean;
  proxima_conferencia: string | null;   // ISO; null = sem conferência agendada
  saida_pedida_em: string | null;       // ISO do 1º DELETE aceito; relógio das 24 h
}
export interface CamposItem {
  status: StatusItem; mensagem: string | null; offer_id: string | null; conferencias: number;
  proxima_conferencia: string | null; saida_pedida_em: string | null;
}

/** Leitura fresca da visão da campanha para UM item; null = o item não aparece na campanha. */
export interface ItemNaCampanha {
  status: string;                 // candidate | started | pending | ...
  preco_min: number | null; preco_max: number | null;
  offer_id: string | null;        // CANDIDATE-... (convidado SMART) ou OFFER-... (participando SMART)
}
export interface Relacoes { catalog_listing: boolean; relacionados: { id: string; catalog_listing: boolean }[] }
export interface PedidoItem { ml_item_id: string; preco: number | null }
export type Decisao =
  | { tipo: 'post'; body: Record<string, unknown> }
  | { tipo: 'delete'; query: string }
  | { tipo: 'fim'; status: Exclude<StatusItem, 'pendente' | 'enviando'>; mensagem: string | null };

/** Emenda 2026-10-04 — 2º tipo do motor: status do anúncio (ADR-0060), sem promoção. */
export type AcaoStatus = 'pausar' | 'reativar';
