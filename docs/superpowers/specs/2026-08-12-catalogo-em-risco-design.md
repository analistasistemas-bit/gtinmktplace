# Catálogo em risco — detecção real + resolução em massa do "Não encontro minha variação"

**Data:** 2026-08-12
**Status:** Aprovado (design)
**Relacionado:** [ADR-0021](../../decisions/0021-vinculacao-automatica-ao-catalogo-ml.md), [ADR-0036](../../decisions/0036-alerta-catalogo-no-match.md), [ADR-0045](../../decisions/0045-vendas-catalogo-match-ean.md), `_shared/ml/catalogo.ts`, `vincular-catalogo`

---

## Problema

O Mercado Livre exige que anúncios de certas categorias sejam associados ao catálogo. Quando uma
variação não tem ficha equivalente e fica sem declaração, o ML **pausa o anúncio inteiro**.

A saída manual é entrar no anúncio → "Verificar produto" → "Buscar" → **"Não encontro minha
variação"** → Confirmar, uma variação por vez. Em anúncios com dezenas de cores isso custa horas.

Hoje o operador descobre o problema pelo painel do ML (filtro "Próximos a serem pausados"), não
pelo PubliAI.

## Estado real medido (2026-08-12)

**Só variações que existem no ML** (`ml_variation_id` não nulo). Linhas sem `ml_variation_id` nunca
foram publicadas e carregam o valor *default* da coluna (`'pendente'`) — são ruído, não estado.

| catalog_status | publicadas no ML | famílias | nunca publicadas (ruído) |
|---|---|---|---|
| nao_elegivel | 1.050 | 122 | 17 |
| family_diff | 702 | 21 | 0 |
| vinculado | 553 | 38 | 0 |
| sem_produto | 329 | 40 | 0 |
| pendente | 296 | 93 | 2.234 |
| ficha_divergente | 145 | 17 | 0 |
| erro | 22 | 5 | 0 |

Variações publicadas em situação de no-match (`nao_elegivel` + `sem_produto` + `ficha_divergente` +
`pendente`): **1.820**.

**Qualquer consulta desta feature filtra `ml_variation_id is not null`.** Sem esse filtro a tela
mostraria 2.234 falsos positivos.

## Causa raiz da cegueira

O alerta do ADR-0036 nunca dispara nos casos que importam, por um único motivo verificável.

`decidirResultadoRodadaCatalogo` trata os dois estados de espera de forma invertida:

```ts
if (resumo.pendente > 0) return { acao: 'aguardar_elegibilidade' };        // → HTTP 500
if (resumo.nao_elegivel > 0 && tentativaAtual < CATALOGO_MAX_TENTATIVAS)   // → backoff 1h/6h/24h/48h
  return { acao: 'reagendar', ... };
```

- `nao_elegivel` reagenda pelo backoff longo (`CATALOGO_BACKOFF_SEGUNDOS`, até ~79h).
- `pendente` devolve **500** e depende exclusivamente do retry do QStash — cinco tentativas ao longo
  de minutos. Esgotado isso, ninguém pergunta de novo. **Nunca.**

O estado que precisa de mais tempo recebeu a janela mais curta.

E como `deveAlertarCatalogoNoMatch` exige `pendente === 0`, a família congelada em `pendente` também
nunca gera alerta. Silêncio duplo.

### Prova

`MLB6928315454` tem 74 variações em `pendente` no banco. Consultando a elegibilidade hoje:

```
GET /items/MLB6928315454/catalog_listing_eligibility → 200, 74 variações
```

Cruzando os 74 `ml_variation_id` pendentes com o payload atual: **todos os 74 têm status
`FAMILY_DIFF`**. O ML já respondeu há muito tempo. O dado existe. O worker é que parou de perguntar.

Não é "o ML não computa" nem "a variação está ausente do payload" — é retry curto demais.

### Contra-hipótese descartada

Cheguei a supor que o ML omitisse variações do payload (a Linha Liza `MLB7159179348` tem 77 linhas
no banco e a elegibilidade devolve 4). Verificado e **falso**: `GET /items/MLB7159179348` mostra que
o anúncio tem **4 variações no ML**, status `active`. As outras 73 pertencem a uma segunda família
(UPDATE de 03/08, mesmo `ml_item_id`) e têm `ml_variation_id` nulo — nunca foram publicadas.

