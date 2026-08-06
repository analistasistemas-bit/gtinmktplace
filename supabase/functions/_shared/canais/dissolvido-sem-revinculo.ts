// ADR-0105 §7 — mensagem para quem recebe `MIGRADO_PARA_UP` mas NÃO sabe re-vincular.
//
// O sinal tipado nasce no conector (`atualizarAnuncio`), que é compartilhado. Só
// `update-familia-ml/processar.ts` o converte em descoberta + adoção; o worker de split
// (`publicar-split-ml`) usa o MESMO conector e apenas relança o erro de canal.
//
// Sem este guard, uma família dividida (ADR-0048) cujo anúncio o ML dissolveu mostraria ao operador
// "verificando se foi migrado para o modelo User Products" — uma verificação que naquele caminho
// nunca acontece, e sem a orientação que a mensagem antiga dava. Pior que o comportamento anterior.
//
// Aqui a mensagem volta a ser a ORIGINAL do guard de anúncio morto (lote #45), acrescida do motivo
// real: o re-vínculo automático existe, mas não cobre produto dividido em vários anúncios.

import type { ErroCanal } from './contrato.ts';

/**
 * Mensagem a usar quando o canal sinalizou anúncio dissolvido e este caminho não re-vincula.
 * `null` quando o erro é outro — o chamador segue com `mensagemOperador`.
 */
export function mensagemDissolvidoSemRevinculo(erro: ErroCanal): string | null {
  const dissolvido = erro.codigo === 'MIGRADO_PARA_UP' ? erro.up?.dissolvido : undefined;
  if (!dissolvido) return null;
  return `${dissolvido.motivoFallback} Se o Mercado Livre migrou este anúncio para o modelo de `
    + 'variações (User Products), o re-vínculo automático não cobre produto dividido em vários '
    + 'anúncios (ADR-0105 §7) — refaça a publicação deste produto.';
}
