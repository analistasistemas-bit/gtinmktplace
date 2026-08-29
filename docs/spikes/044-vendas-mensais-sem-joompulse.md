# Spike 044 — De onde vem "vendas por mês" sem a JoomPulse

**Data:** 2026-08-29
**Pergunta:** com a JoomPulse fora, qual fonte sustenta o faturamento mensal do relatório?
**Resposta curta:** nem o delta do badge nem a idade do anúncio sobrevivem à medição. A via que
resta é a que o ADR-0119 já havia aprovado: **delta de `transactions.total` por vendedor**.

---

## Contexto

O [Spike 043](043-como-a-joompulse-estima-vendas.md) mostrou que a JoomPulse derivava vendas de
`GMV ÷ preço do buy-box`. Substituí-la exige uma fonte própria. Três candidatas foram medidas.

## Candidata A — delta do badge "+N vendidos" entre snapshots

**Refutada.** `sonar_snapshots` tem 120 linhas em 5 termos, e **um único termo acumulou dois
ciclos**: `abraçadeira nylon`, coletado em 19/08 e 27/08 (8 dias).

| item_id | vendidos 19/08 | vendidos 27/08 | delta |
|---|---|---|---|
| MLB1747208748 | 1.000 | 1.000 | **0** |
| MLB4445303151 | 10.000 | 10.000 | **0** |
| MLB4799699099 | 1.000 | 1.000 | **0** |
| MLB4821243229 | 500 | 500 | **0** |
| MLB4832490465 | 1.000 | 1.000 | **0** |
| MLB4954422575 | 100 | 100 | **0** |
| MLB6935205666 | 1.000 | 1.000 | **0** |

**Delta zero em 7 de 7.** A causa é o degrau: o ML publica o acumulado arredondado para baixo
(100, 500, 1.000, 10.000). Sair de um degrau exige atravessar toda a faixa até o próximo. Um
anúncio parado em "+1 mil" pode vender centenas de unidades sem que o número se mova.

Isso confirma com dado o risco R1 levantado na consultoria de estratégia. A cadência não é o
gargalo — coletar diariamente não muda nada, porque o problema é a **resolução da fonte**, não a
frequência da amostra.

## Candidata B — velocidade vitalícia (`acumulado ÷ idade do anúncio`)

**Bloqueada em dois pontos independentes.**

**B.1 — A idade não vem do scrape.** Run real do actor
`karamelo~mercadolivre-scraper-brasil-portugues` (20 itens, US$ 0,10) devolveu **40 campos**, dos
quais o parser usa 15. Nenhum é data de criação. O único campo temporal, `Tiempo`, é o timestamp
do próprio scrape — idêntico em todos os itens (`2026-08-29T10:00:05.196Z`).

A JoomPulse também não tem: `createdAt` não existe no schema de `MlbProductsSortedByProductId`.

**B.2 — O ID do MLB não é uma sequência única.** A hipótese era estimar a idade pelo número do
anúncio. Calibrando com `familias` (`ml_item_id` × `publicado_em`), **duas faixas disjuntas
aparecem no mesmo dia**:

| Data | IDs da faixa `MLB47…` | IDs da faixa `MLB69…` |
|---|---|---|
| 2026-06-11 | 4765574449, 4765574803, 4765582203, 4765613429 | 6942988974, 6943015034, 6943773174, 6946745486 |

Dentro de **cada** faixa a ordem cresce com a data (47529→47708→47892→48063 de 09/06 a 23/06;
69008→69143→69283→69530→70124 de 04/06 a 22/06), então a intuição de monotonicidade está certa —
mas existem **pelo menos duas sequências paralelas**, e uma curva única aplicada às duas erra por
ordens de grandeza. Separar as faixas exigiria saber o que as distingue, o que não foi medido.

**Ressalva adicional:** `publicado_em` em `familias` muda a cada republicação (o mesmo
`MLB6900892156` aparece em 04/06, 12/06 e 16/06), então nem essa calibração é data de criação.

## Candidata C — delta de `transactions.total` por vendedor

**Viável, e já aprovada.** A Errata de 2026-08-16 do [ADR-0119](../decisions/0119-pulse-inteligencia-de-mercado-dirigida.md)
já havia registrado o pivot: vendas de concorrente **por vendedor**, via
`/users/{seller_id}` → `seller_reputation.transactions.total`, com 20.500 transações provadas
num seller terceiro.

Três vantagens sobre A e B:

1. **O número é exato**, não arredondado em degraus — o delta se move todo dia.
2. **A infraestrutura já existe.** `pulse_ofertas` já grava `seller_id` e `dia`, e o
   `pulse-coletar` já roda diariamente. Falta uma coluna, não um sistema.
3. **A janela é conhecida** (`transactions` cobre 365 dias), então o rótulo é honesto.

Custo: o endpoint exige token (`/users/{id}` sem token devolve 403 `PolicyAgent`, medido hoje),
mas o token de org já existe.

**Limitação a registrar no contrato:** o número é do **vendedor**, não do **anúncio**. Um vendedor
com 40 anúncios tem suas transações somadas. O relatório pode dizer "o líder do nicho vende X/mês
no total da loja" — nunca "este anúncio vende X/mês". É uma pergunta diferente da que a JoomPulse
respondia, e a UI precisa dizer isso.

### C validada com dados de produção — e sem migration

A coleta **já existe e já rodou**. `pulse_vendedores` grava `seller_id`, `transactions_total` e
`dia` desde 16/08:

| Métrica | Valor |
|---|---|
| Linhas | 4.237 |
| Vendedores distintos | 495 |
| Dias de série | 14 (16/08 → 29/08) |
| `transactions_total` preenchido | **4.237 / 4.237 (100%)** |

Delta entre o primeiro e o último snapshot de cada vendedor (janela média de 9,9 dias):

| Resultado | Vendedores | % |
|---|---|---|
| **Cresceu** | 305 | **64%** |
| Parado | 109 | 23% |
| Negativo | 62 | 13% |

**64% de movimento, contra 0% do badge.** É a diferença entre um número exato e um degrau, medida
no mesmo intervalo de tempo.

Distribuição do delta (em ~10 dias): **mediana 7**, **p90 513**. Extrapolando para 30 dias, o
vendedor mediano do universo rastreado movimenta ~21 unidades/mês e o decil superior ~1.500/mês.
A média (3.553/mês) é puxada por outliers e **não deve ser usada** — a mediana é o número honesto.

### Os 13% negativos são a janela, não erro

`transactions.total` cobre **365 dias móveis**: quando uma venda de um ano atrás sai pela cauda, o
total cai sem que nada tenha acontecido no presente (pior caso medido: −4.875).

**Regra obrigatória:** delta negativo é `sem estimativa no período`, **nunca zero e nunca negativo
exibido** — mesmo tratamento que a regra global 3 do contrato dá à ausência. Sem essa trava, um
concorrente ativo apareceria como "vendeu −4.875", que é pior que não mostrar nada.

### Conclusão operacional

**Nenhuma migration é necessária.** A tabela, a coluna e o coletor diário já estão em produção. O
que falta é apenas o **cálculo do delta** e sua exibição rotulada — código de leitura, não de
schema.

## Consequência para o relatório

A seção 4 (Top 5 com vendas mensais por anúncio) **não é reproduzível** com as fontes disponíveis.
As opções são exibir o acumulado com rótulo honesto ("+1 mil vendidos desde a publicação"), ou
trocar a unidade de análise de anúncio para vendedor. Decisão do Diego.

## Estado das tabelas da JoomPulse

`joompulse_credenciais` e `joompulse_oauth_estados`: **0 linhas cada**. Drop seguro.