Consequência de design: **não é preciso status novo nem migration.** A elegibilidade chega; basta
voltar a lê-la.

## Por que não dá para automatizar a declaração pela API OAuth

A ação "Não encontro minha variação" é
`PATCH https://www.mercadolivre.com.br/produzir/catalogo/api/optin-up/<ITEM>/multivariation_matcher_confirm`
— endpoint interno do site, não da API pública. O mecanismo do no-match é enviar
`catalog_product_id: null` para a variação.

Reverificado em 2026-08-12 (não é informação herdada de junho): o PATCH com
`Authorization: Bearer <token OAuth válido>` contra um item **inexistente** (`MLB0000000000`,
nenhum anúncio real tocado) responde:

```
403 {"status":403,"message":"invalid csrf token","code":"EBADCSRFTOKEN","name":"ForbiddenError"}
```

Barra no CSRF antes de avaliar o Bearer. Não é questão de escopo OAuth — é outra camada de
autenticação, do site. A conexão do canal (`marketplace_connections`) não serve.

`POST /items/catalog_listings` exige `catalog_product_id` não-nulo, então não cobre o no-match.

## Alternativa descartada: cookie de sessão no Vault

Guardar o cookie de sessão web do ML no Vault deixaria o worker resolver sozinho, sem o operador.
**Descartado:** um cookie de sessão web dá acesso **total à conta no site** (alterar preço, excluir
anúncio, dados financeiros), sem os limites de escopo do OAuth — troca um incômodo de cliques por
risco de conta inteira. E expira, então a renovação manual voltaria de qualquer forma.

## Decisão

Duas metades independentes.

**Metade 1 — detecção (server-side, só OAuth):** o worker volta a perguntar, o alerta passa a sair,
e uma tela mostra o estado. Não depende de sessão web, entrega valor sozinha.

**Metade 2 — ação em massa (extensão de navegador):** a declaração no ML é acionada pelo operador,
executada na sessão dele, sem credencial armazenada em lugar nenhum.

---

## Parte 1 — Backend enxerga

Sem migration e sem status novo. Três correções em `_shared/ml/catalogo.ts` / `vincular-catalogo`.

### 1.1 `pendente` passa a usar o backoff longo

`decidirResultadoRodadaCatalogo`: `pendente` deixa de devolver `aguardar_elegibilidade` e passa a
reagendar pelo mesmo `CATALOGO_BACKOFF_SEGUNDOS` já usado por `nao_elegivel` (1h/6h/24h/48h,
`CATALOGO_MAX_TENTATIVAS` = 5). Na última tentativa, **finaliza** em vez de esperar.

Pendência e não-elegibilidade passam a compartilhar o mesmo orçamento de tentativas — o que sobrar
de `pendente` na finalização é reportado como está, sem ser reetiquetado.

### 1.2 Falha de elegibilidade não pode finalizar

Hoje, quando `buscarElegibilidadeCatalogo` lança, o orquestrador faz `return resumo` com todos os
contadores zerados. Com a mudança acima, esse resumo zerado cairia direto em `finalizar` — a rodada
encerraria em silêncio, sem ter perguntado nada, e ainda consumiria uma tentativa.

`vincularVariacoesCatalogo` passa a sinalizar a falha de leitura (campo `elegibilidade_falhou` no
resumo, ou exceção propagada), e o worker devolve **500 para retry** nesse caso — nunca finaliza.

Esta é a única forma de "não perguntei" e precisa ser distinguível de "perguntei e não havia dado".

**O guard vale para os dois caminhos.** No User Products (ADR-0088, `vincularItensCatalogoUP`), a
elegibilidade é lida por item, e hoje uma falha desse GET cai no catch por item e persiste
`catalog_status='erro'` — falha transitória de rede virando estado final. Passa a contar como
`pendente` (retentável pelo mesmo backoff), sem persistir nada: "não perguntei" não é estado do
item em nenhuma das rotas.

### 1.3 Alerta

`deveAlertarCatalogoNoMatch` deixa de exigir `pendente === 0` e passa a contar `pendente` residual
entre os motivos de alerta.

