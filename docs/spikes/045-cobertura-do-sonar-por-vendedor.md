# Spike 045 — Cobertura real do Sonar por vendedor

**Data:** 2026-08-29
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md) — mede se o caminho decidido (D-1, D-2) tem dado para funcionar
**Contrato:** [seções 2/3/7](../reference/contrato-analise-publiai-secoes-2-3-7.md) — campos 2.6, 2.8, 2.9, 3.1–3.4, 7.4
**Fecha a task:** "Medir a cobertura no universo real do Sonar (termo e EAN) e o `N` elegível por consulta"
**Método:** SQL read-only via Management API sobre produção (`txvncrgkoynoxwopfkbp`), sobre as 5 consultas já persistidas em `sonar_snapshots` (120 linhas, **104** `item_id` distintos — 113 é a soma por termo, com sobreposição entre as duas consultas de aptamil)

## Resposta curta

**A implementação da ADR-0142 está correta contra o contrato e não tem dado para rodar.** No
acervo inteiro do Sonar sobra **1 vendedor distinto** com estimativa mensal — e ele é a conta
**"Mercado Livre Brasil"**, que renderiza um faturamento de nicho de **R$ 100,7 milhões/mês** com
cobertura exibida de **100%**.

| Estágio do funil | Valor | Onde se perde |
|---|---|---|
| A. Anúncios distintos na amostra (5 consultas) | **104** | — |
| B. Com `seller_id` resolvido pelo fallback | **4 (3,8%)** | `pulse_ofertas_atual` é o universo do Radar, disjunto do termo do Sonar |
| C. Vendedores distintos | **1** | idem |
| D. Presentes em `pulse_vendedores` | **1** | nenhuma perda aqui — e nunca haverá ganho, ver §2 |
| E. Com ≥ 2 snapshots | **1** (8 snapshots) | — |
| F. Delta ≥ 0 → `N elegível por consulta` | **1** | — |

**`N elegível por consulta` = 1.** O contrato exige 5 para 7.4; ela nunca renderiza.

### O que este spike não mediu

