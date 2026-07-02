# Financeiro detalhe: marcar pedidos como sacados

**Data:** 2026-07-02  
**Status:** Aprovado para planejamento  
**Escopo:** tela `Financeiro > Detalhe do líquido`

## Contexto

A coluna `Liberação` hoje mostra dois estados derivados de `money_release_date`:

- `a liberar`: o Mercado Livre ainda não liberou o recebimento.
- `liberado`: o Mercado Livre já liberou o recebimento para saque.

Falta um terceiro estado operacional: `sacado`. Esse estado não vem do Mercado Livre; ele é marcado
manualmente pelo usuário quando os pedidos/valores já foram sacados.

## Decisão

Adicionar marcação direta na venda (`ml_vendas`) em vez de criar uma entidade de saque ou uma trilha
de eventos.

Campos novos:

- `sacado_em timestamptz null`: quando o pedido foi marcado como sacado.
- `sacado_por uuid null`: usuário autenticado que marcou o saque.

O status exibido passa a ser derivado assim:

1. `sacado` quando `sacado_em` não é nulo.
2. `liberado` quando `money_release_date <= agora` e `sacado_em` é nulo.
3. `a liberar` quando `money_release_date > agora` e `sacado_em` é nulo.
4. `—` quando não há `money_release_date` e também não há `sacado_em`.

## Fluxo de uso

O usuário pode selecionar registros na tela de detalhe a partir de qualquer filtro, incluindo
`Todos` e `Liberados`.

A ação `Registrar saque` só altera pedidos cujo status atual seja `liberado`. Registros
selecionados como `a liberar`, `sacado` ou sem data de liberação não são elegíveis.

A ação `Desfazer saque` só altera pedidos cujo status atual seja `sacado`.

Após uma ação bem-sucedida, a lista é recarregada ou atualizada no cache para refletir o novo status.

## UI

Adicionar seleção explícita por checkbox nas linhas da tabela. O expansor de detalhes continua
separado.

Filtros da tela:

- `Todos`
- `Liberados`
- `A liberar`
- `Sacados`

Ações por seleção:

- `Registrar saque`
- `Desfazer saque`

Quando a seleção tiver registros inelegíveis, eles devem ser ignorados. A interface deve informar o
resultado de forma simples, por exemplo: `3 pedido(s) marcados como sacados; 1 ignorado`.

## Persistência

Criar funções pequenas no client para atualizar `ml_vendas`:

- `registrarSaque(ids)`: grava `sacado_em = now()` e `sacado_por = auth.uid()` apenas em vendas com
  `money_release_date <= now()` e `sacado_em is null`.
- `desfazerSaque(ids)`: limpa `sacado_em` e `sacado_por` apenas em vendas com `sacado_em is not null`.

As condições também devem existir no update, não só na UI, para evitar corrida entre seleção e ação.

## Exportação

O export do `Financeiro > Detalhe` deve usar a mesma função de status da tela. A coluna `Liberação`
continua contendo data + status quando houver data, e deve mostrar `sacado` quando aplicável.

## Testes

Adicionar teste unitário pequeno para a função de status:

- data futura sem saque => `a liberar`
- data passada sem saque => `liberado`
- data passada com `sacado_em` => `sacado`
- sem data e sem saque => sem status (`—`)

Adicionar teste ou check simples para garantir que filtro `Sacados` usa o status derivado, não apenas
data de liberação.

## Fora de escopo

- Entidade `saques`.
- Valor total, observação ou conciliação com extrato bancário.
- Histórico de eventos de saque/desfazimento.
- Tela administrativa de auditoria. A auditoria mínima é o estado atual (`sacado_em`, `sacado_por`).

