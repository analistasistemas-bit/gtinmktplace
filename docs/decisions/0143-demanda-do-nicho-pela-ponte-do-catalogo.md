# ADR-0143 — A ponte da amostra para o vendedor é o catálogo, e o faturamento do nicho sai do ar

**Status:** Aceito. Decisão de Diego em 2026-08-29 (opção "B parcial"), depois de os três caminhos serem medidos com token real.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0142](0142-vendas-mensais-por-vendedor.md) (o cálculo por vendedor — esta ADR troca a ponte, não a fórmula), [0141](0141-analise-publiai-joompulse-radar-e-sonar.md), [0127](0127-sonar-tabela-por-anuncio-e-historico.md) (nicho = os `item_id` da amostra — **restringido aqui**), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (o 403 do ML), [Spike 045](../spikes/045-cobertura-do-sonar-por-vendedor.md)
**Contrato regido:** [contrato-analise-publiai-secoes-2-3-7.md](../reference/contrato-analise-publiai-secoes-2-3-7.md)

---

## Contexto

A ADR-0142 acertou o cálculo e errou a ponte. Ela assumiu que a amostra do Sonar traria o vendedor
de cada anúncio; não traz. Medido em produção ([Spike 045](../spikes/045-cobertura-do-sonar-por-vendedor.md)):
o `seller_id` resolvia em **4 de 104 anúncios (3,8%)**, sobrava **1 vendedor** no acervo inteiro, e
esse vendedor renderizava **R$ 100,7 milhões/mês** de "faturamento do nicho".

Três caminhos foram testados com o token real da org DSA, em leitura pura:

| Caminho | Resultado |
|---|---|
| `/items?ids=` (multiget) | **403 `access_denied` em 103 de 104.** O envelope volta 200, cada item traz `code: 403` |
| `/items/{id}` individual | 403, como a ADR-0119 já registrava |
| `/products/{catalog_product_id}/items` | **26 de 26 catálogos em 200**, 190 vendedores distintos |
| `/users/{id}` de terceiro | `transactions.total` vem normalmente |

**Não existe rota que devolva `seller_id` de anúncio de terceiro a partir do `item_id`.** A única
ponte disponível é o catálogo.

## Decisões

### D-1 — A ponte amostra → vendedor é o `catalog_product_id`, não o `item_id`

Os campos de demanda por vendedor passam a se apoiar em `/products/{cat}/items`, que devolve
`item_id`, `seller_id` e `price` de todos os concorrentes do catálogo.

Isso reusa o parser que já existe (`_shared/pulse/parse.ts`) e o caminho que já roda em produção —
é dele que vêm os 495 vendedores de `pulse_vendedores`.

### D-2 — O conjunto passa a ser "os vendedores dos catálogos representados na amostra"

Restrição deliberada à ADR-0127, **apenas para os campos 3.2, 3.3 e 3.4**. O Top 5, a concentração
por anúncio (7.3) e todo o resto do Sonar continuam sobre `item_id` da amostra, sem alteração.

Medido, por consulta do acervo:

| Termo | Vendedores da amostra (elegíveis) | Vendedores do catálogo (elegíveis) |
|---|---|---|
| `aptamil premium 2` | 5 (**4**) | 126 (**102**) |
| `fórmula infantil … aptamil premium 2 800g` | 4 (**4**) | 124 (**102**) |
| `latas ninho nestle zero lactose 700gr` | 4 (**2**) | 47 (**11**) |
| `abraçadeira nylon` | 3 (**0**) | 20 (**0**) |
| `7891113175371` (EAN) | 6 (**0**) | 9 (**0**) |

Manter a ponte no `item_id` **nunca** atinge o piso de 5 vendedores. É o único desenho medido que
produz número.

**Consequência obrigatória no rótulo:** o campo diz "vendedores que disputam os catálogos desta
amostra", nunca "vendedores da amostra". São conjuntos diferentes e o operador precisa saber qual
está lendo.

### D-3 — 2.6, 2.8 e 3.1 saem do ar; 2.9 vira ausência

O faturamento do nicho **não é publicado**. Medido sob a ponte nova, com os 102 vendedores do
`aptamil premium 2`:

| | |
|---|---|
| 2.6 | **R$ 187.207.201/mês** |
| Maior contribuinte | `480265022` "Mercado Livre Brasil" — **94,5% sozinho** |
| Top 3 | **97,9%** |

