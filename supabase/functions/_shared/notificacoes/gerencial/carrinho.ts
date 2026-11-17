// Decisão da notificação gerencial por carrinho (ADR-0190 D-4). Pura: o estado vem de
// `notificacao_carrinho`, as pagas de `ml_vendas`. Prazo de 600 s desde o 1º pagamento; vencido com
// order do pack que nunca chegou ao banco (webhook do ML atrasado/perdido), abre o resgate: o worker
// sincroniza as ausentes e espera até o último sync local + 180 s antes de enviar parcial.
export const PRAZO_CARRINHO_SEG = 600;
export const GRACA_RESGATE_SEG = 180;
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
  | { acao: 'resgatar'; faltantes: number[]; delaySeg: number }
  | { acao: 'enviar'; parcial: { recebidos: number; total: number } | null; composicaoIncerta: boolean }
  | { acao: 'descartar' };

/** `ausentes`: orders de `esperadas` sem linha em `ml_vendas`; `ultimoSyncEm`: insert mais recente do carrinho. */
export interface ResgateCarrinho { ausentes: number[]; ultimoSyncEm: string | null }

export function decidirEnvioCarrinho(
  e: EstadoCarrinho, pagas: number[], agora: Date, resgate?: ResgateCarrinho,
): DecisaoCarrinho {
  const pagasSet = new Set(pagas);
  if (e.esperadas?.length && e.esperadas.every((id) => pagasSet.has(id))) {
    return { acao: 'enviar', parcial: null, composicaoIncerta: false };
  }
  const restante = PRAZO_CARRINHO_SEG - (agora.getTime() - Date.parse(e.primeiroEm)) / 1000;
  if (restante > 0) return { acao: 'aguardar', delaySeg: Math.ceil(Math.min(PASSO_SEG, restante)) };
  if (pagas.length === 0) return { acao: 'descartar' };
  if (!e.esperadas?.length) return { acao: 'enviar', parcial: null, composicaoIncerta: true };
  if (resgate?.ausentes.length) {
    const base = Math.max(Date.parse(e.primeiroEm) + PRAZO_CARRINHO_SEG * 1000, Date.parse(resgate.ultimoSyncEm ?? '') || 0);
    const falta = (base + GRACA_RESGATE_SEG * 1000 - agora.getTime()) / 1000;
    if (falta > 0) return { acao: 'resgatar', faltantes: resgate.ausentes, delaySeg: Math.ceil(Math.min(PASSO_SEG, falta)) };
  }
  return {
    acao: 'enviar',
    parcial: { recebidos: e.esperadas.filter((id) => pagasSet.has(id)).length, total: e.esperadas.length },
    composicaoIncerta: false,
  };
}
