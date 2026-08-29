# Spike 045 — Cobertura real do Sonar por vendedor

**Data:** 2026-08-29
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md) — mede se o caminho decidido (D-1, D-2) tem dado para funcionar
**Contrato:** [seções 2/3/7](../reference/contrato-analise-publiai-secoes-2-3-7.md) — campos 2.6, 2.8, 2.9, 3.1–3.4, 7.4
**Fecha a task:** "Medir a cobertura no universo real do Sonar (termo e EAN) e o `N` elegível por consulta"
**Método:** SQL read-only via Management API sobre produção (`txvncrgkoynoxwopfkbp`), sobre as 5 consultas já persistidas em `sonar_snapshots` (120 linhas, 113 `item_id` distintos)

## Resposta curta

**A implementação da ADR-0142 está correta contra o contrato e não tem dado para rodar.** No
acervo inteiro do Sonar sobra **1 vendedor distinto** com estimativa mensal — e ele é a conta
**"Mercado Livre Brasil"**, que renderiza um faturamento de nicho de **R$ 100,7 milhões/mês** com
cobertura exibida de **100%**.

| Estágio do funil | Valor | Onde se perde |
|---|---|---|
| A. Anúncios distintos na amostra (5 consultas) | **113** | — |
| B. Com `seller_id` resolvido pelo fallback | **4 (3,5%)** | `pulse_ofertas_atual` é o universo do Radar, disjunto do termo do Sonar |
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
   sobreviventes, então a tela diz **100%** onde a cobertura real é **1 de 113 anúncios**.
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
