# Fix: venda de kit vinculado não baixa estoque da base (ADR-0151)

**Data:** 2026-09-08
**Incidente:** pedido ML `2000018341864344`, kit `00000089` (`MLB7585283770`), 3 un. vendidas às 07:45.
**Status:** plano — aguardando revisão independente antes de implementar.

## Causa (provada no banco de produção)

`resolverOrigemEstoque` (`supabase/functions/_shared/estoque/kit.ts:34`) devolve
`codigoCanonico = familias.kit_base_codigo_pai`, que é o **código do PAI/agrupador** da família
base. Esse valor é passado como `p_codigo` para a RPC `baixar_estoque`, que resolve o SKU por
`variacoes.codigo` (migration `20260729084329`, linhas 131-142).

`codigo_pai` e `variacoes.codigo` são espaços de código disjuntos: no banco de produção,
**0 de 8.561** variações têm `codigo = codigo_pai` da própria família. Logo a resolução nunca
encontra a linha e a RPC devolve `sku_nao_encontrado` — em 100% das vendas de kit vinculado.

Evidência (ledger, movimento criado pela venda):

```
codigo: 00000082   quantidade_pedida: 6   quantidade: 0
motivo: venda_sku_nao_encontrado
referencia_externa: mercado_livre:2000018341864344:00000089
```

Dados reais: kit `00000089` → família `00000088` (`kit_multiplicador=2`,
`kit_base_codigo_pai=00000082`). A família base `00000082` tem **uma** variação: `00000083`,
com `estoque=14`. O correto após a venda é **8**.

O multiplicador funcionou (`quantidade_pedida=6` = 3×2); só o mapeamento pai→variação está errado.

### Por que passou nos testes

`__tests__/kit.test.ts:52-54` assere exatamente o comportamento errado — o stub devolve
`kit_base_codigo_pai: '00000010'` e o teste espera `codigoCanonico: '00000010'`. O mock não
distingue `codigo_pai` de `codigo` de variação, então petrificou o bug. Mesmo padrão do incidente
de 2026-08-21 (mock não basta).

`aplicarEstoqueDerivado`, no mesmo arquivo (linha 158+), **já faz certo**: busca a família base
por `codigo_pai` e depois lê `variacoes` daquela família. A divergência entre as duas funções é a
origem do defeito.

## Correção (revisada pelo Fable em 2026-09-08 — achados incorporados)

### 1. `resolverOrigemEstoque` devolve o código da VARIAÇÃO (diff mínimo, sem helper novo)

Não extrair helper compartilhado com `aplicarEstoqueDerivado`: mudaria o comportamento de uma
função que hoje está correta e é usada por `publish-familia-ml`/`update-familia-ml`. Só o
resolvedor muda, ganhando duas consultas:

1. família base canônica: `familias` por `(org_id, codigo_pai = kit_base_codigo_pai)`,
   `order by criado_em desc limit 1` — **mesma âncora** de `baixar_estoque`, `ajustar_estoque` e
   do push;
2. `variacoes` por `familia_id`, exigindo **exatamente uma** linha (trava D-10 do ADR-0151).

`codigoCanonico` passa a ser o `codigo` dessa variação (`00000083`), nunca o `codigo_pai`.

### 2. Nada de degradar para neutro em SKU de kit

Degradar faz a baixa cair no próprio kit (saldo 0): a RPC grava `venda` com `quantidade = 0`,
**queima a referência de idempotência para sempre** e nada alerta — exatamente o modo de falha
deste incidente. Vale para os três casos: erro de leitura, base ausente, base multivariação.

`OrigemEstoque` ganha `erro?: string`; `baixa.ts` empurra o item para `falhas`, que já dispara o
alerta 🚨 e **não** cria movimento, então o próximo webhook do pedido retenta naturalmente.

Erro de leitura em SKU comum também vira `erro`: sem a consulta não há como saber se é kit, e um
banco indisponível derrubaria a RPC seguinte de qualquer jeito. Custo: uma execução adiada.

### 3. Texto do alerta 🚨 (`sync-venda/index.ts`)

Hoje diz só "Ajuste manualmente na tela de Estoque". Com o retry automático, operador ajustando à
mão + retry bem-sucedido = débito duplo. Acrescentar que a baixa é reaplicada sozinha no próximo
evento do pedido se a causa for corrigida, e que o saldo deve ser conferido antes do ajuste manual.

