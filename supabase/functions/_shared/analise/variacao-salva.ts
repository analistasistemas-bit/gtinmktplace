import { dimensoesValidas, type DimensoesPacote } from '../ml/pacote.ts';

/** Uma linha do select de `variacoes` por (org_id, gtin) — só os campos que a heurística usa. */
export interface VariacaoSalvaRow {
  peso_gramas: number | null;
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
}

export interface VariacaoSalvaResumo {
  dimensoes: DimensoesPacote | null;
  jaCadastrado: boolean;
}

/**
 * Resume o mesmo select de `variacoes` (org_id, gtin) num único round-trip (T4, spike 037 §3.5):
 * `jaCadastrado` é heurística de UX por GTIN, NÃO o guard autoritativo de duplicata — esse
 * continua sendo o 409 de `cadastrar-produto` por `codigo_pai` (D-4). `dimensoes` é a primeira
 * linha com pacote válido, mesmo comportamento do antigo loop de `buscarDimensoesSalvas`; uma
 * linha existente com dimensões inválidas ainda conta como `jaCadastrado`.
 */
export function resumirVariacoesSalvas(rows: VariacaoSalvaRow[]): VariacaoSalvaResumo {
  let dimensoes: DimensoesPacote | null = null;
  for (const row of rows) {
    const d: DimensoesPacote = {
      peso_gramas: row.peso_gramas, altura_cm: row.altura_cm,
      largura_cm: row.largura_cm, comprimento_cm: row.comprimento_cm,
    };
    if (dimensoesValidas(d)) { dimensoes = d; break; }
  }
  return { dimensoes, jaCadastrado: rows.length > 0 };
}
