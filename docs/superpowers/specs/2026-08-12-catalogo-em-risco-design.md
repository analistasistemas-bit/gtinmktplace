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

Os três anúncios sinalizados pelo ML como próximos a pausar:

| Anúncio | vinculado | ficha_divergente | nao_elegivel | sem_produto | pendente |
|---|---|---|---|---|---|
| MLB7066697288 — Fio de Malha Extra Premium | 0 | 37 | 50 | 13 | 13 |
| MLB4888109497 — Fio Ecoamigurumi Euroroma | 8 | 4 | 12 | 0 | 19 |
| MLB7159179348 — Linha Liza Grossa 500m | 1 | 3 | 4 | 0 | 69 |

Panorama global (famílias com `ml_item_id`):

| catalog_status | famílias | variações |
|---|---|---|
| pendente | 166 | 2.523 |
| nao_elegivel | 123 | 1.067 |
| family_diff | 21 | 702 |
| vinculado | 38 | 552 |
| sem_produto | 40 | 329 |
| ficha_divergente | 17 | 145 |
| erro | 5 | 22 |

## Causa raiz da cegueira

Duas falhas encadeadas fazem o alerta do ADR-0036 nunca disparar nesses casos.

**1. Ausência tratada como "ainda computando".**
`decidirAcaoCatalogo` (`_shared/ml/catalogo.ts:104`) faz:

```ts
if (!elig || !elig.status) return 'pendente'; // sem entrada/sem status = ainda computando
```

Verificado ao vivo contra a API do ML com o token da AVILBV:
`GET /items/MLB7159179348/catalog_listing_eligibility` devolve **4 variações** (3 `READY_FOR_OPTIN`,
1 `ALREADY_OPTED_IN`) para uma família que tem **77 variações** no banco. As 73 ausentes do payload
não estão "computando" — o ML simplesmente não as lista, e nunca vai listar. Elas ficam `pendente`
para sempre.

**2. O alerta exige estado final que nunca chega.**
`deveAlertarCatalogoNoMatch` só retorna `true` com `pendente === 0`, e
`decidirResultadoRodadaCatalogo` devolve `aguardar_elegibilidade` enquanto houver pendente — o
worker responde 500, o QStash retenta, esgota os retries e desiste. Nenhum alerta é enviado.

Resultado: as 2.523 variações `pendente` são majoritariamente **estado congelado**, não trabalho em
andamento.

## Por que não dá para automatizar pela API OAuth

A ação "Não encontro minha variação" é
`PATCH https://www.mercadolivre.com.br/produzir/catalogo/api/optin-up/<ITEM>/multivariation_matcher_confirm`
— endpoint interno do site, não da API pública. O mecanismo do "no match" é enviar
`catalog_product_id: null` para a variação.

Reverificado em 2026-08-12 (não é informação herdada de junho): o PATCH com
`Authorization: Bearer <token OAuth válido>` contra um item **inexistente** (`MLB0000000000`,
nenhum anúncio real tocado) responde:

```
403 {"status":403,"message":"invalid csrf token","code":"EBADCSRFTOKEN","name":"ForbiddenError"}
```

Barra no CSRF antes de avaliar o Bearer. Não é questão de escopo OAuth — é outra camada de
autenticação, do site. A conexão do canal (`marketplace_connections`) não serve.

`POST /items/catalog_listings` (o único opt-in documentado) exige `catalog_product_id` não-nulo,
então não cobre o no-match. Confirmado em ADR-0036.

## Alternativa descartada: cookie de sessão no Vault

Guardar o cookie de sessão web do ML no Vault deixaria o worker resolver sozinho, sem o operador.
**Descartado:** um cookie de sessão web dá acesso **total à conta no site** (alterar preço, excluir
anúncio, dados financeiros), sem os limites de escopo do OAuth — troca um incômodo de cliques por
risco de conta inteira. E expira, então a renovação manual voltaria de qualquer forma.

## Decisão

Duas metades independentes.

**Metade 1 — detecção (server-side, só OAuth):** o PubliAI passa a enxergar e alertar corretamente.
Não depende de sessão web, entrega valor sozinha.

**Metade 2 — ação em massa (extensão de navegador):** a declaração no ML é acionada pelo operador,
executada na sessão dele, sem credencial armazenada em lugar nenhum.

---

## Parte 1 — Backend enxerga

### 1.1 Novo status `sem_elegibilidade`

Migration adicionando o valor ao CHECK de `variacoes.catalog_status`, hoje:

```
catalog_status = ANY (ARRAY['pendente','vinculado','sem_produto','family_diff','nao_elegivel','erro','ficha_divergente'])
```

Semântica: **o ML não devolve elegibilidade para esta variação e não vai devolver.** É distinto de
`nao_elegivel` (o ML devolveu uma recusa explícita) e de `sem_produto` (elegível, mas sem ficha por
GTIN). A distinção existe para diagnóstico na tela — o tratamento downstream é o mesmo dos demais
no-match.

`anuncios_externos_itens.catalog_status` (caminho User Products, ADR-0088) carrega hoje o CHECK
**idêntico** — verificado no schema. A migration altera as duas tabelas, mantendo os caminhos
Legacy e UP simétricos.

### 1.2 `pendente` passa a consumir o backoff

`decidirResultadoRodadaCatalogo` hoje:

