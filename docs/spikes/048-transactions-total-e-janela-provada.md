# Spike 048 — `transactions.total` é janela de 365 dias, provado — e o que isso faz com a nossa métrica

**Data:** 2026-08-29
**Pedido de Diego:** resolver a pergunta aberta do [Spike 047](047-joompulse-comparada-com-a-nossa-metrica.md) §4.
**ADR:** [0142](../decisions/0142-vendas-mensais-por-vendedor.md), [0145](../decisions/0145-vendedor-estabelecido-atividade-e-intensidade.md) — **obriga errata de semântica na D-4**
**Método:** verdade fundamental sobre as **nossas próprias contas**, onde o histórico real de pedidos está em `ml_vendas` e `/orders/search` é acessível

## Resposta curta

1. **É janela móvel de ~365 dias. Provado**, não inferido: a conta `$ANALISTA$`, ativa desde 2002,
   marca `transactions.total = 498` — exatamente a contagem de `/orders/search` dos últimos 365
   dias — enquanto o nosso banco guarda **11 pedidos anteriores à janela**, incluindo **pagos em
   2019 e em outubro/2024**, que **não estão** no contador.
2. **Os 63% de deltas positivos não contradizem nada:** a base cresce **+22% ao ano** (mediana).
3. **Consequência séria: o nosso delta não mede vendas.** Ele mede *vendas de agora menos vendas do
   mesmo período de um ano atrás*, e captura apenas **~48%** do ritmo real do vendedor mediano.
4. **A correção é de graça:** `total ÷ 12` é a média mensal exata dos últimos 12 meses, do mesmo
   campo que já coletamos.

---

## 1. A prova

| Conta | `transactions.total` | `/orders/search` 365d | `ml_vendas` dentro de 365d | `ml_vendas` **antes** da janela |
|---|---|---|---|---|
| `$ANALISTA$` (org DSA, conta de **2002**) | **498** | **498 — exato** | 500 | **11** |
| `AVILBV` (org Avil, de 2021) | 1.870 | 1.875 | 1.885 | 2 |

Os 11 pedidos fora da janela da DSA incluem **`paid` em 14/01/2019, 04/04/2019, 05/04/2019 e
18/10/2024**. Um contador cumulativo teria que somá-los: marcaria ≥ 509, não 498.

E a identidade fecha exata nas duas contas:

```
$ANALISTA$ : completed 485 + canceled 13 = 498  ✓
AVILBV     : completed 1805 + canceled 65 = 1870 ✓
```

**O campo é "pedidos (completados + cancelados) dentro da janela de 365 dias".** O
`{"period": "historic"}` da API do ML é rótulo ruim, não descrição.

## 2. Os 63% de deltas positivos, dissolvidos

Numa janela móvel, `delta = ritmo de agora − ritmo de um ano atrás`. Cruzando 436 vendedores com
`sales60Days` (janela de 60 dias, da própria API do ML, via `MlbSellersSnapshot`):

- **Crescimento YoY implícito mediano: +22%** (n=119). Base enviesada para nichos ativos do Radar —
  cresce, logo a maioria tem delta positivo. Os 63% são consequência, não anomalia.
- Faixa `>5k`: delta de **242** em 13 dias contra **707** esperados pelo ritmo médio anual. A
  diferença é o excedente sobre o ano passado, não ausência de venda.
- **Deltas negativos concentram em quem encolhe:** 58% deles têm `salesTrend < 0`, contra 47% entre
  os de delta positivo. E 28% dos passos diários dos vendedores `>5k` são negativos, com mediana
  **−20** num dia que vende ~40 — grande demais para cancelamento (taxa típica 2–5%). **É o dia do
  ano passado saindo pela cauda.**

**A D-5 (delta negativo → sem estimativa) estava certa, e a explicação original da ADR-0142 volta
oficialmente.** O que o Spike 046 refutou foi o *reset pontual*; a cauda da janela é outra coisa.

Contra-teste que falhou, registrado por honestidade: procurei assinatura de dia-da-semana nos
passos negativos (365 = 52 semanas + 1 dia) e **não há** — 27–32% uniforme de segunda a sábado.
Atribuível ao jitter do horário de coleta. A verdade fundamental do §1 prevalece.

## 3. O que isso quebra na nossa métrica

O rótulo em produção — `movimento observado em N dias, extrapolado para 30` — afirma que o delta é
**venda naqueles N dias**. Provada a janela, ele é **venda de agora menos venda de um ano atrás**.

Medido: `R = (delta/dias) ÷ (sales60/60)`, mediana **0,482** (n=173). **O nosso número captura
menos da metade do ritmo real do vendedor mediano.** E um vendedor estável e saudável marca
**zero** — a métrica de atividade o conta como parado.

Este é o terceiro rótulo desta métrica a cair, e o primeiro a cair por **fato provado** e não por
troca de hipótese. Os anteriores erravam sobre *a janela do fornecedor*; este erra sobre **o que a
nossa própria conta significa**.

## 4. A correção está disponível e é de graça

`total ÷ 12` é a **média mensal exata dos últimos 12 meses** — sem selo, sem idade, sem bucket, do
mesmo campo que já coletamos, disponível **no primeiro snapshot** (sem esperar série).

Desenho recomendado:

| Campo | Hoje | Proposto | Rótulo |
|---|---|---|---|
| **3.2 intensidade** | mediana do delta extrapolado | mediana de `total ÷ 12` | "média mensal dos últimos 12 meses — loja inteira" |
| **3.6 atividade** | "X de N venderam em D dias" | mesma conta do delta | "X de N vendendo **mais que há um ano**" |

O delta não é descartado: **vira métrica de tendência**, que é o que ele sempre foi. E a mediana
deixa de zerar para nicho estável — resolvendo a motivação original da ADR-0145 por um caminho mais
limpo que o corte de 50.

**Isto é troca de significado do número principal — decisão de Diego.** A errata de rótulo, essa,
é obrigatória de qualquer forma.

## 5. Reviews como numerador: refutado

Dois defeitos fatais, medidos:

1. **O pool de reviews é agregado no nível da família do produto.** Sete dos nove catálogos do
   `aptamil premium 2` devolvem **o mesmo `paging.total` de 3.361**, do selo 100 ao 100.000. O
   contador não discrimina catálogo, muito menos anúncio.
2. Onde o pool é próprio, a razão review/pedido — medida contra vendas **exatas** dos nossos itens —
   varia **0,03 a 0,22 (7x) dentro da mesma loja**. Pior que o erro do selo.

**Não tentar de novo.**

## 6. Erratas que este spike obriga

1. **ADR-0142 Errata 1 e ADR-0145 Causa 2:** promover de "se comporta como janela" para **provado**,
   com a verdade fundamental do §1. O "fica em aberto" dos 63% sai, fechado pelo +22% YoY.
2. **ADR-0145 D-4 e a tela:** errata de **semântica**. "Movimento observado em N dias" afirma o que
   o número não é.
3. **ADR-0145 D-5:** causa confirmada — saída pela cauda da janela.
4. **Spike 047:** a escala do selo tem degraus de **2x a 5x** (medido: 25, 50, 100, 500, 1k, 5k,
   10k, 50k, 100k), não "potências de 10 com erro até 2x".
5. **Idade do catálogo:** `date_created` já vem na resposta de `/products/{id}` que
   `_shared/ml/concorrencia.ts:109-110` **já chama** — custo zero. Vale como métrica complementar
   de "tamanho histórico do produto" (média vitalícia), **nunca** substituindo o par por vendedor.
