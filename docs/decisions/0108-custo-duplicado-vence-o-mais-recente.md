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

## O risco do `atualizado_em`, e por que ele não se materializa

`variacoes.atualizado_em` **não muda só quando o custo muda**. Ele também é tocado por movimento
de estoque: na própria venda que originou este ADR, o timestamp de 2026-08-07 17:33 era a baixa de
2 unidades (`estoque_movimentos.motivo = 'venda'`), não uma alteração de custo — o custo
`15,8558` já estava gravado desde o lote 78, de 03/08.

Isso levanta uma dúvida legítima sobre o critério: se uma baixa de estoque tocasse uma linha
**antiga**, ela viraria "a mais recente" e o custo velho voltaria a vencer.

Medido nos dados de produção em 2026-08-07, sobre os **1683 códigos duplicados** da org:

| Verificação | Resultado |
|---|---|
| Linha mais recente por `atualizado_em` **é** a do lote mais novo | 1683 |
| Linha mais recente aponta para um lote **antigo** | **0** |

Concordância total. As escritas de estoque acompanham a mesma linha "viva" que o re-ingest cria,
então `atualizado_em` e "lote mais recente" apontam para o mesmo lugar. O critério de data é,
na prática, um proxy estável de "cadastro mais atual".

Se um dia essa concordância quebrar, o sintoma é o mesmo de antes — custo antigo voltando a
aparecer — e o desempate deve passar a ser explicitamente pelo lote/família mais recente, em vez
do timestamp da variação. A query que mede isso está registrada com este ADR: comparar, por
código duplicado, `row_number() over (order by atualizado_em desc)` com
`row_number() over (order by lotes.numero desc)`.

## Consequências

- Redução de custo passa a refletir no markup assim que é cadastrada. Aumento também — o
  tie-break não tem lado, ele segue o cadastro.
- Perde-se o viés conservador do "maior custo". Era conservador por acidente, não por decisão: o
  efeito real era mostrar um markup menor que o verdadeiro em 309 produtos.
- **Não resolve a raiz**, que é a duplicação de famílias no re-ingest (a mesma que apareceu nos
  tecidos: 3 famílias com o mesmo `ml_item_id`). Cada lote cria famílias e variações **novas**,
  herdando a identidade no ML em vez de atualizar as linhas do lote anterior — as antigas ficam no
  banco com o custo da época e continuam visíveis para o resolver. Enquanto as duplicatas
  existirem, toda resolução por chave depende de um tie-break. Deduplicar `familias` é trabalho à
  parte, com risco próprio por envolver famílias publicadas e o vínculo com o ML.
- O custo de cada re-ingest vem **sempre da planilha** (`custo: v.CUSTO` no bloco base de
  `ingest-lote`), diferente de `preco_publicacao`, que é preservado (ADR-0016). Não há modo
  "somente estoque": uma planilha subida para mexer apenas no estoque sobrescreve o custo com o
  que ela trouxer. Foi assim que o custo correto de `15,8558` chegou — e é o mesmo caminho pelo
  qual um custo defasado do ERP entraria sem alarde.
- O custo usado é sempre o **cadastrado hoje**, não o vigente na data da venda. Uma venda anterior
  a uma mudança de custo passa a ser exibida com o custo novo. Custo histórico por data de venda
  seria outra decisão, não tomada aqui.
