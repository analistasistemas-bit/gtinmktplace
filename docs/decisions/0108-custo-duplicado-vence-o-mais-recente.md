# ADR-0108 — Com variação duplicada, vence o custo mais recente (não o maior)

- **Status:** aceito
- **Data:** 2026-08-07
- **Contexto relacionado:** ADR-0038 (fonte única `ml_vendas` no faturamento), ADR-0016 (re-ingest
  UPDATE), ADR-0055 (imposto por origem — mesma cadeia de resolução)

## Contexto

`montarMapasCusto` (`src/lib/custos.ts`) monta os mapas que resolvem custo, peso e origem de um
item de venda pela cadeia **variação → anúncio → GTIN → código**. Desde 2026-06-23 (`59f7f6aa`,
sem ADR), o desempate entre linhas com a mesma chave era **o maior custo**, comentado como
"robusto a linhas duplicadas por re-importação".

Em 2026-08-07 Diego reportou uma venda de 2 unidades da **COLA EM BASTÃO 7MM FINA 1KG**
(`02841037`) exibindo custo de **R$ 34,24** quando o custo cadastrado é R$ 15,86 (2 × 15,86 =
R$ 31,71).

A variação existe em **3 famílias** (lotes 26, 39 e 78 — resíduo de re-ingest), e as três têm
**todas as chaves idênticas**: mesmo `ml_variation_id` (`203734189745`), mesmo `ml_item_id`
(`MLB6943015034`), mesmo `gtin` e mesmo `codigo`. Duas carregam o custo antigo de `17,1224`; a
mais recente, `15,8558`.

Duas consequências disso:

1. **Nenhuma chave desambigua.** Não importa por qual ponto da cadeia o resolver entre — sempre
   cai na colisão. O tie-break é a única coisa que decide.
2. **Pelo maior custo, uma redução de custo nunca aparece** enquanto a linha antiga existir.
   `17,1224 × 2 = 34,24`, exatamente o exibido.

Varredura na org: **309 códigos** estavam com o custo inflado pelo mesmo motivo (diferença média
R$ 0,17/un, máxima R$ 1,89) — todos com markup subestimado.

## Decisão

O desempate passa a ser **a linha mais recente por `atualizado_em`**, não a de maior custo. Peso e
origem acompanham a linha escolhida, como já acontecia.

- `atualizado_em` entra no `select` de `buscarCustos` — sem ele no retorno, toda linha vira
  `-Infinity` e a primeira da página venceria por acaso.
- Data ausente ou inválida vale `-Infinity`, e a troca exige data **estritamente maior**: uma
  linha sem data nunca derruba uma linha datada, e o empate mantém a primeira. Assim o
  comportamento é determinístico mesmo com dados velhos.

## Consequências

- Redução de custo passa a refletir no markup assim que é cadastrada. Aumento também — o
  tie-break não tem lado, ele segue o cadastro.
- Perde-se o viés conservador do "maior custo". Era conservador por acidente, não por decisão: o
  efeito real era mostrar um markup menor que o verdadeiro em 309 produtos.
- **Não resolve a raiz**, que é a duplicação de famílias no re-ingest (a mesma que apareceu nos
  tecidos: 3 famílias com o mesmo `ml_item_id`). Enquanto as duplicatas existirem, toda resolução
  por chave depende de um tie-break. Deduplicar `familias` é trabalho à parte, com risco próprio
  por envolver famílias publicadas e o vínculo com o ML.
- O custo usado é sempre o **cadastrado hoje**, não o vigente na data da venda. Uma venda anterior
  a uma mudança de custo passa a ser exibida com o custo novo. Custo histórico por data de venda
  seria outra decisão, não tomada aqui.
