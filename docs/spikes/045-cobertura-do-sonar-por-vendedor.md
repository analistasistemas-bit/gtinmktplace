# Spike 045 — Cobertura real do Sonar por vendedor

**Data:** 2026-08-29
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md) — mede se o caminho decidido (D-1, D-2) tem dado para funcionar
**Contrato:** [seções 2/3/7](../reference/contrato-analise-publiai-secoes-2-3-7.md) — campos 2.6, 2.8, 2.9, 3.1–3.4, 7.4
**Fecha a task:** "Medir a cobertura no universo real do Sonar (termo e EAN) e o `N` elegível por consulta"
**Método:** SQL read-only via Management API sobre produção (`txvncrgkoynoxwopfkbp`), todas as 5 consultas já persistidas em `sonar_snapshots`

## Resposta curta

**A implementação da ADR-0142 está correta contra o contrato e não tem dado para rodar.** O
`seller_id` da amostra do Sonar é resolvido em **3,5% dos anúncios** e sobra **1 vendedor distinto**
no acervo inteiro — e esse vendedor é a conta **"Mercado Livre Brasil"**, que renderiza um
faturamento de nicho de **R$ 100,7 milhões/mês** com cobertura exibida de **100%**.

| Estágio do funil | Valor | Onde se perde |
|---|---|---|
| A. Anúncios distintos na amostra (5 consultas) | **113** | — |
| B. Com `seller_id` resolvido | **4 (3,5%)** | `vendedorID` do Apify vem vazio; `pulse_ofertas_atual` é outro universo |
| C. Vendedores distintos | **1** | idem |
| D. Presentes em `pulse_vendedores` | **1 (100% de C)** | nenhuma perda — ver §2 |
| E. Com ≥ 2 snapshots | **1** (8 snapshots) | — |
| F. Delta ≥ 0 → `N elegível por consulta` | **1** | — |

**`N elegível por consulta` = 1.** O contrato exige 5 para 7.4; ela nunca renderiza.

---

## 1. O join do `seller_id` é 3,5%

`resolverSellerIdsPorItem()` resolve `item_id → seller_id` por `pulse_ofertas_atual`.

| Termo do Sonar | Itens | Com `seller_id` | Vendedores |
|---|---|---|---|
| `abraçadeira nylon` | 33 | **0** | 0 |
| `7891113175371` (EAN) | 20 | **0** | 0 |
| `aptamil premium 2` | 20 | 2 | 1 |
| `fórmula infantil danone aptamil premium 2 800g` | 20 | 2 | 1 |
| `latas ninho nestle zero lactose 700gr` | 20 | **0** | 0 |

**Três das cinco consultas — inclusive a única em modo EAN — resolvem zero vendedores.**

### Por que

`pulse_ofertas_atual` guarda as ofertas de concorrentes **nos catálogos que a organização já
monitora** (Radar). O Sonar busca **termo arbitrário** antes de cadastrar. São universos
disjuntos por construção: se o produto já estivesse no Radar, não haveria o que garimpar.

### O `vendedorID` do Apify não cobre o buraco

`parseSellerId(o.vendedorID)` é o caminho primário de `amostra-sonar.ts`. A run de 2026-08-29
(40 campos) mediu `vendedorID` **vazio** — já registrado em `docs/TASKS.md`. `sonar_snapshots`
confirma: a tabela persiste `vendedor` (nome da loja), não tem coluna de id, e o nome só vem
preenchido em **52 de 120 linhas (43%)**.

### Fallback por nome também não existe

`sonar_snapshots.vendedor` × `pulse_vendedores.nickname`, comparação case-insensitive:
**19 nomes distintos no Sonar, 0 casados.**

---

## 2. `pulse_vendedores` não pode cobrir mais que o Radar

```sql
select distinct seller_id from pulse_ofertas_atual
except
select distinct seller_id from pulse_vendedores;  -- 0 linhas
```

Os 495 vendedores de `pulse_vendedores` **são exatamente** os vendedores de
`pulse_ofertas_atual`. O estágio D nunca perde nada porque nunca ganha nada: a série de vendas
mensais só existe para quem o Radar já vigia.

