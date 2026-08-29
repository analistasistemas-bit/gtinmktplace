# Spike 043 — Como a JoomPulse estima "vendas por mês"

**Data:** 2026-08-29
**Pergunta:** a JoomPulse mede vendas por mês, ou deriva o número?
**Resposta:** deriva. `orderCount1m` é uma divisão, não uma contagem.

---

## Medição

Query no cubo `MlbProductsSortedByProductId` pedindo `orderCount1m`, `orderGmv1m` e
`buyBoxPriceAmount` juntos, ordenado por `orderCount1m` desc, 15 linhas.

| id | orderCount1m | orderGmv1m | buyBoxPriceAmount | GMV ÷ preço |
|---|---|---|---|---|
| MLB7023811650 | 113.636 | 3.613.624,80 | 31,80 | **113.636,0** |
| MLB4932102655 | 98.039 | 2.549.014,00 | 26,00 | **98.039,0** |
| MLB6965034912 | 97.403 | 6.982.821,07 | 71,69 | **97.403,0** |
| MLB6881709818 | 75.000 | 10.500.000,00 | 140,00 | **75.000,0** |
| MLB7143036282 | 60.000 | 11.994.000,00 | 199,90 | **60.000,0** |
| MLB6644886506 | 57.252 | 2.856.874,80 | 49,90 | **57.252,0** |

**Casamento exato em 15/15 linhas.** A identidade é:

```
orderCount1m = orderGmv1m ÷ buyBoxPriceAmount
```

## Segundo achado: os dois campos de venda são o mesmo número

Numa amostra de 100 produtos, `orderCount1m` e `catalogOrderCount1m` vieram **idênticos em
100/100 linhas**. Não são duas medidas independentes: a quantidade "do anúncio" é a quantidade
do catálogo, copiada.

## O que isso explica

1. **Os 89% de `orderCount1m = 0`** (Spike 039). Sem buy-box não há `buyBoxPriceAmount`; sem
   divisor não há divisão. O zero é ausência de preço de referência, não ausência de venda —
   o que a D-3 do ADR-0141 já tratava corretamente como ausência.
2. **A "discretização" suspeitada no Spike 041 §5.** Os valores repetidos (`1021` em dois
   catálogos distintos, `19` em outros dois) não são buckets: são divisões que caem no mesmo
   resultado. A suspeita §5 fica **resolvida — não é faixa, é quociente**.
3. **Por que os valores de topo são implausíveis.** 113.636 unidades/mês de um único produto a
   R$ 31,80 é R$ 3,6 milhões/mês. O número herda a escala do GMV, que é do catálogo/agregado.

## Consequência para a decisão de abortar

O dado que a JoomPulse vendia como "vendas do mês" é **derivado de um GMV estimado dividido pelo
preço atual do buy-box**. Duas fragilidades embutidas:

- **Anacronismo de preço.** Divide o faturamento de uma janela de 30 dias pelo preço de *hoje*.
  Qualquer promoção no período distorce a quantidade.
- **Não é observação.** Não há contagem de pedidos; há um GMV cuja própria origem não é
  auditável por nós.

A estimativa própria por **velocidade vitalícia** (`acumulado ÷ idade`) e por **delta de
snapshot** parte de um número que o ML publica na página (`+N vendidos`) — observação direta,
ainda que arredondada por piso. Trocar o método deles pelo nosso não é degradação de qualidade;
é troca de uma derivação opaca por uma derivação nossa, auditável e rotulada.

## Não medido

- A origem do `orderGmv1m` (amostragem? extrapolação? dado de parceiro?). Fora do nosso alcance.
- O cubo **não expõe data de criação do anúncio** (`createdAt` não existe no schema). A idade do
  anúncio, insumo da velocidade vitalícia, precisa vir de outra fonte.
