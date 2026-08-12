# Financeiro — controle do que o ML liberou (design)

**Data:** 2026-08-12 · **Status:** aguardando aprovação
**Origem:** revisão completa do menu (`.code-review-fable5/code-review-v1.md`, veredito BLOQUEAR, score 42/100)
**Decisões do Diego (2026-08-12):** enxugar o menu para liberação e saque · esconder cancelados por padrão com filtro dedicado · apagar as compras e travar a ingestão · desfazer os 46 saques indevidos

---

## Problema

O menu Financeiro foi construído sobre a premissa de que toda linha de `ml_vendas` é uma venda faturável. A premissa é falsa por dois caminhos independentes:

1. **Compras da própria empresa entram na tabela.** O webhook `orders_v2` do ML notifica pedidos em que a conta é comprador *ou* vendedor, e `sync-venda` grava sem checar quem vende. 23 linhas, R$ 37.118,27 — das quais R$ 8.810,50 em status `paid` contam como faturamento.
2. **Devolução concluída vira `cancelled`.** O agregador de KPIs aprendeu a filtrar isso; a tabela do Detalhe, a régua de liberação e a RPC de saque não. Resultado: 46 pedidos devolvidos marcados como sacados (R$ 2.849,54).

Somado a isso, dois KPIs informam números errados sobre dinheiro (estornos omite 99,6%; "já liberado" mistura sacado com não sacado) e a tela do Detalhe não tem busca nem paginação para 985 pedidos.

## Princípio de desenho

O menu responde **uma** pergunta: *quanto o Mercado Livre já me liberou, quanto ainda vai liberar, e o que eu já saquei.*

Tudo que responde "quanto lucrei" (markup, lucro líquido, ticket médio, nº de vendas) sai — já existe no Faturamento e no Dashboard, derivado do mesmo agregador. Manter o número em três telas só multiplica a chance de divergirem, o que já ocorreu duas vezes neste projeto.

Corolário operacional: **o que não tem dinheiro a receber não aparece na tela de recebimento.** Compra, pedido cancelado e devolução saem da lista por padrão — e o que não está na lista não pode ser selecionado nem sacado. A trava vira estrutural em vez de depender de o operador não clicar.

---

## Arquitetura

Três camadas, cada uma com sua trava. A regra "pedido devolvido não tem dinheiro" passa a ser verdade nas três, e não só na de cima.

```
Ingestão      sync-venda rejeita pedido cujo seller.id ≠ conta conectada
   ↓
Banco         RPC de saque exige status faturável (+ admin)
   ↓
Tela          lista mostra só faturável; seleção só alcança o que está na lista
```

Hoje só a camada de KPI filtra, e ela é a única das quatro que não escreve nada.

## Componentes

### 1. Ingestão — `supabase/functions/sync-venda/index.ts`

Guarda nova logo após buscar o pedido, antes de qualquer escrita: se `pedido.seller.id` não for a conta conectada, responder 200 com `{ok: true, ignorado: 'compra-da-conta'}`. 200 e não erro — o QStash não deve re-tentar; ignorar é o resultado correto, não uma falha.

Idempotência preservada: o worker continua podendo ser chamado n vezes para o mesmo pedido.

### 2. Migration — limpeza e trava

Uma migration, quatro operações:

| # | Operação | Alcance medido |
|---|---|---|
| 1 | `delete from ml_vendas` onde `comprador_id` = `ml_user_id` da própria credencial | 23 linhas |
| 2 | `update ml_vendas set sacado_em = null, sacado_por = null` onde status não faturável | 46 linhas |
| 3 | `registrar_saque_ml_vendas`: `+ and status in ('paid','partially_refunded','refunded')` | trava |

Verificar a FK de `ml_vendas_itens` antes do delete (cascade esperado). Aplicação por `supabase migration new` + `db push --linked` + `npm run db:check`, nunca pelo painel (ADR-0043).

**Questão em aberto — exigir admin no saque.** O relatório aponta (achado A6) que qualquer membro ativo da organização pode registrar/desfazer saque, enquanto o ADR-0060 restringiu pausar anúncio a admin. Isso **não** entra na migration da Fase 1 porque depende de uma resposta que o Diego ainda não deu: algum operador não-admin registra saque na rotina? Se não, é uma linha a mais nas duas RPCs; se sim, fica como está e se registra o porquê.

### 3. Agregador — `src/lib/resumo-vendas.ts`

Duas correções e um campo novo:

