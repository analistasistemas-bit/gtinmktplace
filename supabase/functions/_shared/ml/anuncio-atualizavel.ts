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

/** Tag que o ML põe nos dois lados enquanto o UPtin está em andamento (cai ao concluir). */
const TAG_MIGRACAO_EM_ANDAMENTO = 'variations_migration_pending';

export interface EstadoTagsML {
  tags?: string[] | null;
}

/**
 * ADR-0160 (I9): item no meio da migração "preço por variação" (UPtin) — ou `null`.
 *
 * O UPtin é assíncrono. Enquanto roda, o item ORIGINAL segue `active` (tags
 * `variations_migration_pending` + `variations_migration_source`) e o ML clona cada variação num
 * item novo (`paused`, `_pending` + `_uptin`). Ao concluir, `_pending` cai dos dois lados, os
 * clones são ativados e o original é encerrado.
 *
 * Um PUT nessa janela é aceito com 200 e PERDIDO: os clones foram criados a partir do estado
 * anterior. O app gravaria `preco_publicado_ml` como confirmado enquanto a vitrine sobe com o preço
 * velho — divergência silenciosa, sem badge, sem erro. Por isso o guard é retentável, não terminal:
 * a migração termina sozinha em minutos e o job seguinte passa.
 *
 * Só `_pending` conta. `_uptin` marca o clone e `_source` marca o original encerrado — nenhuma das
 * duas tem queda documentada, e barrar por elas tornaria item migrado (ou dissolvido, ADR-0105)
 * permanentemente inatualizável.
 */
export function migracaoEmAndamento(item: EstadoTagsML): string | null {
  const tags = (item.tags ?? []).filter((t): t is string => typeof t === 'string');
  if (!tags.includes(TAG_MIGRACAO_EM_ANDAMENTO)) return null;
  return 'Anúncio em migração para preço por variação (User Products) no Mercado Livre. '
    + 'Atualizar agora seria perdido: o ML está clonando as variações e publicaria os valores '
    + 'anteriores. A migração termina sozinha — o app tenta de novo.';
}

/**
 * ADR-0105: sub_status que prova anúncio REMOVIDO/bloqueado (não migrado), ou `null`.
 *
 * O `status` terminal sozinho é ambíguo — `closed` é também o estado em que o ML deixa o item
 * Legacy quando DISSOLVE a família em User Products (lote #45: `closed` com `sub_status: []`, e
 * 17 itens novos sob um `family_id`). Só o sub_status distingue "morreu" de "virou outra coisa".
 */
export function subStatusMorto(item: EstadoAnuncioML): string | null {
  const sub = (item.subStatus ?? []).filter((s): s is string => typeof s === 'string');
  return sub.find((s) => SUB_STATUS_MORTO.has(s)) ?? null;
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
  const morto = subStatusMorto(item);
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
