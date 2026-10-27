import type { PlanilhaRow } from '../_shared/types.ts';
import { lerOrigemCrua } from '../_shared/parser.ts';
import { gtinOuNull } from '../_shared/produto/gtin.ts';

/** Célula numérica perde o zero à esquerda: UPC-A `012345678905` chega como 11 dígitos. Só esse
 *  caso volta o zero — completar outros comprimentos faria ID de fornecedor passar por GTIN. */
function gtinDaCelula(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  return typeof v === 'number' && /^\d{11}$/.test(s) ? `0${s}` : s;
}

/**
 * Converte uma linha crua da planilha (chaves = cabeçalhos) num `PlanilhaRow` tipado.
 * TODO campo lido da planilha PRECISA estar aqui — omitir um campo o dropa silenciosamente.
 * ORIGEM (ADR-0055) faltava neste map: `familias.origem` caía sempre em 'nacional' e o imposto
 * ia a 8% mesmo para importado (16%). O parser lê `pai.ORIGEM`; sem esta linha, chega undefined.
 */
export function mapearLinha(r: Record<string, unknown>): PlanilhaRow {
  return {
    CODIGO: String(r.CODIGO ?? ''),
    // ADR-0191: vazio ≠ '0' — PAI vazio sem filhos é produto único; '0' é agrupador.
    PAI: String(r.PAI ?? '').trim(),
    NOME: String(r.NOME ?? ''),
    UNIDADE: String(r.UNIDADE ?? ''),
    GTIN: gtinOuNull(gtinDaCelula(r.GTIN)),
    CUSTO: Number(r.CUSTO ?? 0),
    PRECO: Number(r.PRECO ?? 0),
    ESTOQUE: Number(r.ESTOQUE ?? 0),
    DESCRICAO_DETALHADO: String(r.DESCRICAO_DETALHADO ?? ''),
    PESO_GRAMAS: Number(r.PESO_GRAMAS ?? 0),
    ALTURA_CM: Number(r.ALTURA_CM ?? 0),
    LARGURA_CM: Number(r.LARGURA_CM ?? 0),
    COMPRIMENTO_CM: Number(r.COMPRIMENTO_CM ?? 0),
    FORNECEDOR: String(r.FORNECEDOR ?? ''),
    // Case-insensitive: `validarColunas` aceita `Origem` no cabeçalho, o map tem que achar igual.
    ORIGEM: lerOrigemCrua(r),
    // ADR-0135: fiscais, opcionais aqui — a obrigatoriedade (org com módulo) é do
    // `exigirFiscalExplicito`, que lê `rowsRaw` direto (antes deste map), não este campo.
    NCM: r.NCM ? String(r.NCM) : undefined,
    CEST: r.CEST ? String(r.CEST) : undefined,
    // 0 é código válido (mercadoria nacional) — não pode cair no `? :` truthy como GTIN.
    ORIGEM_NFE: r.ORIGEM_NFE != null && r.ORIGEM_NFE !== '' ? String(r.ORIGEM_NFE) : undefined,
    CSOSN: r.CSOSN ? String(r.CSOSN) : undefined,
  };
}
