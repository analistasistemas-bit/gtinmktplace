# ADR-0146 — A intensidade vira média mensal de 12 meses; o delta vira tendência

**Status:** Aceito. Decisão de Diego em 2026-08-29, depois de provado que `transactions.total` é janela móvel de 365 dias e que o delta media outra coisa.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0145](0145-vendedor-estabelecido-atividade-e-intensidade.md) (**emendada aqui** — a população fica, a conta muda), [0142](0142-vendas-mensais-por-vendedor.md) (a fórmula do delta — **muda de papel**), [Spike 048](../spikes/048-transactions-total-e-janela-provada.md)
**Contrato regido:** [contrato-analise-publiai-secoes-2-3-7.md](../reference/contrato-analise-publiai-secoes-2-3-7.md)

---

## Contexto

O [Spike 048](../spikes/048-transactions-total-e-janela-provada.md) provou, com verdade fundamental
sobre as nossas próprias contas, que `seller_reputation.transactions.total` é a contagem de pedidos
dos **últimos 365 dias**, não um acumulado vitalício:

| Conta | `transactions.total` | `/orders/search` 365d | Pedidos nossos **anteriores** à janela |
|---|---|---|---|
| `$ANALISTA$` (ativa desde 2002) | **498** | **498 — exato** | **11**, com `paid` em 2019 e out/2024 |

Um contador cumulativo marcaria ≥ 509.

**Consequência para a métrica vigente:** `vendas_mes = delta ÷ dias × 30` não mede venda. Mede
*venda de agora menos venda do mesmo período de um ano atrás*, e captura apenas **~48%** do ritmo
real do vendedor mediano. Um concorrente estável e saudável marca **zero**, e a atividade o conta
como parado.

E a correção estava no mesmo campo o tempo todo.

## Decisões

### D-1 — A intensidade (3.2) passa a ser `transactions_total ÷ 12`

Média mensal exata dos últimos 12 meses. Sem selo, sem idade, sem bucket, sem derivação.

`3.2 = mediana de (total_do_snapshot_mais_recente ÷ 12)` entre os vendedores estabelecidos.

Rótulo: **"média mensal dos últimos 12 meses — loja inteira do vendedor"**.

Medido:

| Nicho | 3.2 hoje (variação) | 3.2 nova (média 12m) |
|---|---|---|
| `aptamil premium 2` | 333 | **322** |
| EAN `7891113175371` | *suprimida* | **3.971** |
| `abraçadeira nylon` | ausência | ausência (nenhum vendedor na base) |

### D-2 — Um snapshot basta; `serie_insuficiente` deixa de bloquear a intensidade

O número está no snapshot mais recente. Não depende de série, de delta, nem de dois dias de coleta.

**Isto destrava o modo EAN sem depender do piso:** ele volta a renderizar (3.971/mês) porque o
vendedor com delta negativo — o `BAZAR HORIZONTE`, de 65 mil transações — passa a contar
normalmente. Perder um vendedor grande por uma oscilação de 0,24% era artefato do papel antigo do
delta.

### D-3 — O delta vira **tendência**, e delta negativo deixa de ser ausência

O delta sempre foi tendência; só estava rotulado errado. No papel novo, o sinal é informação:

| Delta | Estado | Leitura |
|---|---|---|
| `> 0` | crescendo | vende mais que há um ano |
| `= 0` | estável | mesmo ritmo de um ano atrás |
| `< 0` | **encolhendo** | vende menos que há um ano |

**A trava `sem_estimativa_no_periodo` da ADR-0142 D-3 é revogada para este uso.** Ela existia
porque um delta negativo, lido como venda, produziria "vendeu −4.875". Lido como tendência,
negativo é o dado — e sua causa agora é conhecida (a venda do ano passado saindo pela cauda da
janela, Spike 048 §2).

O campo 3.6 passa a ser: **"X de N vendedores estabelecidos vendendo mais que há um ano"**.

Medido no `aptamil premium 2` (116 vendedores com série): **48 crescendo, 54 estáveis, 14
encolhendo**. Os 54 estáveis são exatamente os que a métrica antiga contava como "não venderam".

