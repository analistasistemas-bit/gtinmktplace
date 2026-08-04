// Anúncio morto no ML não aceita UPDATE — e o erro cru do ML manda o operador para o lugar errado.
//
// Lote #45 (03/08): 6 famílias falharam com "variations is not modifiable. attributes is not
// modifiable. Revise os atributos da categoria." numa reposição de estoque. O GET autenticado
// mostrou a causa real: os 6 anúncios estavam `closed`/`inactive` com sub_status `deleted` — os
// produtos não estavam mais à venda. A mensagem mandava revisar atributos da categoria, onde não
// havia nada a revisar; a causa (anúncio removido) só apareceu consultando a API do ML na mão.
//
// Este guard roda depois do GET e ANTES do PUT: falha alto, com a causa certa, sem gastar a
// chamada de escrita.
//
// `paused` NÃO bloqueia de propósito: anúncio pausado aceita atualização de estoque normalmente
// (é o estado de quem zerou o estoque, ADR-0060) e voltar a vender depende só de reativar.

/** Status TERMINais do ML: anúncio encerrado, o PUT nunca vai passar.
 *  Allowlist invertida de propósito — ver o fail-open em `motivoAnuncioNaoAtualizavel`. */
const STATUS_TERMINAL = new Set(['closed', 'inactive']);

/** Sub-status que significam anúncio removido — pode aparecer junto de qualquer `status`. */
const SUB_STATUS_MORTO = new Set(['deleted', 'forbidden']);

export interface EstadoAnuncioML {
  status?: string | null;
  subStatus?: string[] | null;
}

/**
 * Motivo pelo qual o anúncio NÃO pode ser atualizado, ou `null` se pode.
 *
 * Fail-open em status desconhecido: bloqueia SÓ o que sabemos ser terminal. Um status novo (ou
 * transitório, como `under_review`) segue para o PUT; se o ML recusar, o erro dele chega ao
 * operador como antes. O oposto — bloquear tudo que não for `active`/`paused` — travaria em
 * silêncio atualizações que teriam funcionado, trocando um erro confuso por um bug pior.
 */
export function motivoAnuncioNaoAtualizavel(item: EstadoAnuncioML): string | null {
  const sub = (item.subStatus ?? []).filter((s): s is string => typeof s === 'string');
  const morto = sub.find((s) => SUB_STATUS_MORTO.has(s));
  if (morto) {
    return `Anúncio removido no Mercado Livre (${morto}). Estoque e preço não podem ser atualizados — `
      + 'republique o produto para voltar a vender.';
  }
  const status = item.status;
  if (status && STATUS_TERMINAL.has(status)) {
    return `Anúncio ${status} no Mercado Livre. Estoque e preço não podem ser atualizados — `
      + 'republique o produto para voltar a vender.';
  }
  return null;
}