**A garantia do ADR-0036 é preservada por outro caminho:** o alerta só é avaliado quando a ação da
rodada é `finalizar`. Rodadas intermediárias não alertam. O que muda é o critério de finalizar, não
a regra de alertar uma vez por publicação.

`decidirMotivoAlertaCatalogo` ganha o motivo `elegibilidade_nao_resolvida` para o caso de `pendente`
sobrevivente até a última tentativa.

### 1.4 Backfill das famílias congeladas

Re-enfileirar `vincular-catalogo` para as 93 famílias com variação `pendente` publicada, com
`tentativa = 1` (elas precisam do ciclo completo apenas se a elegibilidade ainda não estiver pronta —
e a evidência mostra que já está, então tendem a resolver na primeira rodada).

A rodada executa o opt-in normal antes de decidir: famílias cuja elegibilidade amadureceu vinculam
sozinhas no caminho.

Disparo por script de manutenção que publica no QStash o mesmo job do worker (via
`qstashClient()`, mesmo destino/formato de `enfileirarVinculacaoCatalogo`). **Não há fila
serializada neste caminho** — o publish é direto (a `garantirFilaSerial` é do
`publicar-familias`, outro fluxo). O script escalona os disparos por delay crescente para não
saturar a API do ML.

**O backfill é silencioso** (decisão 2026-08-13): re-vincular 93 famílias de uma vez dispararia
dezenas de alertas de Telegram; o resultado deve aparecer na tela da Parte 2, de uma vez, não no
celular. Mecanismo: o job carrega o campo opcional `alertar` **no body** — o script publica direto
no QStash (mesmo destino/formato de `enfileirarVinculacaoCatalogo`) com `alertar: false`; o worker
lê o campo do body parseado (tipo estendido localmente, sem tocar `queue.ts`), propaga-o nos
reagendamentos da mesma cadeia e, na finalização, suprime só o Telegram (persistência e
espelhamento seguem normais). Job sem o campo alerta como sempre — publicações novas não mudam, e
`enfileirarVinculacaoCatalogo`/`queue.ts` ficam intocados (revisão 2026-08-13: mudar `queue.ts`
arrastaria a frota QStash inteira, 24 funções, para o redeploy). A janela de silêncio morre com a
cadeia: nenhum estado novo em tabela, nenhuma migration, nada para lembrar de desligar depois.

---

## Parte 2 — Tela "Catálogo em risco"

Card em **Publicados**, mesmo padrão visual do banner de moderados já existente.

**Fonte:** famílias com `ml_item_id` não nulo que tenham ao menos uma variação **com
`ml_variation_id` não nulo** em `ficha_divergente`, `sem_produto`, `nao_elegivel` ou `pendente`.

**Por anúncio:** título, quantidade de variações sem ficha, motivo predominante, link direto para
`mercadolivre.com.br/produzir/catalogo/<item>` (o mesmo link que o alerta de Telegram já monta).

**Ação:** botão "Resolver todos no ML", que entrega a lista à extensão.

A tela é também a mitigação do risco de timing do alerta: o backoff pode levar até ~79h para
finalizar e disparar o Telegram, mas a tela reflete o estado a qualquer momento, sem esperar
finalização.

Sem a extensão instalada, o botão fica indisponível e o link por anúncio continua servindo — a tela
tem valor isolado.

### Mudança de escopo (2026-08-13): fonte passa a ser a tag `catalog_forewarning`

Decisão do Diego. O ML sabe exatamente quais anúncios estão prestes a ser pausados e expõe isso
numa tag do item — não é preciso inferir pelo `catalog_status` local.

Verificado ao vivo em 2026-08-13 (leitura, token AVILBV):

```
GET /items/MLB7066697288?attributes=id,status,sub_status,tags
→ tags: ["catalog_listing_eligible","catalog_forewarning","good_quality_thumbnail", ...]

GET /users/{seller}/items/search?tags=catalog_forewarning
→ results: ["MLB7066697288","MLB7159179348","MLB4888109497"], total: 3
```

Esses 3 são exatamente os que o painel do ML mostra em "Próximos a serem pausados" — contra os 130
que a heurística por `catalog_status` (acima) inferia. **O card passa a listar SOMENTE os anúncios
com a tag `catalog_forewarning`.** Os demais somem da tela, não viram seção secundária.