O caminho **primário** de `amostra-sonar.ts` é `item.seller_id`, vindo do campo `vendedorID` do
actor Apify — e ele **não foi re-medido aqui**. `sonar_snapshots` não tem coluna de `seller_id`,
então a tabela não confirma nem refuta. A evidência disponível é o registro do próprio projeto
sobre a run de 2026-08-29 (`docs/TASKS.md`: *"Medido vazio nesta amostra e portanto sem valor hoje:
`vendedorID`, `localizacao`, `disponivelEm`"*), que é uma amostra única de 20 itens.

**Para fechar:** chamar `pulse-sonar-vendas` para um termo e inspecionar `itens[].seller_id` — é o
caminho exato que alimenta a edge. Custo: ~US$ 0,10 de Apify.

**A conclusão deste spike não depende dessa medição.** Mesmo com `vendedorID` preenchido em 100%
dos itens, o estágio D continuaria vazio — §2 explica por quê.

---

## 1. O fallback do `seller_id` resolve 3,5%

`resolverSellerIdsPorItem()` resolve `item_id → seller_id` por `pulse_ofertas_atual`.

| Termo do Sonar | Itens | Com `seller_id` | Vendedores |
|---|---|---|---|
| `abraçadeira nylon` | 33 | **0** | 0 |
| `7891113175371` (EAN) | 20 | **0** | 0 |
| `aptamil premium 2` | 20 | 2 | 1 |
| `fórmula infantil danone aptamil premium 2 800g` | 20 | 2 | 1 |
| `latas ninho nestle zero lactose 700gr` | 20 | **0** | 0 |

**Três das cinco consultas — inclusive a única em modo EAN — resolvem zero vendedores.**

`pulse_ofertas_atual` guarda ofertas de concorrentes **nos catálogos que a organização já
monitora** (Radar). O Sonar busca **termo arbitrário** antes de cadastrar. São universos disjuntos
por construção: se o produto já estivesse no Radar, não haveria o que garimpar.

### Fallback por nome também não existe

`sonar_snapshots.vendedor` (nome da loja) só vem preenchido em **52 de 120 linhas (43%)**, com 19
nomes distintos. Cruzando com `pulse_vendedores.nickname`, case-insensitive: **0 casados.**

---

## 2. O gargalo é estrutural, não de cobertura

```sql
select distinct seller_id from pulse_ofertas_atual
except
select distinct seller_id from pulse_vendedores;  -- 0 linhas
```

Os 495 vendedores de `pulse_vendedores` **são exatamente** os vendedores de `pulse_ofertas_atual`.
Isso não é coincidência do dado: `pulse-coletar/processar.ts:482` percorre `sellerIdsColetados`,
que sai das ofertas dos catálogos monitorados, e só então grava `pulse_vendedores`.

**Consequência:** um vendedor que o Radar não vigia **não tem série nenhuma**, independentemente de
o `seller_id` dele ser conhecido. Resolver o estágio B sozinho não produz nem uma estimativa a
mais. Aumentar dias de série ou cadência do coletor também não move o funil.

---

## 3. Escopo por organização — o censo acima é o teto, não a média

`sonar_snapshots` **não tem `org_id`**: o acervo é comum às duas organizações. Já
`resolverSellerIdsPorItem()` e `carregarSeriePulseVendedores()` filtram `.eq('org_id', orgId)`.
Logo **a taxa real por organização é ≤ 3,5%**.

| Organização | Linhas em `pulse_vendedores` | Vendedores |
|---|---|---|
| DSA (`a1fcd536…`) | 2.897 | **373** |
| Avil (`a72ea303…`) | 1.340 | **122** |

O vendedor `480265022` está **só em DSA**. Para um operador da Avil, as cinco consultas do acervo
devolvem `sem_dado` em 2.6, 3.1 e 3.2 — nenhuma delas renderiza número.

### Precisão do critério de aceite 6 da ADR-0142

O teste de integração loga como `analistasistemas@icloud.com`, que pertence à org **DSA**. Sob RLS
ele leu **373 dos 495 vendedores (75%)**. Continua sendo validação contra dado real de produção,
como a ADR exige — mas não contra o universo inteiro, e a afirmação deve dizer isso.

---

## 4. O único vendedor que passa é a conta do próprio marketplace

`seller_id = 480265022`, `nickname = "Mercado Livre Brasil"`.

| `dia` | `transactions_total` |
|---|---|
| 2026-08-20 | 31.347.465 |
| 2026-08-29 | 31.746.992 |

`vendas_mes = (31.746.992 − 31.347.465) ÷ 9 × 30 = **1.331.757 un./mês**`

Preço representativo na amostra (`aptamil premium 2`): **R$ 75,59**.

O que a tela renderiza hoje para esse nicho, para um usuário da org DSA:

| Campo | Valor exibido |
|---|---|
| 2.6 Faturamento do nicho | **R$ 100.667.465/mês** |
| 2.8 Meta de entrada (10%) | **R$ 10.066.746/mês** |
| 2.9 Parecer | **"nicho comporta entrada"** (piso: R$ 30.000) |
| 3.2 Mediana vendas/mês | **1.331.757 un./mês** |
| 3.3 Cobertura | **"1 de 1 vendedores com estimativa" (100%)** |
| 7.4 Concentração | não medida (exige 5) |

Três defeitos empilhados num único número:

1. **`transactions.total` da conta institucional do ML** não é a demanda de um nicho de fórmula
   infantil — é a movimentação de uma loja que vende tudo. É o caso extremo da limitação já
   declarada na ADR-0142 ("loja inteira, não o anúncio").
2. **Não há N mínimo em 2.6 nem em 3.2.** Uma mediana de um elemento é esse elemento. O contrato
   já exige mínimo de 5 em 7.3 e 7.4 e não estendeu a regra a 2.6/3.2.
3. **A cobertura mente.** 3.3 divide por `vendedores distintos na amostra` — mas
   `anunciosDaAmostra()` já **descartou** os 96% sem `seller_id`. O denominador conta só os
   sobreviventes, então a tela diz **100%** onde a cobertura real é **1 de 104 anúncios**.
   O contrato criou 3.3 exatamente para impedir isso: *"sem ele o operador lê 3.2 como se cobrisse
   o nicho inteiro"*. `meta.sem_seller_id` existe, mas é rodapé em texto pequeno, fora da conta.

---

## 5. O que este spike NÃO refuta

- **O cálculo puro.** `estimarVendasMensais()` está correto: D-3, D-4 e D-5 conferem contra os
  dados reais e o teste de integração passa contra produção (org DSA).
- **A ADR-0142 D-1.** Vendas mensais por **vendedor** continuam sendo a única unidade
  reproduzível. O problema é ter série para o vendedor da amostra, não estimar suas vendas.
- **A emenda do contrato.** Os campos 2.6/3.1–3.4/7.4 estão especificados de forma testável e o
  código bate com a especificação — exceto o denominador de 3.3, que é defeito contra o texto.

O que falta é **cobrir vendedores que o Radar não vigia** — pergunta que a ADR-0142 não fez porque
assumiu que a amostra do Sonar já traria vendedor com série.

---

## 6. Caminhos, com o custo medido

Os dois primeiros **já existem em produção** e seriam reuso, não construção.

| # | Caminho | Resolve | Evidência de que funciona | Teto medido |
|---|---|---|---|---|
| 1 | `/products/{id}/items` → `seller_id` de terceiro | estágio B | `_shared/pulse/parse.ts:19` já faz isso; é a origem dos 495 vendedores. **O 403 da ADR-0119 é em `/items/{id}`, não neste caminho** | **29%** — só 35 de 120 itens do Sonar têm `catalog_product_id` |
| 2 | `/users/{id}` → `transactions.total` sob demanda | estágios D/E/F | `buscarPerfilVendedor()` em `pulse-coletar/processar.ts:487` já coleta isso de terceiros | série começa do zero → `serie_insuficiente` até o 2º dia |
| 3 | `/items?ids=` (multiget, até 20 por chamada) | estágio B, sem depender de catálogo | **não medido** — devolve 401 sem token; precisa de token do ML | desconhecido |
| 4 | Pedir `vendedorID` ao actor do Apify | estágio B | medido vazio na run de 2026-08-29 (amostra de 20) | desconhecido |

**1 e 2 são complementares: 1 dá o `seller_id`, 2 dá a série.** Nenhum dos dois sozinho produz um
número. E o caminho 1 cobre no máximo 29% da amostra — o caminho 3 é o que valeria para os 71%
restantes, e é a medição que falta.

---

## Recomendação

1. **Não mergear a ADR-0142 na main como está.** Não porque o código esteja errado — está certo —
   mas porque em produção ele exibe R$ 100 milhões com selo de 100% de cobertura.
2. **Corrigir 3.3 antes de qualquer coisa** (defeito contra o contrato escrito, não decisão nova):
   o denominador tem que ser o total da amostra, incluindo os anúncios sem `seller_id`.
3. **Pôr N mínimo em 2.6 e 3.2**, coerente com o mínimo de 5 já usado em 7.3 e 7.4.
4. **Medir o multiget `/items?ids=`** (caminho 3) — é a medição que decide se dá para cobrir os 71%
   de anúncios sem catálogo, ou se a Análise PubliAI por vendedor fica limitada ao nicho de
   catálogo.
5. **Fechar o caminho primário** chamando `pulse-sonar-vendas` uma vez e olhando `seller_id` — não
   muda a conclusão, mas define se o caminho 1 precisa existir ou se o Apify já entrega.


---

## 7. Medição 2 (2026-08-29, mesma data) — os três caminhos, testados com token real

Feita com o token do ML da org DSA (leitura pura: `GET`, nenhuma escrita, nenhum refresh — o
`refresh_token` é rotativo e rodá-lo fora do fluxo invalidaria a credencial, ADR-0012).

### Caminho 3 (multiget `/items?ids=`) — **refutado**

104 `item_id` do acervo, em 6 lotes de até 20:

| Código | Itens |
|---|---|
| `200` | **1** |
| `403 access_denied` | **103** |

O multiget devolve HTTP 200 no envelope e **403 por item**:

```
GET /items?ids=MLB1593587758
[{"code": 403, "body": {"id":"MLB1593587758","error":"access_denied","status":403}}]

GET /items/MLB1593587758   → 403 access_denied
```

**O 403 da ADR-0119 vale igual no multiget.** O único item que voltou 200 é da própria org.
Some da lista de caminhos: não existe rota que devolva `seller_id` de anúncio de terceiro por
`item_id`.

### Caminho 1 (`/products/{catalog_product_id}/items`) — **vivo, e é o único**

26 catálogos distintos no acervo do Sonar, **26 de 26 responderam `200`**, revelando **190
vendedores distintos**. Destes, **122 já estão em `pulse_vendedores` (DSA)** — já têm série
histórica, sem coletar nada novo.

### Caminho 2 (`/users/{id}`) — **confirmado para terceiros**

```
/users/1912121   → ACMENESES        transactions.total = 1029
/users/25326669  → RON_VIANA2010    transactions.total = 0
```

Terceiro devolve `transactions.total` normalmente. É o que `buscarPerfilVendedor()` já faz.

---

## 8. As duas formas de usar o caminho 1 — e só uma funciona

O `/products/{cat}/items` devolve `item_id` **e** `seller_id` de todos os concorrentes do catálogo.
Isso permite duas leituras, e a diferença entre elas decide a funcionalidade.

| Termo | Itens | Resolvidos | **A**: vend. da amostra | **A**: elegíveis | **B**: vend. do catálogo | **B**: elegíveis |
|---|---|---|---|---|---|---|
| `abraçadeira nylon` | 33 | 5 | 3 | **0** | 20 | **0** |
| `fórmula infantil danone aptamil premium 2 800g` | 20 | 7 | 4 | **4** | 124 | **102** |
| `latas ninho nestle zero lactose 700gr` | 20 | 4 | 4 | **2** | 47 | **11** |
| `aptamil premium 2` | 20 | 9 | 5 | **4** | 126 | **102** |
| `7891113175371` (EAN) | 20 | 7 | 6 | **0** | 9 | **0** |

*Elegível = vendedor com ≥ 2 snapshots em `pulse_vendedores` e delta ≥ 0 — o `N` que 2.6 e 3.2 exigem.*

**A — vendedores dos anúncios da amostra** (mantém a definição atual de nicho, "os `item_id` da
amostra", ADR-0127): resolve 4 a 9 anúncios por consulta, e o **máximo de elegíveis é 4**.
**Nenhuma das cinco consultas atinge o piso de 5.** Trocar a fonte do `seller_id` e parar aí não
liga a funcionalidade.

**B — vendedores dos catálogos representados na amostra**: **102, 102 e 11 elegíveis** em três das
cinco consultas. É a única forma medida que produz número.

O preço de B é uma mudança de definição: o conjunto passa a ser *"quem disputa os catálogos que
apareceram na amostra"*, e inclui vendedores que não estão na amostra do Sonar. É uma medida
**melhor** do nicho — não depende da página 1 da busca — mas **não é** a mesma coisa que o contrato
chama de nicho hoje, e o rótulo tem que dizer isso.

As duas consultas que dão zero em B são as de nicho sem catálogo: `abraçadeira nylon` (5 catálogos
para 33 anúncios) e o EAN (9 vendedores, nenhum com série). **B destrava o nicho de catálogo, não
o nicho inteiro** — e continua honestamente silencioso onde não há dado.

### O que muda na conclusão do §2

A afirmação *"resolver o estágio B sozinho não produz nem uma estimativa a mais"* estava certa pelo
motivo errado. O gargalo não é que `pulse_vendedores` seja pequena — ela já cobre **122 dos 190**
vendedores dos catálogos da amostra. O gargalo é a **ponte**: ligar amostra → vendedor por
`item_id` perde quase tudo; ligar por **catálogo** recupera.

---

## 9. O que B renderiza de verdade — e por que 2.6 não sobrevive a nenhum dos caminhos

Simulação com os 102 vendedores elegíveis do termo `aptamil premium 2` (9 catálogos, 126
vendedores com preço), aplicando as fórmulas do contrato tal como estão:

| Campo | Valor sob B |
|---|---|
| 2.6 Faturamento do nicho | **R$ 187.207.201/mês** |
| 2.8 Meta de entrada (10%) | R$ 18.720.720/mês |
| 2.9 Parecer | "nicho comporta entrada" |
| 3.2 Mediana vendas/mês | **0 un./mês** |

**94,5% do 2.6 vem de um único vendedor** — `480265022`, "Mercado Livre Brasil", 1.331.757 un./mês
× R$ 132,90. Os três maiores concentram **97,9%**.

O piso de 5 vendedores, que hoje é a única coisa suprimindo esse número, **deixa de disparar sob B**
(102 ≥ 5). O piso era um proxy: o defeito nunca foi o N pequeno, é a **soma**. Multiplicar a
movimentação da loja inteira de um vendedor pelo preço de um anúncio do nicho e somar sobre 102
vendedores é a pergunta em aberto da ADR-0142 ("quanto do movimento de um vendedor vem do anúncio
analisado") virando número na tela.

**Nenhum dos dois caminhos salva 2.6.** A resolve pouco (máx. 4 elegíveis, abaixo do piso); B
resolve muito e amplifica o defeito por 102.

### O que B entrega de fato: 3.2, 3.3 e 3.4

Distribuição dos 102 elegíveis:

| | |
|---|---|
| `vendas_mes = 0` | **54 (53%)** |
| p50 | **0** |
| p90 | 633 |
| máximo | 1.331.757 |
| com ≥ 5 un./mês | 46 |

A mediana de **0 un./mês** é exatamente o que a D-6 da ADR-0142 foi escrita para produzir: o
vendedor típico do catálogo **não teve movimento mensurável na janela**, e a média (que seria
~24 mil) não descreveria vendedor nenhum. É um número honesto e acionável — diz ao operador que
metade dos concorrentes do catálogo está parada.

## Recomendação revista

1. **Não implementar B inteiro.** Ligar 2.6 sob B troca "R$ 100,7 mi com 1 vendedor" por
   "R$ 187,2 mi com 102" — pior, e sem o piso para segurar.
2. **B parcial é a única entrega defensável hoje:** usar `/products/{cat}/items` como ponte para o
   vendedor e ligar **apenas 3.2, 3.3 e 3.4**, mantendo 2.6/2.8/2.9 suprimidos até existir uma
   construção de faturamento que não multiplique a loja inteira pelo preço de um anúncio.
3. **Isto é decisão de Diego**, não de implementação: muda a definição de nicho de "os `item_id` da
   amostra" (ADR-0127) para "os vendedores dos catálogos representados na amostra", e desiste —
   por ora — do campo de faturamento que a seção 2 promete.

**Ressalva sobre os 122 de 190:** os catálogos de `aptamil` coincidem com catálogos que a DSA já
monitora no Radar. Para um nicho que a organização **não** rastreia, o estágio D cairia para perto
de zero até o `pulse-coletar` passar a coletar os vendedores descobertos pelo Sonar (caminho 2).
Não ler 122/190 como taxa de cobertura geral.
