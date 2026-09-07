# ADR-0157: UPDATE de família User Products propaga os atributos que divergem do ML

**Status:** Aceito — em produção desde 2026-09-07
**Data:** 2026-09-07
**Decisores:** Diego

## Contexto

O ADR-0156 corrigiu a regex que fazia `"TAM 8 CORES"` virar `UNITS_PER_PACK=8` +
`SALE_FORMAT=Kit`, e uma migration corrigiu o `familias.atributos_ml` das 9 famílias afetadas. O
UPDATE foi publicado pela Revisão, as três famílias voltaram a `status='publicado'` sem erro e o
QStash respondeu 200.

Os nove anúncios no ML continuaram com `SALE_FORMAT='Kit'`.

A causa é estrutural, não um bug pontual: **o UPDATE nunca enviou atributos**. Na rota User
Products (ADR-0088), `reposicao()` em `atualizar-composicao.ts` monta

```ts
{ available_quantity: estoque, ...(somenteEstoque ? {} : { price: precoFamilia }) }
```

e os atributos aparecem apenas em `criarPlano` (`atualizar-familia-up.ts`), isto é, **só quando o
item nasce**. No caminho Legacy o buraco é o mesmo por outro motivo: `AtualizacaoCanonica`
(`_shared/canais/contrato.ts:152`) não tem campo de atributos — carrega `marca` e `categoriaId`,
nada mais.

Consequência prática: corrigir atributo de família já publicada era impossível pelo app. E o
sintoma é silencioso — status `publicado`, QStash 200, ML intacto —, a mesma classe de armadilha
do push de estoque, onde `sincronizar-estoque` devolve 200 em falha definitiva.

## Decisão

Na rota User Products, a reposição passa a enviar `attributes` no PUT — **restrito ao que diverge**
da ficha publicada.

`atributosDivergentes(daFamilia, noMl)` (`_shared/user-products/atributos-divergentes.ts`) compara
`familias.atributos_ml` com a ficha real do item e devolve só o que precisa mudar:

- compara por `value_id` quando os dois lados têm um (identificador do dicionário, estável);
- **o ML vence quando ele tem `value_id` e nós só temos texto** — nunca reenviamos. É a regra do
  ADR-0088 ("o irmão vence"): `familias.atributos_ml` guarda `BRAND: "BUFALO"`, texto cru do campo
  fornecedor, contra o `Búfalo`/9165622 que o ML normalizou. Comparar por nome acusaria divergência
  e todo UPDATE reescreveria a identidade da família — foi assim que a cor Preta do lote 54
  nasceu num `family_id` novo;
- sem `value_id` dos dois lados, compara o nome sem caixa nem espaço de sobra;
- nunca inclui atributo por SKU (`COLOR`, `GTIN`, `EMPTY_GTIN_REASON`, `SELLER_SKU`) nem de
  embalagem (`SELLER_PACKAGE_*`), a mesma lista de `atributos-irmao.ts`;
- nunca remove atributo: o ML não apaga o que não vem no PUT, e a ficha que ele mesmo enriqueceu
  na criação (`COMPOSITION`) não é nossa para apagar.

**Lista vazia significa PUT sem `attributes`** — byte a byte o que já era. Como a esmagadora
maioria dos anúncios está com a ficha em dia, o UPDATE do dia a dia não muda de forma.

A ficha publicada é lida **uma vez por família**, não por cor: os filhos saem todos do mesmo
`atributos_ml`, então o delta medido contra um deles vale para os demais, e mandar a um filho que
já confere é inócuo. A leitura reaproveita o GET que já existia para herdar a ficha do irmão
(`lerFichaCrua`, memoizado) — numa família de 101 cores, 1 chamada em vez de 101.

`somenteEstoque` (ADR-0078 F1) não envia atributo e nem paga o GET: o modo existe para preservar
o anúncio no ar.

Falha ao ler a ficha devolve lista vazia e a reposição segue sem `attributes`. Sem saber o que
está publicado, não se reescreve ficha.

## Consequências

- Atributo corrigido no app passa a chegar ao ML pelo UPDATE normal da Revisão, sem republicar.
- Atributo de closed-set que só temos por `value_name` fica fora do alcance do UPDATE (o ML tem
  `value_id` e vence). Corrige-se pela Revisão, que grava `value_id` (`atributos-familia`), ou
  republicando. É o preço consciente de não desagrupar famílias.
- **O caminho Legacy continua sem propagar atributos.** Cobri-lo exige campo novo em
  `AtualizacaoCanonica` e mexe no PUT de todas as famílias Legacy — blast radius muito maior, que
  merece a sua própria decisão. Enquanto isso, família Legacy com atributo errado (a
  `02829916 — ANNE 65 CORES`) só se corrige republicando.
- Um GET a mais por família em UPDATE que não seja `somenteEstoque`, quando há filho a repor.

## Como reverter

Remover `attributes` do patch em `reposicao()` (`atualizar-composicao.ts`) e a porta
`lerFichaPublicada`. `atributos-divergentes.ts` fica órfão e pode ser apagado.

## Validação em produção (2026-09-07)

Deployado e exercitado no caso real do ADR-0156: as 3 famílias de lantejoula republicadas pela
Revisão, com `atributos_ml` já corrigido no banco. `GET /items/{id}` nos 9 anúncios confirmou
`SALE_FORMAT='Unidade'` e `UNITS_PER_PACK='1'`, com preço, estoque e status `active` intactos —
a rodada anterior, antes desta decisão, tinha deixado os mesmos 9 em `Kit / 8`.