O piso de 5 vendedores da Errata 2 do contrato **deixa de disparar** (102 ≥ 5). Ele era um proxy: o
defeito nunca foi o N pequeno, é a **soma de `vendas_mes` (loja inteira) × preço de um anúncio do
nicho**, repetida sobre 102 vendedores.

Esta é a pergunta que a ADR-0142 deixou explicitamente em aberto — *"a atribuição de quanto do
movimento de um vendedor vem do anúncio analisado"* — e ela não pode virar número enquanto não
tiver resposta. **Ausência declarada é melhor que precisão falsa.**

O código de faturamento sai junto: função morta em produção é dívida, e o histórico fica no git e
nesta ADR.

### D-4 — 3.2 é o que sobrevive, e vale a pena

Mediana sobre os 102 vendedores elegíveis do `aptamil premium 2`: **0 un./mês**.

| Distribuição dos 102 | |
|---|---|
| `vendas_mes = 0` | **54 (53%)** |
| p50 | **0** |
| p90 | 633 |
| máximo | 1.331.757 |

É exatamente o número que a D-6 da ADR-0142 foi escrita para produzir. A média seria ~24 mil e não
descreveria vendedor nenhum; a mediana diz a verdade útil ao operador: **mais da metade dos
concorrentes deste catálogo não teve movimento mensurável na janela.**

Zero medido não é ausência — é `valor`, pela D-3/D-4 da ADR-0142. A tela rotula "0 un./mês", não
"sem estimativa".

### D-5 — Nicho sem catálogo continua silencioso, e isso é correto

Duas das cinco consultas dão zero mesmo sob a ponte nova: `abraçadeira nylon` (5 catálogos para 33
anúncios) e o EAN. Nicho de anúncio tradicional não tem ponte para o vendedor.

Não inventar fallback. O estado de ausência já existe e diz a verdade.

### D-6 — Nenhuma migration, nenhuma coleta nova no v1

A edge resolve os catálogos por chamada, sob demanda. Não escreve em `pulse_vendedores` e não muda
o `pulse-coletar`.

**Limitação medida:** dos 190 vendedores dos catálogos da amostra, 122 já tinham série — porque os
catálogos de `aptamil` coincidem com catálogos que a DSA já monitora no Radar. **Para um nicho que
a organização não rastreia, a cobertura cai para perto de zero.** Estender o `pulse-coletar` aos
vendedores descobertos pelo Sonar (o caminho 2, `/users/{id}`, que já funciona) é trabalho futuro,
não parte desta decisão.

### D-7 — Custo por consulta é uma chamada por catálogo

Medido: 4 a 9 catálogos por consulta do Sonar, 26 no acervo inteiro. Mesmo teto de concorrência das
outras edges do Sonar, e o mesmo cache de dado público.

---

## Refutações registradas (não tentar de novo)

1. **Multiget `/items?ids=` para `seller_id` de terceiro.** 403 por item, medido em 103 de 104.
2. **Trocar só a fonte do `seller_id` mantendo a ponte no `item_id`.** Máximo de 4 elegíveis,
   abaixo do piso de 5 — não liga nada.
3. **Aumentar o piso de vendedores para conter o faturamento.** O piso não contém a soma; com 102
   vendedores ele passa e o número fica pior.

## Consequências

**Ganhamos** a demanda do nicho por vendedor onde há catálogo: de 1 vendedor para 102, com um
número (mediana) que resiste a outlier por construção.

**Perdemos** o campo de faturamento do nicho, que a seção 2 prometia — e que, medido, nunca teve
como ser honesto com os dados disponíveis.

**Fica em aberto:** a atribuição anúncio ↔ movimento do vendedor (herdada da ADR-0142) e a cobertura
para nichos que a organização não rastreia no Radar (D-6).

## Critérios de aceite

1. A ponte usa `catalog_product_id`; anúncio sem catálogo não entra e é contado na cobertura.
2. 2.6, 2.8 e 3.1 não existem no payload; 2.9 devolve ausência com motivo declarado.
3. 3.2 devolve mediana, e `vendas_mes = 0` é `valor`, nunca "sem estimativa".
4. O rótulo diz "vendedores que disputam os catálogos desta amostra".
5. 3.3 conta a amostra inteira de anúncios, como a Errata 2 já exige.
6. Sem conexão do ML → estado de ausência com 200, não erro (mesmo padrão da `pulse-sonar-visitas`).
7. `pnpm test`, `pnpm lint` e `npx tsc -b --force` verdes.
