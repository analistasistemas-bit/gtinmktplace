// Diagnóstico do `erro_tarifa` (ADR-0210): o cálculo compartilhado converte qualquer falha de tarifa em `erro_tarifa` e
// perde o motivo. Aqui só se registra componente, classe e status; nunca a mensagem, que pode trazer corpo e URL do ML.
import type { QueryTarifa } from '../promocoes/sincronizar.ts';
import type { Tarifa } from '../promocoes/tipos.ts';

type Motivo = { componente: 'comissao' | 'frete' | 'outro'; classe: string; status: number | null };
const CLASSES = new Set(['Error', 'TypeError', 'TarifaEstimada', 'SyntaxError', 'DOMException']);

export function motivoDaFalha(e: unknown): Motivo {
  const msg = e instanceof Error ? e.message : '';
  const nome = e instanceof Error ? e.constructor.name : '';
  const componente = msg.startsWith('listing_prices ') || msg.includes('sale_fee_details') ? 'comissao'
    : /\bfrete\b/.test(msg) ? 'frete' : 'outro';
  const status = /^listing_prices \S+ (\d{3}):|\(HTTP (\d{3})\)$/.exec(msg);
  return { componente, classe: CLASSES.has(nome) ? nome : 'outra', status: status ? Number(status[1] ?? status[2]) : null };
}

type TarifaEm = (q: QueryTarifa) => Promise<Tarifa>;

/** Mesma tarifa, mesmo erro: só registra o motivo antes de relançar. Não consulta de novo. */
export function comDiagnostico(
  tarifaEm: TarifaEm, log: (msg: string, m: Motivo) => void = (msg, m) => console.warn(msg, m),
): TarifaEm {
  return async (q) => {
    try {
      return await tarifaEm(q);
    } catch (e) {
      try {
        log('[agentes] tarifa indisponível', motivoDaFalha(e));
      } catch { /* o log nunca troca o erro */ }
      throw e;
    }
  };
}