Implementação: `StatusCanal.catalogForewarning` (novo campo em
`_shared/canais/contrato.ts`) — `mercadoLivreConnector.lerStatus` passa a pedir `tags` no
`attributes=` do lote e `parseStatusML` (`_shared/ml/status.ts`) preenche o campo a partir de
`tags.includes('catalog_forewarning')`. Canal sem essa noção → `false`. No front,
`useStatusPublicados()` (já consumido por `Publicados.tsx`) já traz o status ao vivo por
`ml_item_id`; `filtrarCatalogForewarning` (`src/lib/catalogo-risco.ts`) cruza isso com a lista
agregada por `agruparCatalogoRisco` antes de passar para o card — sem query nova.

A agregação por `catalog_status` (Parte 1, acima) continua sendo a base de dados que fornece
`variacoesRisco`/`vinculos`/`itemPlano` por anúncio (a extensão da Parte 3 precisa disso); o que
mudou é o filtro final de QUAIS anúncios aparecem na tela e viram alvo da extensão.

---

## Parte 3 — Extensão de navegador

Pasta `extensao-ml/` no repositório, MV3, carregada sem compactação no Chrome do operador.

### Manifesto e permissões

`host_permissions`: `*://*.mercadolivre.com.br/*` e o domínio do PubliAI. Nada além.

### Fluxo

1. Operador clica "Resolver todos" no PubliAI.
2. Content script no PubliAI captura a lista de `ml_item_id` e repassa ao service worker.
3. Para cada anúncio, na origem do ML (onde o navegador anexa o cookie sozinho e o CSRF é lido da
   própria página): obtém `productId`, a estrutura de variações e os matches atuais.
4. Monta `confirmedProductMatches` enviando `catalog_product_id: null` nas variações sem ficha e
   **preservando os matches já corretos** — reenviar sem eles desfaria vinculações válidas.
5. `PATCH .../multivariation_matcher_confirm` com `flow: "REPRODUCTIZE"`.

### Dry-run é o padrão

A primeira passada **monta e exibe** o payload sem enviar. O envio exige confirmação explícita do
operador. Isso satisfaz a regra do projeto de revisão humana antes de alterar anúncio publicado, ao
custo de um clique.

### A extensão não escreve no banco do PubliAI

Concluído o lote, o PubliAI re-enfileira `vincular-catalogo` e relê o estado a partir da API do ML.
A verdade única continua sendo o ML — a extensão não duplica estado.

### Erros

- **Sessão do ML caída:** o PATCH devolve o mesmo `403 EBADCSRFTOKEN` observado no teste. A
  extensão instrui o operador a logar no ML e reexecutar.
- **Falha parcial:** relatório por anúncio; o lote é reexecutável. O matcher confirm é declarativo,
  reenviar o mesmo payload não quebra.
- **Anúncio já resolvido:** idempotente por natureza.

---

## O que NÃO muda

A trava `fichaEquivalente` (ADR-0021 pós-incidente do kit) permanece intacta. Ela responde pelas 145
variações em `ficha_divergente`, majoritariamente com motivo
`dominio_MLB-YARNS_vs_MLB-SEWING_AND_CRAFT_THREADS` — o ML oferecendo ficha de linha de costura para
fio de crochê. Recusar está correto; foi essa trava que evitou o incidente de vincular unidade
avulsa a ficha de kit de 10 cones.

A parte "tentar achar a variação automaticamente" do pedido original **já existe** e é essa trava
mais o opt-in por GTIN. Não é reescrita aqui.

`family_diff` (702 variações, 21 famílias) é recusa explícita de negócio do ML e segue com o
tratamento atual — entra na tela como informação, não como pendência acionável.

---

## Contrato do matcher confirm — RESOLVIDO (2026-08-13)

A incógnita do `productId` está fechada. **A hipótese anterior estava errada:** não é o
`user_product_id` (`MLBU…`) devolvido pela elegibilidade.

Método: leitura do bundle público do app do ML (`syp-optin-frontend`,
`optin-user-products.8cf6b4f2.js`) e do estado renderizado da página do matcher, com o Chrome do
operador anexado por CDP em modo leitura. **Nenhum anúncio foi tocado** — nenhum clique de
confirmação, nenhuma escrita.

