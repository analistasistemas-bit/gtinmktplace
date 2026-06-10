import type { ResultadoCasamento, Herdado } from './casar.ts';
import { normalizarCodigo } from '../parser.ts';

/** Variação que JÁ existe no anúncio ao vivo do ML (fonte da verdade). */
export interface MlVariacaoExistente {
  id: string;
  seller_custom_field: string | null;
  cor: string | null;
  available_quantity: number | null;
}

// Adendo ADR-0016: o casamento local decide "o que já está publicado" pelo snapshot
// das tabelas familias/variacoes, que pode divergir do anúncio (lote excluído, cor
// adicionada fora do app). Esta reconciliação confere os códigos marcados como "novos"
// contra as variações REAIS do ML: os que já existem lá viram casados (adotam o
// ml_variation_id e a cor do ML), some o falso "cor nova" e o worker não duplica SKU.
export function reconciliarCasamentoComML(
  casamento: ResultadoCasamento,
  mlVariations: MlVariacaoExistente[],
): ResultadoCasamento {
  if (casamento.mudancaEstrutural.novas.length === 0) return casamento;

  const porCodigo = new Map<string, MlVariacaoExistente>();
  for (const v of mlVariations) {
    if (v.seller_custom_field) porCodigo.set(normalizarCodigo(v.seller_custom_field), v);
  }

  const herdados: Record<string, Herdado> = { ...casamento.herdados };
  const novasRestantes: string[] = [];
  for (const codigo of casamento.mudancaEstrutural.novas) {
    const ml = porCodigo.get(codigo);
    if (ml) {
      herdados[codigo] = {
        ml_variation_id: String(ml.id),
        cor: ml.cor,
        cor_origem: ml.cor ? 'manual' : null,
        ml_picture_id: null,
        estoque_anterior: ml.available_quantity ?? null,
        preco_publicacao: null,
      };
    } else {
      novasRestantes.push(codigo);
    }
  }

  return {
    herdados,
    mudancaEstrutural: { novas: novasRestantes, removidas: casamento.mudancaEstrutural.removidas },
  };
}
