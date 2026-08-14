# ADR-0118 — Resolução em massa do "Não encontro minha variação" por extensão de navegador

**Status:** Aceito — validado em produção nos 3 anúncios sinalizados (2026-08-13), branch `worktree-catalogo-fase3`
**Data:** 2026-08-13
**Relacionados:** ADR-0021 (opt-in de catálogo), ADR-0036 (alerta de no-match), ADR-0088 (User Products), spec `docs/superpowers/specs/2026-08-12-catalogo-em-risco-design.md`

## Problema

O Mercado Livre pausa o anúncio inteiro quando uma variação sem ficha de catálogo equivalente fica
sem declaração. A saída é declarar **"Não encontro minha variação"** — clique a clique, uma variação
por vez. Nos 3 anúncios sinalizados em 2026-08-13 isso somava **66 cliques** em três telas.

O ADR-0036 fechou a questão como "não automatizável": a ação é um endpoint interno do site,
autenticado por cookie de sessão + CSRF, sem equivalente na API OAuth. A conclusão continua correta
— reverificada em 2026-08-12, o PATCH com Bearer válido responde `403 EBADCSRFTOKEN` —, mas ela
resolvia a pergunta errada. O backend não consegue; **o navegador do operador consegue**.

## Decisão

**Extensão Chrome MV3** (`extensao-ml/`, carregada sem compactação) que executa a declaração na
sessão já logada do operador. Nenhuma credencial é copiada, colada ou armazenada: o cookie é
anexado pelo próprio navegador e o CSRF é lido da página.

**Cookie de sessão no Vault foi descartado** (alternativa considerada): dá acesso total à conta no
site — preço, exclusão, dados financeiros — sem os limites de escopo do OAuth. Trocaria um incômodo
de cliques por risco de conta inteira, e ainda expiraria.

### Contrato (extraído do bundle público do ML e validado em produção)

Duas chamadas por anúncio. A segunda **depende do desfecho da primeira**:

```
1) PATCH .../api/optin-up/{ITEM}/multivariation_matcher_confirm
   { productId, confirmedProductMatches: [{ group_attributes, matches: [{entity_id, catalog_product_id}] }], flow }

2a) POST .../invalidate_summary_confirm     ← quando NENHUMA variação tem ficha
    { productId, flow, variationId, invalidateVariations }
2b) POST .../massive_summary_confirm        ← quando sobra variação vinculada
    { parentProductId, productAssociations, flow, invoice }
```

- `productId` = `parent_catalog_product.id` (**não** o `user_product_id` `MLBU…`).
- `catalog_product_id: null` **é** o "Não encontro minha variação" — literal no código do ML.
- O payload da 2ª chamada é **ecoado** da resposta da 1ª, nunca construído por nós.

### Travas

1. **Dry-run é o padrão.** O payload é montado e exibido; o envio exige confirmação explícita.
   Satisfaz a regra de revisão humana antes de alterar anúncio publicado.
2. **Preservação estrita.** Variação fora da lista de risco só entra no payload com o
   `catalog_product_id` que o PubliAI conhece como `vinculado` **e** que a página confirma. Sugestão
   do ML nunca é aceita — seria contornar a trava `fichaEquivalente` e repetir o incidente do kit
   (ADR-0021). Qualquer ambiguidade → anúncio inteiro vira `manual`.
3. **Vínculo confirmado tem precedência sobre a lista de risco.** O mesmo `ml_variation_id` existe
   em duas famílias do mesmo anúncio (CREATE + UPDATE) e pode carregar status contraditórios —
   `vinculado` numa linha, `nao_elegivel` na outra. Sem essa precedência, a variação que está
   competindo iria como `null`.
4. **Guard de eco** entre as duas chamadas: o conjunto que o servidor computou como `null` tem que
   ser exatamente o enviado. A variação é identificada por `variation_id` (no eco, `entity_id` é o
   **item**, repetido em todas as linhas).
5. **A extensão não escreve no banco do PubliAI.** Terminado o lote, o PubliAI re-enfileira
   `vincular-catalogo` e relê o estado do ML. A verdade única continua sendo o ML.

### Escopo: só o que o ML sinalizou

A lista de alvos vem da tag **`catalog_forewarning`** do item — o mesmo sinal do filtro "Próximos a
serem pausados" do painel. Ela é legível pela API OAuth
(`GET /users/{seller}/items/search?tags=catalog_forewarning`), inclusive no multiget em lote.

Isso substitui a heurística local (`catalog_status` em risco), que listava **130** anúncios contra
os **3** que o ML realmente ameaçava pausar. Decisão do operador em 2026-08-13: agir só nos
sinalizados. `family_diff` fica de fora (recusa explícita de negócio do ML) e vira `manual`.

## Consequências

**Validado em produção** (2026-08-13), nos 3 anúncios, com autorização explícita por anúncio:

| anúncio | variações | resultado |
|---|---|---|
| MLB7066697288 Fio de Malha | 50, nenhuma vinculada | 50 `LOOPING_ITEM`, caminho `invalidate` |
| MLB7159179348 Linha Liza | 4, uma vinculada | 3 `LOOPING_ITEM` + 1 `ALREADY_OPTED_IN` |
| MLB4888109497 Ecoamigurumi | 12, oito vinculadas | 4 `LOOPING_ITEM` + 8 `ALREADY_OPTED_IN` |

Nenhum vínculo perdido; os anúncios seguem `active`, com estoque e status intactos. `LOOPING_ITEM` é
o mesmo status que a investigação de 2026-06-22 registrou como efeito do clique manual.

- O ADR-0036 deixa de ser o fim da linha: o alerta continua válido, mas agora existe ação.
- **Dependência de endpoint interno.** Se o ML mudar o fluxo, a extensão quebra e o operador volta
  ao processo manual. A detecção (Fase 1) continua funcionando de forma independente.
- A extensão só roda com o operador presente e logado. Não há execução autônoma — consequência
  direta de não armazenar sessão.
- **Não é multi-tenant:** funciona na conta em que o operador está logado. Outras organizações
  precisariam do próprio operador executando.

## Pendências

- A extensão foi validada pela função pura e pelas chamadas reais, mas o **painel** (fluxo de
  clique do operador) ainda não foi exercitado ponta a ponta.
- O caminho de **item plano** (`ml_variation_id = ml_item_id`, 16 anúncios) usa outro fluxo no ML e
  segue fora do lote.
