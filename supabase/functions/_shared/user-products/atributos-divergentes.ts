// ADR-0157 — quais atributos o UPDATE de uma família User Products manda ao ML.
//
// Até aqui a reposição da mini-saga (`atualizar-composicao.ts`) mandava só
// `{available_quantity, price}`: os atributos entravam APENAS em `criarPlano`, ou seja, só quando
// o item nascia. Corrigir `familias.atributos_ml` de uma família já publicada não chegava ao
// canal — o app dizia `publicado`, o QStash respondia 200, e o anúncio seguia com o valor antigo
// (incidente ADR-0156: "TAM 8 CORES" ficou `SALE_FORMAT=Kit / UNITS_PER_PACK=8` em 9 anúncios).
//
// Mandar a ficha inteira a cada UPDATE seria o jeito fácil e o errado: reenviar um atributo que o
// ML normalizou (o `Rosa Claro`→`Rosa-claro` do dicionário de COLOR, o `BUFALO`→`Búfalo` do
// ADR-0088) derruba o PUT inteiro, e reescrever identidade desagrupa a família. Então mandamos
// só o DELTA: atributo cujo valor no ML difere do nosso. Quando nada diverge — o caso da imensa
// maioria dos anúncios — nenhum `attributes` vai no PUT e o UPDATE fica byte-a-byte como era.

import type { AtributoItem } from '../canais/contrato.ts';

/** Por SKU: o valor certo é o da variação, não o da família. Reenviá-los a partir de
 *  `atributos_ml` publicaria a cor/GTIN errados. Mesma lista de `atributos-irmao.ts`. */
const POR_SKU = new Set(['COLOR', 'GTIN', 'EMPTY_GTIN_REASON', 'SELLER_SKU']);

/** Dimensões/peso da embalagem: dado nosso, com caminho próprio (ADR-0018). Fora daqui. */
const PREFIXO_PACOTE = 'SELLER_PACKAGE_';

interface AtributoCru {
  id?: unknown;
  value_id?: unknown;
  value_name?: unknown;
}

function texto(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** Índice id → {value_id, value_name} do que o ML tem hoje no item. */
function indexar(attrs: unknown): Map<string, { valueId: string | null; valueName: string | null }> {
  const out = new Map<string, { valueId: string | null; valueName: string | null }>();
  if (!Array.isArray(attrs)) return out;
  for (const cru of attrs as AtributoCru[]) {
    const id = typeof cru?.id === 'string' ? cru.id : null;
    if (!id) continue;
    out.set(id, { valueId: texto(cru.value_id), valueName: texto(cru.value_name) });
  }
  return out;
}

/**
 * Um atributo nosso "confere" com o do ML quando o valor que mandaríamos já é o que está lá.
 *
 * A comparação é por `value_id` SEMPRE que os dois lados têm um: é o identificador do dicionário,
 * estável, e é o que a normalização do ML preserva.
 *
 * Quando o ML tem `value_id` e nós só temos texto, tratamos como CONFERINDO — nunca reenviamos.
 * É a regra do ADR-0088 ("o irmão vence"): o ML já resolveu aquele valor pelo dicionário e o
 * nosso texto cru é a versão pior. Sem isso o `BRAND` do banco (`BUFALO`, sem acento nem
 * `value_id`) divergiria do `Búfalo`/9165622 publicado e todo UPDATE reescreveria a identidade
 * da família — exatamente o que desagrupou a cor Preta no lote 54.
 *
 * O preço disso: atributo de closed-set que só temos por nome fica fora do alcance do UPDATE. Ele
 * se corrige pela Revisão, que grava `value_id` (`atributos-familia`), ou na republicação.
 *
 * Sem `value_id` dos dois lados, compara o nome sem caixa nem espaço de sobra — senão `8` contra
 * `8 ` reabriria um PUT a cada rodada.
 */
function confere(
  nosso: { valueId: string | null; valueName: string | null },
  noMl: { valueId: string | null; valueName: string | null },
): boolean {
  if (nosso.valueId && noMl.valueId) return nosso.valueId === noMl.valueId;
  if (nosso.valueId && !noMl.valueId) return false;
  if (!nosso.valueId && noMl.valueId) return true;
  if (!nosso.valueName || !noMl.valueName) return false;
  return nosso.valueName.trim().toLowerCase() === noMl.valueName.trim().toLowerCase();
}

/**
 * Atributos a incluir no PUT: os de `atributos_ml` cujo valor difere do que o item tem no ML.
 * Lista vazia = nada a corrigir, o chamador NÃO deve mandar `attributes`.
 *
 * Não remove atributo: o ML não apaga o que não vem no PUT, e apagar ficha alheia (o
 * `COMPOSITION` que o próprio ML enriqueceu na criação — ADR-0088) nunca é o que queremos.
 */
export function atributosDivergentes(daFamilia: unknown, noMl: unknown): AtributoItem[] {
  const base = Array.isArray(daFamilia) ? (daFamilia as AtributoCru[]) : [];
  const atual = indexar(noMl);
  const out: AtributoItem[] = [];
  const vistos = new Set<string>();

  for (const cru of base) {
    const id = typeof cru?.id === 'string' ? cru.id : null;
    if (!id || POR_SKU.has(id) || id.startsWith(PREFIXO_PACOTE) || vistos.has(id)) continue;
    const nosso = { valueId: texto(cru.value_id), valueName: texto(cru.value_name) };
    if (!nosso.valueId && !nosso.valueName) continue;
    const remoto = atual.get(id);
    if (remoto && confere(nosso, remoto)) continue;
    vistos.add(id);
    out.push(
      nosso.valueId
        ? ({ id, value_id: nosso.valueId } as AtributoItem)
        : ({ id, value_name: nosso.valueName! } as AtributoItem),
    );
  }
  return out;
}
