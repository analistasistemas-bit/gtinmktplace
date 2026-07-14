import { normalizarCodigo, normalizarOrigem } from '../_shared/parser.ts';

/**
 * Trava INVIOLÁVEL do imposto por origem (ADR-0055). A `origem` que vai ser persistida TEM que
 * refletir a coluna ORIGEM crua da planilha (linha PAI: `PAI` em '0'/''), lida de `rowsRaw` —
 * ANTES de qualquer map. Diverge → lança e ABORTA o lote (o catch do ingest marca 'erro'), em vez
 * de gravar imposto errado em silêncio (incidente 2026-07-14: o map dropava ORIGEM → tudo nacional).
 *
 * Lê a fonte CRUA de propósito: comparar com o `PlanilhaRow` já mapeado não pegaria o próprio drop
 * (raw e mapeado cairiam os dois em 'nacional' e "bateriam").
 */
export function verificarOrigemInviolavel(
  rowsRaw: Record<string, unknown>[],
  grupos: { codigo_pai: string; origem: 'nacional' | 'importado' }[],
): void {
  const cruaPorPai = new Map<string, string | undefined>();
  for (const r of rowsRaw) {
    const paiCampo = String(r.PAI ?? '').trim();
    if (paiCampo === '0' || paiCampo === '') {
      const cod = normalizarCodigo(String(r.CODIGO ?? ''));
      if (!cruaPorPai.has(cod)) cruaPorPai.set(cod, r.ORIGEM != null ? String(r.ORIGEM) : undefined);
    }
  }
  for (const g of grupos) {
    const esperada = normalizarOrigem(cruaPorPai.get(g.codigo_pai));
    if (esperada !== g.origem) {
      throw new Error(
        `Origem divergente no PAI ${g.codigo_pai}: planilha crua diz "${esperada}" mas a ingestão ` +
        `montou "${g.origem}". Lote abortado para não gravar imposto errado (ADR-0055).`,
      );
    }
  }
}