### 4. Testes

- `kit.test.ts`: o assert de hoje (linha 52-54) espera o valor errado. Trocar o stub por um que
  **distingue as tabelas** (`from('variacoes')` vs `from('familias')`) e usa `codigo_pai ≠ codigo`
  — a condição que o mock antigo tornava impossível de observar.
- Casos: kit resolve para a variação da base; base multivariação → `erro`; base inexistente →
  `erro`; erro de leitura → `erro`; SKU comum inalterado.
- `baixa-kit.test.ts`: item com `erro` entra em `falhas` e a RPC **não** é chamada.

### 5. Prosa desatualizada no mesmo commit

`kit.ts:11` (doc de `codigoCanonico`) e ADR-0151 D-1 descrevem o comportamento bugado.

## Deploy

`kit.ts` vive em `_shared/`, então redeployar **todas** as funções que o embutem (regra do
CLAUDE.md): `sync-venda` (obrigatória — é quem baixa), `criar-kit-vinculado`,
`sincronizar-estoque`, `publish-familia-ml`, `remover-publicado`, `update-familia-ml`.
Conferir a versão pós-deploy. O merge na main **não** deploya Edge Functions.

## Remediação do estoque em produção

`ajustar_estoque` foi **descartado**: o movimento fantasma (`venda_sku_nao_encontrado`) não é lido
por `estornar_estoque`, que filtra `motivo = 'venda'` (migration `20260729084329:194`). Um
cancelamento futuro cairia em `sem_baixa_registrada` e `tratarPedidoCancelado`
(`cancelamento.ts:94-100`) devolveria `'reposto'` **sem notificar ninguém** — o saldo ficaria 6
unidades errado, em silêncio. Ajuste manual pela RPC também não enfileira push (só
`ajustar-estoque/processar.ts:51-53` enfileira).

Caminho correto — **nesta ordem**:

1. Deploy do fix (senão o reprocessamento queima a referência de novo com `00000082`).
2. Liberar a referência do fantasma preservando a auditoria:
   `update estoque_movimentos set referencia_externa = referencia_externa || '#bug-adr0151'
    where id = 'b746ae2b-b567-4477-be0c-4847fb5c3093'`.
3. Re-enfileirar o `sync-venda` do pedido `2000018341864344` via QStash
   (`docs/how-to/operacoes-rotineiras.md`, seção "Destravar família/worker").

O re-sync é seguro: `novaPaga = status === 'paid' && !eraPaga` (`_shared/faturamento/io.ts:381`) e
a venda já está gravada como paga, então não reenvia mensagem ao comprador nem notificação; a
notificação e o alerta ainda passam por `reservarNotificacao`. A baixa grava
`codigo = 00000083, quantidade = -6` com `origem_kit_*` preenchido, o estorno passa a funcionar e
o push sai pelo outbox.

## Verificação

- Antes e depois do deploy: repetir a query do resolvedor para `00000089` e conferir que devolve
  `00000083` / multiplicador 2.
- Conferir que `anuncios_externos` tem linha `status='publicado'` para `00000088`, senão o kit sai
  com 0 alvos no fan-out (`sincronizar-estoque/processar.ts:189-191`).
- Depois do re-sync: movimento `codigo=00000083, quantidade=-6`; `variacoes.estoque` = 8; ML com 8
  na base e `floor(8/2) = 4` no kit.

## Ordem de execução

1. Fix + testes na branch `worktree-fix-kit-baixa-estoque` (implementação: Sonnet).
2. `pnpm test` + `pnpm lint` + `pnpm build` verdes.
3. Revisão do diff (Opus).
4. Deploy das 6 funções.
5. Liberar a referência + re-enfileirar o pedido.
6. Conferir saldo, ledger e ML.
7. Merge fast-forward na main com CI verde, deletar branch e worktree, `git pull` na main local.

## Fora de escopo

- Não mexer em `aplicarEstoqueDerivado`, `listarKitsVivos`, push ou cancelamento: todos tratam
  `kit_base_codigo_pai` como código de família, que é o uso correto (confirmado na revisão).
- Não afrouxar a trava D-10 (kit só sobre base de variação única).