### Contrato (extraído do código do próprio ML)

```
PATCH {basePath}/api/optin-up/{ITEM_ID}/multivariation_matcher_confirm
{
  productId,                        // = parentCatalogProductId
  confirmedProductMatches: [{
    group_attributes: [{ id, name, value_id, value_name }],
    matches: [{ entity_id, catalog_product_id }]
  }],
  flow: "REPRODUCTIZE"
}
```

Mapeamento, conforme `getMappedGroups` e `onCardConfirm` do bundle:

- **`productId`** = `parentCatalogProductId`. Vem pronto no estado da página como
  `original_catalog_product_id` (no `MLB4888109497` inspecionado: `MLB28848109`), repetido em todas
  as variações do grupo.
- **`group_attributes`** = `match_product.attributes` mapeado para `{id, name, value_id, value_name}`.
- **`matches[].entity_id`** = `variation.id` (o `variation_id` do estado, ex.: `205157946311`) —
  **não** o item id.
- **`matches[].catalog_product_id`** = `variation.match?.product?.id || null`. **O `|| null` é
  literalmente o "Não encontro minha variação"** — confirmado no código do ML, não mais hipótese.
- Variações com `status` já definido são **filtradas para fora** (`filter(e => !e.status)`).

### Endpoints vizinhos do mesmo módulo (contexto, não usados nesta fase)

`matcher_confirm` (variação única: `{productId, matches, flow}`), `product_search_confirm`,
`comparation_confirm`, `invalidate_summary_confirm`, e `massive_summary_confirm`
(`{parentProductId, productAssociations, flow, invoice}`) — este último é a etapa de **resumo final**
do fluxo de um anúncio multivariação (`experience: "MASSIVE"` refere-se a múltiplas variações do
mesmo anúncio, **não** a vários anúncios de uma vez). Continua valendo: **uma chamada por anúncio**.

### Validado em produção (2026-08-13) — 1º envio real, `MLB7066697288`

O contrato acima foi executado ponta a ponta, com autorização explícita do operador, no anúncio
"Fio De Malha Extra Premium" (50 variações, **todas** sem ficha, nenhum vínculo a preservar —
escolhido justamente por não haver o que estragar).

**Correção importante ao que este documento previa:** o fluxo tem duas chamadas, e a segunda **não
é sempre** `massive_summary_confirm`. Quando todas as variações vão como `null`, o ML roteia para um
fluxo de invalidação:

```
1) PATCH .../multivariation_matcher_confirm   → 200
   resposta: step "INVALIDATION_SUMMARY", confirm_card "MASSIVE_USERPRODUCT_INVALIDATE",
             step_data.invalidate_variations = [os 50 entity_id]

2) POST  .../invalidate_summary_confirm       → 200
   body: { productId, flow, variationId, invalidateVariations }   (ecoado da resposta 1)
   resposta: step "CONGRATS_WARNING", type "MASSIVE_INVALIDATE_BUYBOX"
```

### O caminho com preservação — validado em `MLB7159179348` (Linha Liza)

Executado logo depois, no anúncio com **3 variações sem ficha e 1 vinculada** (Acqua 2500 →
`MLB31005551`). Aqui o ML roteia para o outro desfecho:

```
1) PATCH .../multivariation_matcher_confirm   → 200
   resposta: step "MASSIVE_SUMMARY", add_invoice false,
             footer_type "MASSIVE_CATALOGREQUIRED_PARTIAL_BUYBOXOPTIN"  (parcial: um sobreviveu)
             product_associations = 3 com null + 1 com MLB31005551

2) POST  .../massive_summary_confirm          → 200
   body: { parentProductId, productAssociations, flow, invoice: null }   (ecoado da resposta 1)
   resposta: step "MASSIVE_CONGRATS_SUCCESS", type "PRODUCT_CHANGE", catalog_created_quantity 1
```

**Resultado na elegibilidade** — a prova de que a preservação funcionou:

| variação | cor | status depois |
|---|---|---|
| 197583285254 | Acqua 2500 | **`ALREADY_OPTED_IN`** (segue vinculada e competindo) |
| 197583285256 | Bandeira | `LOOPING_ITEM` |
| 197583285258 | Bco 8001 | `LOOPING_ITEM` |
| 197583285260 | Manteiga | `LOOPING_ITEM` |

