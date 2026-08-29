# Spike 042 — O "zero silencioso" de comissão e frete: quantas vezes aconteceu

**Data:** 2026-08-28
**Pedido de:** Diego, antes de autorizar a implementação da opção A (proteger a DRE da Análise PubliAI)
**Origem:** [Spike 040](040-revisao-adversarial-adr-0141.md), furos financeiros confirmados no código
**Método:** todo o dado gravado em produção pelos caminhos que usam esses helpers, via Management API

## Resposta curta

**Nunca aconteceu.** Todos os zeros encontrados em produção são legítimos. O risco que o Spike 040
apontou no código é real, mas **ainda não custou dinheiro** — é seguro tratá-lo como prevenção, não
como incidente.

| Onde | Zeros | Veredito |
|---|---|---|
| Comissão % (`pulse_produtos.comissao_pct`, 229 linhas) | **0** | limpo |
| Frete (`pulse_produtos.ptw_custos->frete`, 229 linhas) | 94 | **todos legítimos** |
| Comissão de venda real (`ml_vendas_itens.sale_fee`, 2.376 itens) | 10 | **todos legítimos** |
| Comissão total da venda (`ml_vendas.sale_fee_total`, 2.376 vendas) | 10 | **todos legítimos** |

---

## 1. Comissão nunca zerou

As 229 linhas do Pulse têm comissão gravada — `nunca_consultada = 0`, ou seja, **toda consulta à
API do Mercado Livre respondeu**. Nenhuma linha com `comissao_pct = 0`.

`comissao_fixa = 0` aparece em 190 linhas, mas isso **é o comportamento correto**: o Mercado Livre
só cobra taxa fixa acima de uma faixa de preço, e esses produtos estão abaixo dela.

Esse é o teste decisivo, porque **comissão zero nunca é legítima** — o ML sempre cobra percentual.
Zero ocorrências.

## 2. Os 94 fretes zero são todos do caso legítimo

Frete zero é correto quando **o comprador paga** (preço abaixo do limite de frete grátis
obrigatório, R$ 79 no piso nacional). O cruzamento com o preço de referência:

| Situação | Linhas |
|---|---|
| Frete zero com preço **abaixo** de R$ 79 (legítimo) | **94** |
| Frete zero com preço **≥ R$ 79** (seria suspeito) | **0** |
| Frete zero sem preço de referência | **0** |
| Frete positivo | 135 |

E a faixa de preço dos 94 fecha a questão: **de R$ 12,50 a R$ 15,80, mediana R$ 12,55**. Todos
muito abaixo do limite. Não há um único caso em que o vendedor deveria pagar frete e o sistema
gravou zero.

## 3. As 10 vendas com comissão zero foram canceladas

Todas as 10 têm `status = 'cancelled'` e `paid_amount = 0` — venda cancelada não gera comissão.
Distribuídas entre 21/07 e 27/08, com `frete_vendedor` nulo (não zero), que é o contrato correto
do helper de faturamento.

O contraste fecha o argumento: **das 2.282 vendas pagas, nenhuma tem comissão zero.**

---

## O que isso muda

1. **A opção A continua valendo, mas como seguro, não como conserto.** Não há prejuízo a recuperar
   nem número errado circulando hoje.
2. **A urgência cai; a decisão não.** A DRE é o lugar onde um zero silencioso teria o maior
   estrago, porque decide compra de estoque. O guard entra junto com a DRE.
3. **Não faz sentido implementar o guard antes da DRE existir** — seria código sem chamador. A
   regra fica registrada como decisão vinculante (D-28 da ADR-0141) para não se perder no caminho.
4. **A razão de nunca ter acontecido é que a API do ML respondeu sempre**, não que o código esteja
   protegido. Uma indisponibilidade do ML produziria exatamente o cenário do Spike 040. O risco é
   latente, não inexistente.

## Ponto de atenção para a opção B

Se um dia a opção B (consertar no sistema inteiro) for feita, este spike é a linha de base: hoje
**zero ocorrências**. Qualquer aparecimento futuro de comissão zero em venda paga, ou de frete zero
com preço ≥ R$ 79, é regressão — e dá para alertar sobre isso **sem** mexer nos helpers.

## Como reproduzir

`sonda_zeros.py`, `sonda_zeros2.py` e `sonda_zeros3.py` em `$CLAUDE_JOB_DIR/tmp` (efêmeros).
Gotchas: `ml_vendas` **não tem** `data_venda` (é `date_created`) nem `valor_total` (é
`total_amount`); o preço de referência do Pulse é `comissao_preco`, não `meu_preco`.