- **`estornos`** passa a somar `v.estorno` de **todo** pedido do período, antes do `continue` de faturável. Estorno é dinheiro que saiu, e a devolução — que é a maior fonte dele — está justamente nos `cancelled`.
- **`aSacar`** (novo): líquido liberado cuja venda ainda tem `sacado_em is null`. É o saldo que dá para tirar hoje.
- **`liberado`** continua existindo (histórico do período, alimenta o gráfico), mas deixa de ser o card principal.

### 4. Tela `Financeiro.tsx`

Passa de 11 KPIs para 6, organizados por pergunta:

| Bloco | O que mostra |
|---|---|
| Hero | **Liberado a sacar** — o número acionável (hoje inexistente na interface) |
| Caixa | A liberar (com a próxima data) · Já sacado no período |
| Venda | Faturamento bruto · Retido pelo ML (comissão + frete) · Estornos |
| Gráfico | Evolução do líquido por dia/semana — mantido |

Saem: Ticket médio líquido, Vendas no período, Markup no período, Lucro líquido no período. O parágrafo de rodapé encolhe junto (hoje são seis linhas explicando exceções).

### 5. Tela `DetalheFinanceiro.tsx`

- **Filtro padrão = só faturável.** O seletor ganha uma quinta opção, `Devolvidos`, que mostra exclusivamente o complemento — para conferência, sem poder sacar.
- **Busca geral** com `pedidoCasaBusca` (já existe em `pedidos-faturamento.ts:313`, já usada pelo Faturamento): casa comprador, nº do pedido, título, código, EAN e valores. Estado em `useSessionState`, como o sort.
- **Paginação client-side, 50 por página.** Os dados já estão todos em memória; o rodapé de totais continua somando o **filtro inteiro**, não a página — senão o total mente.
- **Coluna Markup sai** (é lucratividade, não liberação). Ficam: Data, Comprador, Produtos, Un., Liberação, Bruto, Retido (ML), Líquido.
- **Confirmação no saque em massa** acima de 20 pedidos, exibindo quantidade e soma em R$.
- **`sacado_por` exibido** na linha sacada — é a trilha da única ação de escrita do menu.

## Fluxo de dados

Inalterado no formato: `ml_vendas` → `useVendas` → `calcularResumo`/`agruparPorPedido` → telas. O que muda é *o que entra*: a tabela deixa de receber compras, e a tela deixa de listar o que não tem dinheiro a receber.

## Tratamento de erro

- Ingestão: pedido de compra → 200 com motivo no corpo (auditável no log do QStash), sem escrita.
- Saque: a RPC devolve a contagem de linhas afetadas; o toast já informa "N ignorados". Com a trava de status, um pedido devolvido selecionado por qualquer via cai nesse contador em vez de ser marcado.
- Migration: as três operações de dados são idempotentes (delete/update por predicado).

## Testes

Os 8 casos listados na seção "Testes faltantes" do relatório, com destaque para os que travam regressão em dinheiro: ingestão rejeitando compra (1), RPC recusando cancelado (2), estornos somando cancelado (3), `aSacar` excluindo sacado (4), e totais do rodapé somando o filtro e não a página (8).

## Ordem de execução

1. **Fase 1 — parar a sangria.** Ordem obrigatória: **deploy de `sync-venda` primeiro, migration depois**. É o inverso da regra usual do projeto (migration antes do código), e de propósito: aqui o código novo não depende de coluna nova — é só um filtro. Se as 23 linhas forem apagadas enquanto o worker antigo ainda está no ar, qualquer webhook `orders_v2` daqueles pedidos as reinsere. Sequência: `supabase functions deploy sync-venda` → `supabase migration new` → `db push --linked` → `npm run db:check`.
2. **Fase 2 — KPIs corretos** (`estornos`, `aSacar`, novo layout do Financeiro).
3. **Fase 3 — usabilidade do Detalhe** (filtro faturável, busca, paginação, confirmação, `sacado_por`).

Cada fase é entregável e testável isolada. A Fase 1 sozinha já resolve os dois CRÍTICOS.

## Fora de escopo

- Menus Faturamento, Publicados, Dashboard e Estoque — mesmo consumindo o mesmo agregador. As correções em `resumo-vendas.ts` (estornos) os beneficiam, e isso deve ser verificado ao aplicar, mas nenhuma tela deles muda aqui.
- Reconciliação automática do saque contra o extrato do Mercado Pago. A API não expõe isso de forma confiável (ADR-0031), e continua manual.
- Multi-canal: o menu segue exibindo Mercado Livre; o `CanalTabs` permanece como está.