`LOOPING_ITEM` é exatamente o status que a investigação de 2026-06-22 registrou como efeito do
clique manual "Não encontro minha variação" — agora confirmado como resultado da automação.

**Formato do eco (corrigiu um guard errado):** em `product_associations` o `entity_id` é o **item**
(repetido em todas as linhas) e a variação vem em **`variation_id`**. O guard comparava por
`entity_id` e teria rejeitado a resposta correta como divergente.

**Efeito medido no item** (antes → depois):

| campo | antes | depois |
|---|---|---|
| `catalog_product_id` | `MLB53418360` | `null` |
| tag `catalog_listing_eligible` | presente | removida |
| tag `catalog_forewarning` | presente | **removida** (após alguns minutos) |
| `status` | `active` | `active` |

`GET /users/{seller}/items/search?tags=catalog_forewarning` caiu de **3 para 2** anúncios — o item
saiu da fila de pausa do ML, continuando ativo e vendendo. A página do wizard voltou ao passo
`SEARCH` ("Busque seu produto no catálogo"), coerente com a associação ao produto-pai ter sido
desfeita: como nenhuma das 50 variações tinha ficha, não havia competição a perder.

O guard de eco funcionou: o servidor devolveu exatamente os 50 `entity_id` enviados como `null`.

**Nota de execução:** o PATCH da chamada 1 acabou sendo enviado duas vezes (uma tentativa cuja saída
não foi capturada pelo filtro do terminal, e a repetição). Sem efeito colateral — o matcher confirm
é declarativo e a segunda resposta foi idêntica —, o que confirma na prática a idempotência assumida
no desenho.

### O que ainda não foi observado

O `basePath` real e os headers exatos (cookie de sessão + `x-csrf-token`) não foram capturados de uma
requisição viva, porque isso exigiria disparar uma confirmação real. Executando **dentro da página**
(extensão/content script), os dois são resolvidos pelo próprio navegador — é o motivo adicional de a
extensão rodar na origem do ML em vez de o backend replicar a chamada.

---

## Testes

**Funções puras (vitest), no padrão dos testes já existentes de `catalogo.ts`:**

- `decidirResultadoRodadaCatalogo`: `pendente > 0` reagenda pelo backoff dentro do orçamento e
  finaliza na última tentativa; `pendente` e `nao_elegivel` compartilham o orçamento sem que um
  mascare o outro.
- Resumo com falha de leitura de elegibilidade **nunca** produz `finalizar`.
- `deveAlertarCatalogoNoMatch` com `pendente` residual na finalização; e alerta não avaliado em
  rodada intermediária.
- `decidirMotivoAlertaCatalogo` distinguindo `elegibilidade_nao_resolvida`.

**Tela:** renderização da lista com os quatro status de risco, e regressão do filtro
`ml_variation_id is not null` (uma família com variações não publicadas não pode aparecer).

**Extensão:** validada por dry-run contra um anúncio real, com o payload conferido antes do primeiro
envio.

---

## Faseamento

**Fase 1** — correção do worker (1.1–1.3), backfill, tela. Sem migration, sem dependências externas.

**Fase 2** — extensão. Depende da confirmação do `productId`.

Estimativa: Fase 1 meio dia; Fase 2 um dia.

---

## Consequências

- O operador passa a ser avisado **antes** de o ML pausar, dentro do PubliAI, não só por Telegram.
- As 93 famílias congeladas em `pendente` saem do limbo: parte vincula sozinha, o resto vira
  trabalho visível.
- A resolução em massa deixa de custar horas, sem armazenar credencial de sessão.
- Nenhuma migration: `catalog_status` continua com os sete valores atuais.
- Fica uma dependência de endpoint interno do ML na Parte 3: se o ML mudar o fluxo, a extensão
  quebra e o operador volta ao processo manual. A Parte 1 continua funcionando.
- Deploy: `vincular-catalogo` e as demais funções que importam `_shared/ml/catalogo.ts`. O campo
  `alertar` vive só no body do job e no worker — `_shared/queue.ts` não muda, e a frota QStash
  fica fora do deploy; job antigo sem o campo alerta normalmente.