**Consequência:** ampliar a janela de dias ou a cadência do `pulse-coletar` não move o funil. O
gargalo é o estágio B, não o E/F.

---

## 3. O único vendedor que passa é a conta do próprio marketplace

`seller_id = 480265022`, `nickname = "Mercado Livre Brasil"`.

| `dia` | `transactions_total` |
|---|---|
| 2026-08-20 | 31.347.465 |
| 2026-08-29 | 31.746.992 |

`vendas_mes = (31.746.992 − 31.347.465) ÷ 9 × 30 = **1.331.757 un./mês**`

Preço representativo na amostra (`aptamil premium 2`): **R$ 75,59**.

O que a tela renderiza hoje para esse nicho:

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
2. **Não há N mínimo em 2.6 nem em 3.2.** Uma mediana de um elemento é esse elemento.
3. **A cobertura mente.** 3.3 divide por `vendedores distintos na amostra` — mas
   `anunciosDaAmostra()` já **descartou** os 96% sem `seller_id`. O denominador conta só os
   sobreviventes, então a tela diz **100%** onde a cobertura real é **1 de 113 anúncios**.
   O contrato criou 3.3 exatamente para impedir isso: *"sem ele o operador lê 3.2 como se
   cobrisse o nicho inteiro"*. `meta.sem_seller_id` existe, mas é rodapé em texto pequeno,
   não entra na conta.

---

## 4. O que este spike NÃO refuta

- **O cálculo puro.** `estimarVendasMensais()` está correto: D-3, D-4 e D-5 conferem contra os
  dados reais, e o teste de integração passa contra produção.
- **A ADR-0142 D-1.** Vendas mensais por **vendedor** continuam sendo a única unidade
  reproduzível. O problema é ligar o vendedor ao anúncio da amostra do Sonar, não estimar suas
  vendas.
- **A emenda do contrato.** Os campos 2.6/3.1–3.4/7.4 estão especificados de forma testável e o
  código bate com a especificação.

O que falta é **uma fonte de `seller_id` para anúncios que o Radar não vigia** — pergunta que a
ADR-0142 não fez porque assumiu que a amostra já traria o vendedor.

---

## 5. Caminhos, com o custo medido

| # | Caminho | Cobertura esperada | Custo |
|---|---|---|---|
| 1 | `/items?ids=` da API do ML (até 20 por chamada) para os `item_id` da amostra | **alta** — `seller_id` é público no multiget | ~2 chamadas por consulta do Sonar; **não é dado de terceiro protegido** (o 403 da ADR-0119 é em `/items/{id}` individual, precisa remedir) |
| 2 | Coletar `transactions.total` sob demanda para vendedores novos (`/users/{id}`) | resolve E/F para quem o Radar não vigia | 1 chamada por vendedor + série começa do zero → `serie_insuficiente` até o 2º dia |
| 3 | Pedir o `vendedorID` ao actor do Apify | desconhecida | depende do fornecedor; medido vazio hoje |

Os caminhos 1 e 2 são complementares: **1 dá o `seller_id`, 2 dá a série.** Sem os dois, os campos
2.6/3.1/3.2 continuam vazios para qualquer nicho fora do Radar.

**Ressalva do caminho 1:** a Errata de 16/08 da ADR-0119 mediu 403 em `/items/{id}` de terceiro.
Se o multiget também devolver 403, o caminho 1 morre e a decisão volta a ser de Diego.

---

## Recomendação

1. **Não mergear a ADR-0142 na main como está.** Não porque o código esteja errado — está certo —
   mas porque em produção ele exibe R$ 100 milhões com selo de 100% de cobertura.
2. **Corrigir 3.3 antes de qualquer coisa** (defeito contra o contrato escrito, não decisão nova):
   o denominador tem que ser o total da amostra, incluindo os anúncios sem `seller_id`.
3. **Pôr N mínimo em 2.6 e 3.2**, coerente com o mínimo de 5 já usado em 7.3 e 7.4.
4. **Medir o multiget `/items?ids=`** — é a medição que destrava ou mata o caminho 1.
