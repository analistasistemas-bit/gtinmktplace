# ADR-0112 — Alíquota interna por UF da empresa (venda dentro do estado)

**Data:** 2026-08-11
**Status:** aceito
**Refina:** [ADR-0055](0055-imposto-por-origem-nacional-importado.md)

## Contexto

A ADR-0055 definiu duas alíquotas globais por org — `nacional` (8%) e `importado` (16%) —
escolhidas pela `familias.origem` do produto. É a única dimensão do imposto hoje.

A AVIL é de Pernambuco e paga **1%** quando vende para cliente do próprio estado,
independentemente de o produto ser nacional ou importado. Com a regra atual, toda venda
intraestadual aparece com imposto 8×/16× maior que o real, derrubando líquido, lucro e markup
nas telas de apuração.

O dado necessário já existe: `ml_vendas.uf` guarda a UF de entrega do pedido
(`extrairGeo`, `supabase/functions/_shared/faturamento/venda.ts`), gravada desde a migration
`20260623202009_ml_vendas_geografia.sql`.

## Decisão

1. **Novo parâmetro org-scoped em `configuracoes`**, ao lado das alíquotas por origem:

   | Coluna | Tipo | Semântica |
   |---|---|---|
   | `uf_empresa` | `text null` | UF de origem da empresa (ex.: `PE`) |
   | `aliquota_interna_pct` | `numeric null` | alíquota para vendas dentro dessa UF |

   Ambas nullable, **sem default**. Null = parâmetro não configurado = regra da ADR-0055
   inalterada. Edição restrita a admin, como as demais alíquotas.

2. **Trava de meia-configuração (LOUD):** salvar exige os dois campos preenchidos ou os dois
   vazios. UF sem percentual (ou percentual sem UF) é recusado na UI e no `salvarAliquotas` —
   nunca aplica um número parcial em silêncio (mesma classe de falha do incidente da coluna
   ORIGEM: parâmetro fiscal jamais defaulta calado).

3. **Regra de resolução da alíquota de um item de venda:**

   ```
   pedido.uf == configuracoes.uf_empresa   →  aliquota_interna_pct
   caso contrário (ou uf/parâmetro nulos)  →  8% / 16% por origem (ADR-0055)
   ```

   Comparação case-insensitive, sobre a UF já sem o prefixo `BR-`. A alíquota interna
   **sobrepõe** a origem: vale para nacional e para importado.

4. **`AliquotaResolver` passa a receber a UF, em parâmetro obrigatório:**

   ```ts
   export type AliquotaResolver = (item: VendaItem, uf: string | null) => number | null;
   ```

   Obrigatório de propósito: um parâmetro opcional deixaria qualquer call site esquecido
   devolvendo a alíquota por origem — número plausível e errado num caminho financeiro. Com
   parâmetro obrigatório, o compilador enumera os call sites. Os três consumidores
   (`impostoDaVenda`, `agruparPorPedido`, `montarDetalheVendas`) já têm a venda em escopo.

5. **Escopo: apuração pós-venda apenas.** Preço sugerido, gross-up (`_shared/preco/sugerir.ts`),
   `etiquetaParaMinimo` e o "Você recebe por venda" pré-publicação continuam usando a alíquota
   por origem. Um anúncio do ML tem um preço único para o país e a UF do comprador só existe
   depois do pedido; precificar com 1% subprecificaria toda venda para fora do estado.

## Consequências

- Imposto e markup não são persistidos — são derivados na leitura (`impostoDoItem`). Configurar
  o parâmetro **recalcula automaticamente** todo o histórico exibido em Faturamento, Financeiro,
  Dashboard, Publicados, Detalhe de vendas e exports. Não há backfill nem migração de dados.
- Pedidos com `uf` nula continuam na regra por origem. Atinge vendas fechadas antes de
  2026-06-23 (quando a coluna nasceu) e pedidos sem envio registrado.
- "Cliente do estado" = pedido com **UF de entrega** igual à da empresa, sem distinguir
  consumidor final de revenda. Simplificação aceita: o canal é B2C.
- O gate de confirmação de alíquotas (ADR-0086) não muda: as colunas novas são nullable e
  nenhuma org é desconfirmada ao aplicar a migration.
