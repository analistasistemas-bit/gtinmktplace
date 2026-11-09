# ADR-0202 — Atributos visuais de roupa preenchidos pela foto

**Data:** 2026-11-08
**Status:** aceito
**Decisores:** Diego
**Relaciona:** estende [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md), [ADR-0049](0049-atributos-opcionais-e-numericos-por-ia.md) e [ADR-0052](0052-camada2-atributos-ia-first-com-fallback.md)

## Contexto

A IA de atributos lê só o nome e a descrição da planilha. Atributos que só aparecem na peça (o
**Tipo de manga** de uma blusa, obrigatório em MLB3112) nunca constam no texto, então toda blusa
travava na Revisão com "Faltam: Tipo de manga" e o operador escolhia na mão, olhando a mesma foto
que o app já tem (lotes #17 e seguinte, 2026-11-08).

## Decisão

1. **Visão só para uma lista fechada de atributos visuais**, em `_shared/ai/atributos-visao.ts`:
   `SLEEVE_TYPE`, `WEDGE_SHAPE`, `T_SHIRT_COLLAR_TYPE`, `SHIRT_COLLAR`, `WITH_HOOD` (levantados nas
   categorias de roupa usadas nos últimos 120 dias). Material, composição, temporada e afins ficam
   fora: a foto não prova.
2. **Só closed-set e só o que o texto deixou vazio.** Roda depois da IA de texto, com a foto da 1ª
   variação que tem imagem. A resposta passa pela mesma validação (`value_id` dentro da lista da
   categoria); na dúvida o modelo omite e o atributo segue faltante, como hoje.
3. **A foto vira evidência só para esses atributos.** A regra "nunca inventar dado de produto" segue
   valendo: o valor sai de uma lista fechada e descreve o que está na imagem.
4. **Visível e corrigível na Revisão.** Nova coluna `familias.atributos_por_foto` (jsonb:
   `[{id, nome, valores}]`). O card de categoria mostra "Pela foto (IA) — confira" com o valor atual
   de cada um em um `Select`; trocar salva pelo `atributos-familia` (`salvar`), que já valida e marca
   `atributos_editados_pelo_operador`.
5. **Escopo:** só o `process-familia` (CREATE e reprocesso). Troca manual de categoria
   (`definir-categoria-familia`) e kit vinculado seguem só com texto.

## Consequências

- Uma chamada de visão (`MODELO_VISION`, `detail: low`) por família, só quando sobra atributo visual
  vazio. Custo na casa de centavos; falha ou timeout → segue o fluxo atual (faltante).
- Revisão humana preservada: o valor aparece marcado e editável antes de publicar.
