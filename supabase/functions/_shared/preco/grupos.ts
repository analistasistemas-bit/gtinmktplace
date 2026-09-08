// ADR-0078 F2: faixa de preço = variações com o mesmo preço, comparado por CENTAVOS INTEIROS
// (arredondamento a 2 casas antes de agrupar — glossário do spec).

import { round2 } from '../dinheiro.ts';

export { round2 };

/** Preço em centavos inteiros (chave de faixa). null/NaN → null. Aceita string (numeric do PG). */
export function precoCentavos(preco: number | string | null | undefined): number | null {
  if (preco == null) return null;
  const n = Number(preco);
  if (!Number.isFinite(n)) return null;
  return Math.round(round2(n) * 100);
}

/** >1 preço distinto entre os NÃO-nulos. Nulos herdam o preço do anúncio (como hoje) e não divergem. */
export function precosDivergentes(
  variacoes: Array<{ preco_publicacao: number | string | null }>,
): boolean {
  const distintos = new Set(
    variacoes.map((v) => precoCentavos(v.preco_publicacao)).filter((c): c is number => c != null),
  );
  return distintos.size > 1;
}

/**
 * Guard do ramo LEGACY dos workers de anúncio único (publish/update-familia-ml): divergência aqui é
 * bug de roteamento — publicar colapsando seria preço errado em silêncio. LOUD, nada é enviado.
 *
 * ADR-0160: só o ramo Legacy. Sob User Products cada cor é um item ML próprio com preço próprio, e
 * chamar isto ali barraria justamente o "preço por variação" que o ML oferece. O guard passou a
 * rodar depois do roteamento, imediatamente antes do PUT.
 */
export function garantirPrecoUniforme(
  variacoes: Array<{ codigo: string; preco_publicacao: number | string | null }>,
  contexto: string,
): void {
  if (!precosDivergentes(variacoes)) return;
  // A saída depende de POR QUE a família ainda é Legacy, e o operador não tem como adivinhar:
  // - família que o ML já migrou mas o app ainda não adotou: uma passada em "somente estoque"
  //   adota (o conector detecta MIGRADO_PARA_UP no GET ao vivo) e o próximo UPDATE já roteia UP;
  // - categoria genuinamente Legacy: preços diferentes exigem anúncios separados (split por faixa).
  // Sem esta dica a mensagem citava só o split — e mandava dividir um anúncio que na verdade já
  // estava pronto para preço por variação.
  const e = new Error(
    `${contexto}: preços divergentes entre as variações e este anúncio é do modelo antigo `
    + '(uma publicação com várias variações), que no Mercado Livre exige preço único. Saídas: '
    + '(a) se o ML já ofereceu "preço por variação" para este anúncio e você aceitou, publique uma '
    + 'vez como "somente estoque" — o app adota a migração e o próximo envio já aceita preços '
    + 'diferentes; (b) deixe o preço uniforme; (c) divida em anúncios por faixa de preço. '
    + 'Nada foi enviado (400)',
  ) as Error & { status?: number };
  e.status = 400;
  throw e;
}