```ts
if (resumo.pendente > 0) return { acao: 'aguardar_elegibilidade' };
```

Passa a tratar `pendente` como `nao_elegivel` para efeito de retry: reagenda pelo backoff existente
(`CATALOGO_BACKOFF_SEGUNDOS` = 1h/6h/24h/48h, `CATALOGO_MAX_TENTATIVAS` = 5) e, **na última
tentativa**, finaliza em vez de esperar indefinidamente.

`aguardar_elegibilidade` deixa de existir como estado terminal silencioso. O 500-para-retry
continua válido apenas dentro do orçamento de tentativas.

### 1.3 Promoção na finalização

Ao finalizar (última tentativa), o orquestrador promove o que sobrou:

```sql
update variacoes set catalog_status = 'sem_elegibilidade'
where familia_id = $1 and catalog_status = 'pendente'
```

Um UPDATE por família, na finalização. Idempotente.

### 1.4 Alerta

`deveAlertarCatalogoNoMatch` deixa de exigir `pendente === 0` (a exigência some junto com o estado
de espera infinita) e passa a contar `sem_elegibilidade` entre os motivos.
`decidirMotivoAlertaCatalogo` ganha o motivo `sem_elegibilidade` para diferenciar a mensagem.

### 1.5 Backfill das famílias travadas

Re-enfileirar `vincular-catalogo` para as famílias com variação `pendente`, já com
`tentativa = CATALOGO_MAX_TENTATIVAS`, de modo que finalizem na primeira rodada.

Importante: a rodada **executa o opt-in normal antes de decidir** — famílias cuja elegibilidade
amadureceu desde a última tentativa vinculam sozinhas no caminho (a Linha Liza tem 3 variações
`READY_FOR_OPTIN` hoje).

Disparo por script de manutenção reutilizando `enfileirarVinculacaoCatalogo`, respeitando a
serialização por usuário já existente.

---

## Parte 2 — Tela "Catálogo em risco"

Card em **Publicados**, mesmo padrão visual do banner de moderados já existente.

**Fonte:** famílias com `ml_item_id` não nulo que tenham ao menos uma variação em
`ficha_divergente`, `sem_produto`, `nao_elegivel` ou `sem_elegibilidade`.

**Por anúncio:** título, quantidade de variações sem ficha, motivo predominante, link direto para
`mercadolivre.com.br/produzir/catalogo/<item>` (o mesmo link que o alerta de Telegram já monta).

**Ação:** botão "Resolver todos no ML", que entrega a lista à extensão.

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

A trava `fichaEquivalente` (ADR-0021 pós-incidente do kit) permanece intacta. Ela é responsável
pelas 145 variações em `ficha_divergente`, majoritariamente com motivo
`dominio_MLB-YARNS_vs_MLB-SEWING_AND_CRAFT_THREADS` — o ML oferecendo ficha de linha de costura
para fio de crochê. Recusar está correto; foi essa trava que evitou o incidente de vincular unidade
avulsa a ficha de kit de 10 cones.

A parte "tentar achar a variação automaticamente" do pedido original **já existe** e é essa trava
mais o opt-in por GTIN. Não é reescrita aqui.

---

## Incógnita conhecida

O formato exato do `productId` no payload do PATCH não está documentado no ADR-0036. Hipótese: é o
`user_product_id` que a elegibilidade já devolve por variação (ex.: `MLBU4312335854`).

Se a hipótese estiver correta, nada mais é necessário. Se não, resolve-se com uma captura de
requisição no DevTools durante uma execução manual — trabalho do operador, poucos minutos.

**A Parte 1 e a Parte 2 não dependem dessa incógnita.** Apenas a Parte 3 depende.

---

## Testes

**Funções puras (vitest), no padrão dos testes já existentes de `catalogo.ts`:**

- `decidirResultadoRodadaCatalogo`: `pendente > 0` reagenda dentro do orçamento e finaliza na última
  tentativa; pendências não mascaram mais o backoff de `nao_elegivel`.
- Promoção de `pendente` a `sem_elegibilidade` apenas na finalização.
- `deveAlertarCatalogoNoMatch` com `sem_elegibilidade` presente e com `pendente` residual.
- `decidirMotivoAlertaCatalogo` distinguindo `sem_elegibilidade` dos motivos existentes.

**Tela:** teste de renderização da lista com os quatro status de risco.

**Extensão:** validada por dry-run contra um anúncio real, com o payload conferido antes do primeiro
envio.

---

## Faseamento

**Fase 1** — migration, correção do worker, backfill, tela. Sem dependências externas.

**Fase 2** — extensão. Depende da confirmação do `productId`.

Estimativa: Fase 1 meio dia; Fase 2 um dia.

---

## Consequências

- O operador passa a ser avisado **antes** de o ML pausar, dentro do PubliAI, não só por Telegram.
- As 166 famílias congeladas saem do limbo: parte vincula sozinha, o resto vira trabalho visível.
- A resolução em massa deixa de custar horas, sem armazenar credencial de sessão.
- Fica uma dependência de endpoint interno do ML na Parte 3: se o ML mudar o fluxo, a extensão
  quebra e o operador volta ao processo manual. A Parte 1 continua funcionando.
- Deploy: `vincular-catalogo` e as demais funções que importam `_shared/ml/catalogo.ts`.
