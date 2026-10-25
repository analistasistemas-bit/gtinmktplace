// Decisão da notificação gerencial por carrinho (ADR-0190 D-4). Pura: o estado vem de
// `notificacao_carrinho`, as pagas de `ml_vendas`. Teto ABSOLUTO de 600 s desde o 1º pagamento.
export const PRAZO_CARRINHO_SEG = 600;
const PASSO_SEG = 60;

export interface EstadoCarrinho {
  chave: string;
  packId: number | null;
  orderId: number;
  /** Orders do pack (`GET /packs/{id}`); null = composição não confirmada. */
  esperadas: number[] | null;
  primeiroEm: string;
  tentativas: number;
}

export type DecisaoCarrinho =
  | { acao: 'aguardar'; delaySeg: number }
  | { acao: 'enviar'; parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean }
  | { acao: 'descartar' };

export function decidirEnvioCarrinho(e: EstadoCarrinho, pagas: number[], agora: Date): DecisaoCarrinho {
  const pagasSet = new Set(pagas);
  if (e.esperadas?.length && e.esperadas.every((id) => pagasSet.has(id))) {
    return { acao: 'enviar', parcial: null, composicaoIncerta: false };
  }
  const restante = PRAZO_CARRINHO_SEG - (agora.getTime() - Date.parse(e.primeiroEm)) / 1000;
  if (restante > 0) return { acao: 'aguardar', delaySeg: Math.ceil(Math.min(PASSO_SEG, restante)) };
  if (pagas.length === 0) return { acao: 'descartar' };
  if (!e.esperadas?.length) return { acao: 'enviar', parcial: null, composicaoIncerta: true };
  return {
    acao: 'enviar',
    parcial: { recebidos: e.esperadas.filter((id) => pagasSet.has(id)).length, total: e.esperadas.length },
    composicaoIncerta: false,
  };
}