### D-4 — O corte de 50 fica, e agora tem justificativa própria

A ADR-0145 D-1 justificou o corte pela **resolução** do instrumento. Essa justificativa cai: com
`total ÷ 12` não há problema de resolução — um vendedor de 30 transações tem média de 2,5/mês, um
número exato.

Mas o corte sobrevive por **composição**, que era o outro problema e é o dominante. Medido no
`aptamil premium 2`:

| População | Mediana de `total ÷ 12` |
|---|---|
| Todos os 116 do catálogo | **1 un./mês** |
| Os 50 estabelecidos | **322 un./mês** |

Sem o corte, a cauda de contas que nunca venderam ainda domina a mediana. **O corte de 50 continua
necessário, por um motivo diferente do que a ADR-0145 registrou.**

### D-5 — O piso de 5 fica para a intensidade, e continua sem valer para a tendência

Sem mudança em relação à ADR-0145 D-3: mediana com menos de 5 valores não é robusta; contagem não
precisa de piso. A degradação (1–4 mostra tendência, suprime mediana) permanece.

### D-6 — Nenhum rótulo promete janela do fornecedor sem prova

Agora **temos** a prova, então a janela pode ser nomeada:

- Intensidade: `média mensal dos últimos 12 meses — loja inteira do vendedor`
- Tendência: `vendendo mais que há um ano (comparado com os mesmos N dias de 12 meses atrás)`

O que continua proibido é afirmar janela **não verificada**. Esta foi verificada em duas contas com
histórico próprio.

---

## Errata 1 (2026-08-29, na própria implementação) — 3.4 redefinido

A D-2 tem uma consequência que o desenho não previu: se **um snapshot basta** para 3.2, e ser
estabelecido **exige** um snapshot, então "estabelecido sem estimativa" é inalcançável. O campo 3.4
passaria a exibir **sempre zero**.

Campo que só diz zero é ruído. 3.4 é redefinido para declarar **quem a régua excluiu**:

> `66 de 116 concorrentes ficaram de fora: menos de 50 vendas na vida`

É a informação honesta que faltava sobre o corte da D-4 — o operador passa a ver o tamanho da
exclusão, não só o resultado dela.

## O que esta decisão NÃO resolve

A atribuição anúncio ↔ vendedor continua aberta: o número é da **loja inteira**, não do produto do
nicho. Um vendedor com 40 anúncios em nichos diferentes entra com tudo somado. Herdado da ADR-0142
e declarado na tela.

## Consequências

**Ganhamos** um número que é venda de verdade, disponível no primeiro snapshot, e um segundo número
(tendência) que responde uma pergunta que a tela não fazia. O modo EAN volta a renderizar sem
depender de piso apertado.

**Perdemos** a simplicidade de ter uma métrica só — agora são duas com significados distintos, e o
operador precisa ler as duas.

**Fica registrado** que esta é a quarta iteração do rótulo desta métrica, e a primeira em que a
janela está **provada** em vez de suposta.

## Critérios de aceite

1. 3.2 usa o `transactions_total` do snapshot **mais recente** dividido por 12 — não o delta.
2. Vendedor com **um único snapshot** entra normalmente em 3.2.
3. Vendedor com delta negativo entra em 3.2 e aparece como **encolhendo** em 3.6 — nunca some.
4. `aptamil premium 2` com dados reais: 3.2 ≈ **322 un./mês** sobre 50 estabelecidos.
5. EAN `7891113175371`: 3.2 ≈ **3.971 un./mês** — deixa de ser suprimido.
6. Nenhum rótulo diz "movimento observado em N dias" para a intensidade.
7. 3.6 exibe os três estados e nunca chama vendedor estável de "não vendeu".
8. O corte de 50 permanece; sem ele o aptamil dá mediana 1 (teste de regressão).
9. Validado contra `pulse_vendedores` real, não só mock.
10. `pnpm test`, `pnpm lint` e `npx tsc -b --force` verdes.
