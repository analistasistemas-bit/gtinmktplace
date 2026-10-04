// I5 — reajuste de preço em massa: o contrato monetário (C4) é o MESMO do servidor (re-export, nunca cópia).
import type { Ajuste } from '../../supabase/functions/_shared/operacoes/reajuste/tipos.ts';

export { calcularAlvo, centavos, maxDuasCasas, reais, semAlteracao } from '../../supabase/functions/_shared/operacoes/reajuste/alvo.ts';
export type { Ajuste, Avaliacao, CorAvaliada, TipoAjuste } from '../../supabase/functions/_shared/operacoes/reajuste/tipos.ts';
export type { ItemPreview } from '../../supabase/functions/_shared/operacoes/reajuste/preview.ts';
export type { Confirmacao } from '../../supabase/functions/_shared/operacoes/reajuste/pedido.ts';

/** "+10%", "−2,5%", "+R$ 5,00". */
export function formatarAjuste(a: Ajuste): string {
  const sinal = a.sentido === '+' ? '+' : '−';
  if (a.tipo === 'pct') return `${sinal}${a.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  return `${sinal}R$ ${a.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
