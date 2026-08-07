import { normalizarCodigo, normalizarOrigem } from '../_shared/parser.ts';

const VALIDAS = ['NACIONAL', 'IMPORTADO'];

/**
 * ORIGEM é OBRIGATÓRIA e EXPLÍCITA em toda linha PAI (ADR-0107, refina ADR-0055). Célula vazia ou
 * valor fora de NACIONAL/IMPORTADO ABORTA o lote — o default silencioso em 'nacional' cobrava 8%
 * em produto importado (16%) sem nada indicar (incidente do Oxford, 2026-08-07).
 *
 * A coluna ausente já é barrada antes, por `validarColunas` (ORIGEM está em COLUNAS_OBRIGATORIAS).
 * Acumula todos os pais problemáticos numa mensagem só, pro operador corrigir a planilha de uma vez.
 */
export function exigirOrigemExplicita(rowsRaw: Record<string, unknown>[]): void {
  const problemas: string[] = [];
  const vistos = new Set<string>();
  for (const r of rowsRaw) {
    const paiCampo = String(r.PAI ?? '').trim();
    if (paiCampo !== '0' && paiCampo !== '') continue;
    const cod = normalizarCodigo(String(r.CODIGO ?? ''));
    if (vistos.has(cod)) continue;
    vistos.add(cod);
    const bruto = r.ORIGEM != null ? String(r.ORIGEM) : '';
    if (!VALIDAS.includes(bruto.toUpperCase().trim())) {
      problemas.push(`${cod} (ORIGEM = ${bruto.trim() === '' ? 'vazio' : `"${bruto.trim()}"`})`);
    }
  }
  if (problemas.length) {
    throw new Error(
      `ORIGEM ausente ou inválida em ${problemas.length} produto(s) PAI: ${problemas.join(', ')}. ` +
      `Preencha NACIONAL ou IMPORTADO na linha PAI e reenvie — o imposto não pode ser presumido (ADR-0107).`,
    );
  }
}

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
