// Código de produto gerado no cadastro manual (spec 2026-07-31).
//
// Oito dígitos com zeros à esquerda NÃO é estética: é o contrato do upload de foto.
// `_shared/upload/match.ts` só casa `^(\d{8})\.(jpe?g|png)$`, e a Revisão renomeia o arquivo
// para `{codigo}.{ext}` — código fora desse formato faz a foto simplesmente não grudar.

export const CODIGO_MAX = 99_999_999;

export interface CodigosGerados {
  codigoPai: string;
  codigos: string[];
}

/**
 * Converte a faixa reservada pela RPC nos códigos formatados.
 *
 * `ultimo` é o valor devolvido por `proximo_codigo_produto` (o ÚLTIMO número da faixa) e
 * `qtd` é quantos números foram reservados: 1 PAI + N variações. O PAI é o MENOR número da
 * faixa (D-2) — a ordem é fixa para os códigos não trocarem de significado entre execuções.
 */
export function derivarCodigos(ultimo: number, qtd: number): CodigosGerados {
  if (!Number.isInteger(ultimo) || !Number.isInteger(qtd) || qtd < 2) {
    throw new Error('Faixa de códigos inválida.');
  }
  const primeiro = ultimo - qtd + 1;
  if (primeiro < 1) throw new Error('Faixa de códigos inválida.');
  // D-5: falha LOUD. Truncar geraria código duplicado em silêncio e nove dígitos quebraria o
  // upload de foto de novo — os dois são piores que recusar o cadastro.
  if (ultimo > CODIGO_MAX) {
    throw new Error(
      `Sequência de códigos da organização esgotada (limite ${CODIGO_MAX}). `
      + 'Nenhum produto foi cadastrado.',
    );
  }
  const formatar = (n: number) => String(n).padStart(8, '0');
  return {
    codigoPai: formatar(primeiro),
    codigos: Array.from({ length: qtd - 1 }, (_, i) => formatar(primeiro + 1 + i)),
  };
}
