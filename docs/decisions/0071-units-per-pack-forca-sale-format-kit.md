# ADR-0071: UNITS_PER_PACK real força SALE_FORMAT=Kit

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego

## Contexto

Lote #33 (lápis de cor 24 unidades): CREATE no ML falhou com `"Unidades por kit": Insira 1 neste
campo porque você preencheu "Unidade" no campo "Formato de venda"`.

Causa: duas lógicas independentes preenchem atributos de kit sem se comunicar.

1. `preencherAtributosClosedSet` (IA genérica, `atributos-llm-core.ts`) preenche `SALE_FORMAT`
   ("Formato de venda") a partir do closed-set da categoria — sem sinal explícito de "kit" no
   texto, cai em "Unidade".
2. `preencherUnitsPerPack` (regex dedicado, ADR-0063/lote #27) extrai contagem do nome/descrição
   ("24UND", "100UND") e preenche `UNITS_PER_PACK` com o número — comportamento intencional e
   testado desde o lote #27, para não travar a Revisão pedindo contagem em produto avulso.

`resolverAtributosGenericos` roda os dois em sequência (closed-set primeiro, depois
`preencherUnitsPerPack`), mas nenhum dos dois olha o resultado do outro. Quando a contagem
extraída é > 1, o ML rejeita a combinação `SALE_FORMAT=Unidade` + `UNITS_PER_PACK>1`.

## Decisão

`preencherUnitsPerPack` passa a **sobrescrever `SALE_FORMAT` para "Kit"** (usando o `value_id` do
schema dinâmico da categoria) sempre que extrair uma contagem real (> 1) do nome/descrição —
mesmo que a IA já tenha preenchido "Unidade". Sem contagem clara (assume 1, produto avulso), não
mexe em `SALE_FORMAT`.

Implementado em `supabase/functions/_shared/categoria/atributos.ts` (`preencherUnitsPerPack` +
`forcarSaleFormatKit`). Se a categoria não expõe `SALE_FORMAT` no schema, não faz nada (mesmo
gate de `UNITS_PER_PACK`).

## Consequências

- Produtos com contagem real no título/descrição ("24UND", "100 unidades") passam a publicar como
  `SALE_FORMAT=Kit` no ML, consistente com `UNITS_PER_PACK`.
- Não interfere na trava de equivalência do catálogo (`catalogo.ts`/ADR-0021), que só *lê* a
  ficha do ML — continua tratando `UNITS_PER_PACK>1`/`SALE_FORMAT≠Unidade` como sinal de kit
  divergente do nosso produto avulso.

## Emenda (2026-10-27): Kit sem contagem vira Unidade

**Incidente.** Hairfly, "Shampoo + condicionador Tanox Trat Sete Óleos 2000ml" (MLB1265): a IA
marcou `SALE_FORMAT=Kit` e `IS_KIT=Sim` ("+" = dois produtos), mas o texto não traz contagem, então
`preencherUnitsPerPack` assumiu 1. O ML recusou: `item.attribute.invalid_sale_units — "Quantidade de
embalagens": Insira um valor diferente de "1" porque você preencheu "Kit"`. É o inverso do caso
acima, que esta ADR não cobria.

**Decisão (Diego escolheu entre pedir a contagem ao operador e forçar Unidade).** Sem contagem real
(> 1) no nome/descrição, `SALE_FORMAT=Kit` é trocado por "Unidade" (value_id do schema). Só troca
se já estava Kit; `IS_KIT` não é tocado. Nunca bloqueia a Revisão; o custo aceito é um kit de 2
frascos publicar como "Unidade".

**Prova (dry-run `POST /items/validate`, payload real, 27/10):** Kit+Sim+1 → `invalid_sale_units`;
Unidade+Sim+1, Unidade+Não+1 e Kit+Sim+2 → só o warning de frete `lost_me1_by_user` (normal).

## Emenda 2 (2026-10-27, mesmo dia): Kit sem contagem pede a quantidade ao operador

**Por que a emenda 1 caiu.** O "Pós Química" publicou como Unidade/1 e o ML, **na criação**, ligou o
item pelo GTIN a uma ficha de catálogo `flex` (MLB2066191442, Kit/2) que `/products/search` não acha.
O item nasceu `catalog_listing: true`, sem anúncio tradicional, com a página "indisponível", e o nosso
estado ficou `sem_produto`. O próprio catálogo provou que "Shampoo + condicionador" é Kit de 2.

**Decisão (Diego, 27/10).**
1. Kit sem contagem real no texto: **não** assume 1 nem troca para Unidade — `UNITS_PER_PACK` fica
   **faltando** (`faltanteKitSemContagem`) e a Revisão trava até o operador informar. Vale no resolver
   genérico, no ramo de aviamento do `process-familia` e no salvar do `atributos-familia`; o editor
   oferece o campo mesmo quando a categoria o marca como opcional. Kit vinculado (ADR-0151) não trava:
   o N real preenche (`criar-kit-vinculado` tira o atributo dos faltantes; `definir-categoria-familia`
   remove o faltante depois de aplicar N).
2. **Alerta pós-publicação** (`vincular-catalogo`, User Products): se o ML criou o item já como anúncio
   de catálogo, a ficha é lida por id e comparada com a trava anti-kit (`fichaEquivalente`). Divergente →
   `catalog_status='ficha_divergente'` com o comparativo e Telegram próprio ("Corrigir e republicar").
   Leitura que falha → fluxo antigo, nunca falso divergente. Prova com o anúncio real: Pós Química →
   divergente (Kit 2 × Unidade 1); Neutralizante de catálogo → equivalente.

**Limitações.** Legacy fica de fora (só UP). O card de risco de catálogo da tela Publicados lê
`variacoes`, não `anuncios_externos_itens` — o aviso desta emenda chega por Telegram e fica gravado no
item, não no card.

## Emenda 3 (2026-10-27): "Kit" só com prova no texto; shampoo + condicionador é sempre kit

**Incidente.** Lote Hairfly de 27/10: a IA de atributos marcou `SALE_FORMAT=Kit` e `IS_KIT=Sim` para
"Creme Alisante Hair Fly Mel e Lanolina 80g" (produto único, descrição sem "kit") e a emenda 2 travou a
Revisão pedindo "Quantidade de pacotes" sem motivo.

**Decisão (Diego, 27/10).** Em `preencherUnitsPerPack`, antes das regras de quantidade:
1. "Kit" da IA só vale com **prova no texto**: quantidade > 1 escrita ou a palavra "kit" (nome ou
   descrição); " + " entre palavras ou "shampoo" e "condicionador" **só no nome** — na descrição são
   modo de uso ("após o shampoo e condicionador") ou fórmula ("vitaminas A+E"). Sem prova →
   `SALE_FORMAT` Unidade e `IS_KIT` Não.
2. **Shampoo + condicionador é sempre kit** (as duas palavras no nome, qualquer ordem, o que houver no
   meio): `SALE_FORMAT` Kit e `IS_KIT` Sim, mesmo que a IA diga Unidade, nada ou "É kit: Não"; com
   quantidade no texto vira Kit + N, sem quantidade a Revisão pede (emenda 2). Em categoria sem
   `SALE_FORMAT`, "É kit = Sim" conta como Kit para pedir a quantidade.
3. Kit vinculado (ADR-0151): `aplicarKitNosAtributos` grava também `IS_KIT` Sim, para não herdar o "Não"
   da trava quando a base não tem prova de kit no texto (revisão Codex).

Não retroativo: famílias já processadas só mudam com Reprocessar.

## Como reverter

Remover a chamada a `forcarSaleFormatKit` dentro de `preencherUnitsPerPack`.
