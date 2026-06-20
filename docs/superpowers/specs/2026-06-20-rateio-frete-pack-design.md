# Rateio de frete em pedido pack (multi-produto) — Design

**Data:** 2026-06-20
**Branch:** `worktree-rateio-frete-pack`
**Status:** aprovado para planejamento

## Problema

No "Detalhe do líquido" (Financeiro), produtos vendidos num **pack** (carrinho com 2+
produtos, mesmo envio) geram markups irreais: o frete do envio compartilhado é descontado
do líquido de **um** pagamento só, afundando o markup desse item e inflando o dos demais.

Caso real (cliente Luciana Ferreira, pack `2000013527283757`, envio `47303700925`):

| Produto | cód. | peso | preço | tarifa ML | custo | markup hoje |
|---|---|---|---|---|---|---|
| Linha 150 15000mt | 02543842 | 338g | 45,10 | 7,44 | 21,16 | **−32%** ❌ |
| Fita Cetim N.9 10mt | — | 58g | 12,70 | 2,16 | 1,95 | inflado ❌ |

## Causa raiz (modelo de dados real, confirmado via API ML)

Um **pack** no ML = **vários pedidos** sob o mesmo `pack_id`, **compartilhando um único
`shipping.id`** (um frete). Cada pedido tem **seu próprio pagamento MP** (1:1 pedido↔pagamento;
`transaction_amount` = total da linha daquele item).

O frete do envio compartilhado (R$13,20 no caso) é deduzido do `net_received_amount` de
**apenas um** dos pagamentos do pack. Como o financeiro mostra 1 linha por pagamento com o
líquido cru do MP, o item que "levou" o frete aparece com markup afundado e os outros com
markup inflado (frete zero).

`sale_fee` por `order_item` vem populado no `/orders/search` e **bate exatamente** com a
tarifa de venda itemizada do MP (Linha 4,97+1,30+1,17 = 7,44; Fita 1,46+0,37+0,33 = 2,16).

## Objetivo

Redistribuir o frete do envio compartilhado **por peso** entre as linhas do pack, corrigindo
o markup por produto. Pedido de envio único (sem pack): **zero mudança**.

## Princípio de consistência

A redistribuição é **zero-soma**: a soma dos líquidos do grupo (e portanto os totais do
período — bruto/líquido, ADR-0031) **não muda**. Só muda como o frete já existente é
atribuído entre as linhas do mesmo envio. Nenhuma API extra de frete é necessária.

### Fórmula (por grupo = pagamentos que compartilham `shipping_id`)

```
retido_grupo = Σ (bruto_i − liquido_i)         (do MP, exato — frete + tarifas do grupo)
frete_grupo  = retido_grupo − Σ tarifa_i        (resíduo ⇒ o frete do envio)
peso_grupo   = Σ peso_i
frete_i'     = frete_grupo × (peso_i / peso_grupo)     (rateio por peso)
liquido_i'   = bruto_i − tarifa_i − frete_i'
retido_i'    = bruto_i − liquido_i'
```

Por construção: `Σ liquido_i' ≡ Σ liquido_i` (grupo) ⇒ totais do período intactos.
Resíduo de arredondamento (centavos) ajustado na linha de maior peso.

### Validação com o caso real

peso_grupo = 338 + 58 = 396g. frete_grupo = (57,80 − 35,00) − 9,60 = 13,20.

| Produto | peso | preço | tarifa | frete' (peso) | **líquido'** | custo | **markup'** |
|---|---|---|---|---|---|---|---|
| Linha (338g, 85,4%) | 338 | 45,10 | 7,44 | **11,27** | **26,39** | 21,16 | **+25%** ✅ |
| Fita (58g, 14,6%) | 58 | 12,70 | 2,16 | **1,93** | **8,61** | 1,95 | **+341%** ✅ |

Σ líquido' = 26,39 + 8,61 = **35,00** (inalterado). ✔

## Fontes de dados

- **MP** (`/v1/payments/search`): bruto e líquido por pagamento — inalterado.
- **ML** (`/orders/search`): por pedido → `order_items[].sale_fee` (tarifa), `shipping.id`
  (chave do grupo), `pack_id`. (Hoje só lê item/variação/quantidade.)
- **DB** (`variacoes`): `peso_gramas` (100% coberto, >0), além de `custo`/`codigo` já lidos.

## Mudanças de código

1. **`supabase/functions/_shared/ml/pedidos.ts`**
   - `PedidoComPagamentos`: expor `order_items[].sale_fee` e `shipping.id`.
   - `mapearPagamentoParaItem` → `ItemDoPagamento` ganha `tarifaItem` e `shippingId`.
     Mantém o skip de pedido multi-item (`ids.size !== 1`): packs reais são vários pedidos
     de 1 item cada, que já passam.

2. **Novo módulo puro** `_shared/mercadopago/rateio.ts`
   - `ratearFreteCompartilhado(vendas, infoPorPagamento): VendaFinanceira[]`.
   - Agrupa `vendas` por `shippingId`; grupos com >1 membro recebem a fórmula acima;
     grupos de 1 membro ficam intactos.
   - Defensivo: membro sem `tarifa`/`peso`/`shippingId` → grupo não rateado (mantém cru).
   - `peso_grupo = 0` → ratear por valor (bruto).
   - `frete_grupo < 0` (caso raro) → não rateia (mantém cru).

3. **`supabase/functions/_shared/mercadopago/financeiro.ts`**
   - `InfoCusto`/`infoPorPagamento` passam a carregar `peso`, `tarifa`, `shippingId`.
   - `agregarFinanceiro`: ao final, aplica `ratearFreteCompartilhado` sobre `vendas` antes
     de ordenar/retornar. KPIs de topo já somados do MP — inalterados (e o rateio é zero-soma).

4. **`supabase/functions/resumo-financeiro/index.ts`**
   - Incluir `peso_gramas` no `select` de `variacoes`.
   - `infoPorPagamentoDoPeriodo`/`montarInfoPorPagamento` passam a anexar `peso`, `tarifa`
     (sale_fee) e `shippingId` por pagamento.

5. **`src/pages/DetalheFinanceiro.tsx`**
   - Sem mudança estrutural (1 linha por pagamento já é o certo; `id` segue único).
   - Ajustar a nota de rodapé: em pedido com vários produtos, o frete é rateado por peso.

## Testes (Deno, módulo puro)

- **Pack 2 itens** (números reais): Linha +25%, Fita +341%, Σ líquido do grupo = 35,00.
- **Envio único** (grupo de 1): saída idêntica à atual (regressão).
- **peso_grupo = 0**: fallback por valor; Σ preservada.
- **Item sem custo** no grupo: rateia frete/líquido; markup "—" só nesse item.
- **Arredondamento**: Σ liquido_i' == Σ liquido_i em centavos.
- **frete_grupo < 0**: grupo mantido cru (sem rateio).

## Fora de escopo

- Pedido de envio único (não muda).
- Projeção "A receber / lançamentos futuros" (ADR-0031, não reproduzível pela API).
- KPIs de topo do período (inalterados; rateio é zero-soma).
