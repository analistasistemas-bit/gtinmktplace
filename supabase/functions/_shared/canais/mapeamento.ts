import type { ErroCanal } from './contrato.ts';

/** Casa as variações retornadas pelo canal com os SKUs canônicos.
 *  Preferência: seller_custom_field; fallback por índice se as contagens baterem. */
export function mapearVariacoesExternas(
  resultVariations: Array<{ id: string | number; seller_custom_field?: string }>,
  canon: Array<{ sku: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const casaPorIndice = resultVariations.length === canon.length;
  for (let i = 0; i < resultVariations.length; i++) {
    const mv = resultVariations[i];
    const sku = mv.seller_custom_field ?? (casaPorIndice ? canon[i]?.sku : undefined);
    if (sku) out[sku] = String(mv.id);
  }
  return out;
}

/** Casa variações por seller_custom_field (UPDATE). Sem fallback por índice:
 *  no UPDATE as contagens (atuais vs novas) divergem, então índice não é confiável. */
export function mapearVariacoesPorSku(
  variations: Array<{ id: string | number; seller_custom_field?: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variations) {
    const sku = v.seller_custom_field;
    if (sku) out[sku] = String(v.id);
  }
  return out;
}

/** Converte um erro nativo (lançado por criarItemML etc.) no formato unificado.
 *  retentável = pedido explícito de reenvio (foto transiente) OU 5xx/429. */
export function classificarErroCanal(e: unknown): ErroCanal {
  const status = (e as { status?: number }).status;
  const retentavelNativo = (e as { retentavel?: boolean }).retentavel === true;
  const retentavel = retentavelNativo || (typeof status === 'number' && (status >= 500 || status === 429));
  const mensagemOperador = e instanceof Error ? e.message : String(e);
  return { codigo: 'DESCONHECIDO', mensagemOperador, retentavel, status, raw: e };
}
