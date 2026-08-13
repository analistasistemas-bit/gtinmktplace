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

Disparo por script de manutenção reutilizando `enfileirarVinculacaoCatalogo`, respeitando a
serialização por usuário já existente.

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

## Incógnita conhecida

O formato exato do `productId` no payload do PATCH não está documentado no ADR-0036. Hipótese: é o
`user_product_id` que a elegibilidade já devolve por variação (ex.: `MLBU4312335854`).

Se a hipótese estiver correta, nada mais é necessário. Se não, resolve-se com uma captura de
requisição no DevTools durante uma execução manual — trabalho do operador, poucos minutos.

**As Partes 1 e 2 não dependem dessa incógnita.** Apenas a Parte 3 depende.

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
- Deploy: `vincular-catalogo` e as demais funções que importam `_shared/ml/catalogo.ts`.
