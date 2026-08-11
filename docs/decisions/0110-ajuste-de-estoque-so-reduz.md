# ADR-0110 — Ajuste de estoque no PubliAI: só reduz, e é admin

- **Status:** aceito
- **Data:** 2026-08-11
- **Refina:** [ADR-0094](0094-estoque-unico-cadastro-manual.md) (ledger e push absoluto),
  [ADR-0060](0060-pausar-reativar-anuncio-ml.md) (pausar/reativar é admin)
- **Contexto relacionado:** ADR-0055 (custo alimenta markup e preço), ADR-0048 (cap de estoque),
  ADR-0088 (user products)
- **Spec:** `docs/superpowers/specs/2026-08-11-ajuste-de-estoque-design.md`

## Contexto

Até aqui o ledger de estoque só aceitava movimento de `venda`, `entrada` e `estorno_venda`. Não
existia como **reduzir** saldo fora de uma venda: nem para venda física fora do marketplace, nem
para perda, nem para "acabou essa cor".

Na falta desse caminho, o operador zerava a cor direto no Mercado Livre. Isso não funciona: o
PubliAI faz push **absoluto** do saldo local, e o cron `reconciliar-estoque` (`30 12 * * *`)
re-empurra todo produto com movimento nas últimas 24h com `canal_origem: null`
(`supabase/functions/reconciliar-estoque/index.ts:93`), restaurando o número antigo. Confirmado em
produção em 2026-08-11: três anúncios Helanca Light com o SKU Vermelho em 2000/1990/2000 locais
voltando a vender depois de zerados no ML.

## Decisão

Criar o motivo `ajuste` no ledger, com uma RPC e uma edge function dedicadas, sujeito a três
restrições.

### 1. O ajuste só reduz ou zera

`novo_saldo > saldo_atual` é rejeitado; aumentar continua sendo Entrada de mercadoria.

**Por quê.** A Entrada exige custo válido e alimenta `variacoes.custo`
(`entrada-estoque/index.ts:42-46`), que é insumo de markup e preço (ADR-0055). Um ajuste livre para
cima seria uma entrada sem custo e sem documento — furo na trilha financeira. Pior: o cabeçalho de
`reconciliar-estoque/index.ts:1-9` documenta que empurrar saldo alto demais "RESTAURARIA unidades
já vendidas e ampliaria o oversell"; um aumento manual é exatamente esse push, disparado à mão, e
mascararia um webhook de venda perdido em vez de expor o problema.

### 2. É admin

Paridade com pausar/reativar anúncio (ADR-0060). Zerar uma cor tira o produto de venda — mesmo peso
comercial, mesma porta.

### 3. Estorno continua repondo por cima do zero

`estornar_estoque` soma o saldo de volta incondicionalmente e propaga para todos os canais,
inclusive o de origem (migration `20260729084329_e6b_estoque_movimentos.sql:214-241`). Um pedido
cancelado depois de o operador zerar a cor **repõe** o saldo e pode reativar a cor no canal.

Isso fica como está: cancelamento significa mercadoria que voltou fisicamente, e travar o estorno
faria o saldo divergir do físico real — o oposto do que o ledger existe para garantir. A interface
avisa, e quem quer tirar de venda de vez usa Pausar.

## Armadilha de implementação (vale para a próxima RPC de estoque)

A RPC precisa **pertencer ao role `estoque_rpc_executor`** — o trigger `bloquear_escrita_direta_
estoque` (guard de 2026-08-04) só libera `UPDATE` de `variacoes.estoque` para esse `current_user`.
Sem o `alter function … owner to`, a função falha com `42501` na primeira escrita real.

E os `revoke`/`grant` da função precisam vir **antes** da troca de dono, ou rodar com
`set local role estoque_rpc_executor` dentro de `begin/commit` explícito (o `supabase db push`
**não** envolve a migration em transação). Fora disso o executor não é grantor válido e os
comandos viram **no-op com WARNING, não erro** — foi assim que a função ficou publicada com
`EXECUTE` para `PUBLIC`, `anon` e `authenticated` até a migration `20260811203500` corrigir.
Como toda RPC daqui é `security definer` e recebe `p_org` por parâmetro, esse no-op silencioso
equivale a expor escrita de estoque de qualquer organização a qualquer usuário autenticado.

## Comportamento do ML observado na validação (2026-08-11)

- **Repor estoque REATIVA o anúncio pausado.** Um item `paused` com `available_quantity = 0` que
  recebe um push com quantidade > 0 volta para `active` sozinho, sem nenhum PUT de status. Medido
  em produção com o item `MLB5040504553`. É o que torna o aviso do diálogo literal: um estorno
  posterior repõe saldo e a cor **volta a vender**.
- **Anúncio moderado (`sub_status = forbidden`) recusa o push** com 400 e mensagem "Anúncio
  removido no Mercado Livre — republique o produto para voltar a vender". O ajuste local é
  aplicado do mesmo jeito; o canal é que fica para trás até a republicação.
- **`sincronizar-estoque` devolve 200 mesmo quando o push falha em definitivo** (loga
  `estoque_push_definitivo` e segue). Portanto `DELIVERED 200` no QStash **não** é prova de que o
  canal foi atualizado — para conferir, ler o estoque vivo (tela Publicados / `lerStatus`).

## Consequências

- Existe um caminho correto para "acabou essa cor", e ele se propaga para todos os canais
  publicados — inclusive os que vierem no E5.
- Editar estoque direto no Mercado Livre continua sendo revertido em até 24h pelo cron. Isso vira
  regra operacional explícita: **nunca editar estoque direto no canal**. Não corrigimos o
  `canal_origem: null` do cron neste ADR; com o ajuste local existindo, o caso deixa de ocorrer, e
  mexer no cron enfraqueceria a rede de segurança do push (um push que falhou de verdade no canal
  não seria mais reempurrado).
- O ledger passa a ter movimento com `quantidade = 0` (ajuste que não mudou nada). É trilha
  deliberada — registra que alguém conferiu o saldo — e não afeta somas.
- Correção de inventário para cima exige Entrada, com custo. Mais fricção, de propósito.

## Alternativas descartadas

- **Webhook `items` do ML** (refletir no PubliAI o que o operador digita no ML): todo push nosso
  gera notificação, o throttle atual pode engolir o evento que importa, e exige mexer no painel da
  aplicação ML. Complexidade alta para um caso que deixa de existir quando o ajuste local passa a
  existir.
- **Guard de leitura antes do push** (o worker lê o estoque vivo do canal e respeita um zero de
  lá): faz o canal virar fonte da verdade por omissão, e paga um GET por anúncio em todo push.
- **Ajuste com valor livre nos dois sentidos**: descartado pelas razões da decisão 1.
