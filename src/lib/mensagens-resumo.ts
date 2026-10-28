// Cards de resumo da aba Mensagens (pós-venda ML). Funções puras. Os números exibidos vêm da RPC
// `resumo_mensagens_posvenda` (todas as mensagens); `resumirConversas`/`baldeDaConversa` espelham a
// mesma regra sobre o array limitado, para o filtro local e os testes. Cancelados ficam fora.
import type { Conversa } from './mensagens';

export type Balde = 'aPreparar' | 'aCaminho' | 'entregues' | 'semResponder' | 'respondidas';

export interface ResumoMensagens {
  naoLidas: { aPreparar: number; aCaminho: number; entregues: number; total: number };
  lidas: { semResponder: number; respondidas: number };
}

const A_PREPARAR = ['pending', 'handling', 'ready_to_ship'];

/** Em qual card a conversa cai (ou null: cancelada, ou lida/dispensada sem estar em nenhum). */
export function baldeDaConversa(c: Conversa): Balde | null {
  if (c.order_status === 'cancelled') return null;
  if (c.idsNaoLidosML.length > 0) {
    if (c.shipping_status && A_PREPARAR.includes(c.shipping_status)) return 'aPreparar';
    if (c.shipping_status === 'shipped') return 'aCaminho';
    if (c.shipping_status === 'delivered') return 'entregues';
    return null; // não lida, mas sem situação de envio conhecida: só conta no total
  }
  const ultima = c.mensagens[c.mensagens.length - 1];
  if (ultima?.direcao === 'enviada') return 'respondidas';
  if (ultima?.direcao === 'recebida' && !ultima.lida) return 'semResponder';
  return null;
}

export function resumirConversas(conversas: Conversa[]): ResumoMensagens {
  const r: ResumoMensagens = {
    naoLidas: { aPreparar: 0, aCaminho: 0, entregues: 0, total: 0 },
    lidas: { semResponder: 0, respondidas: 0 },
  };
  for (const c of conversas) {
    if (c.order_status === 'cancelled') continue;
    if (c.idsNaoLidosML.length > 0) r.naoLidas.total++;
    const b = baldeDaConversa(c);
    if (b === 'aPreparar' || b === 'aCaminho' || b === 'entregues') r.naoLidas[b]++;
    else if (b === 'semResponder' || b === 'respondidas') r.lidas[b]++;
  }
  return r;
}

/** Linha da RPC `resumo_mensagens_posvenda` → ResumoMensagens. */
export function resumoDaRpc(l: {
  nao_lidas_total: number; a_preparar: number; a_caminho: number; entregues: number;
  sem_responder: number; respondidas: number;
}): ResumoMensagens {
  return {
    naoLidas: { aPreparar: l.a_preparar, aCaminho: l.a_caminho, entregues: l.entregues, total: l.nao_lidas_total },
    lidas: { semResponder: l.sem_responder, respondidas: l.respondidas },
  };
}

/** Primeira linha do card recolhido, igual ao ML. */
export function rotuloVenda(shipping: string | null): string {
  if (shipping && A_PREPARAR.includes(shipping)) return 'Venda para preparar';
  if (shipping === 'shipped') return 'Venda a caminho';
  if (shipping === 'delivered') return 'Venda entregue';
  return 'Venda';
}
