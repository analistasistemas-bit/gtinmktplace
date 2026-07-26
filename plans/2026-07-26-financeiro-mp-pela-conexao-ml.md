# Plano — Financeiro do MP pela conexão OAuth do ML (ADR-0093)

**Branch:** `worktree-mp-financeiro-conexao-ml`
**ADR:** [0093](../docs/decisions/0093-financeiro-mp-pela-conexao-ml.md)
**Revisão adversarial:** rodada 1 (Fable, 2026-07-26) → `REVISAR`, 2 ALTOs + 2 MÉDIOs +
4 BAIXOs, todos endereçados abaixo.

Objetivo: cada empresa passa a ter financeiro próprio via OAuth, usando a conexão
`mercado_livre` que já existe. Some o token global `MP_ACCESS_TOKEN` e o caminho morto do
MP ao vivo.

**Contexto de produção:** a Avil está vendendo agora. Os campos em jogo (`estorno`,
`money_release_date`) alimentam o selo liberado/a-liberar e o `notificar-liberacao`.
Nenhuma task pode aumentar a chance de gravar dado financeiro errado em silêncio.

---

## Task 1 — `carregarLiquidoMP` recebe token/conta e **sinaliza falha**

`supabase/functions/_shared/faturamento/enriquecimento.ts`

Assinatura passa de `(admin, orgId, lookbackDias)` para
`(token: string, contaId: number, lookbackDias = 120)`.

- Some `resolverTokenMP(admin, orgId)` e `getContaId(token)` — a chamada `/users/me` por
  execução deixa de existir; o id vem de `conexao.contaExternaId`.
- **Retorno passa a ser `Map | null`.** `null` = a leitura do MP falhou. Mapa vazio = leu
  e não havia pagamento correspondente. Hoje os dois casos são indistinguíveis, e é isso
  que produz o defeito da Task 1c.
- Extrair a montagem do mapa numa função **pura** `montarMapaLiquido(pagamentos, contaId)`
  — `carregarLiquidoMP` é documentadamente "não testado por vitest", e as Tasks 3/4
  deletam toda a cobertura restante do MP. Sem isso o PR fica com zero teste num caminho
  de dinheiro.

**Guard dentro de `montarMapaLiquido`:** retornar mapa vazio quando
`!contaId || !Number.isFinite(contaId)`. Atenção: `Number(null)` é **`0`**, não `NaN` —
e `Number(p.collector_id) !== 0` descartaria todos os pagamentos pelo mesmo caminho
silencioso.

**Verificar:** teste de `montarMapaLiquido` cobrindo: filtra `collector_id` de terceiro,
exclui `marketplace_shipment`, mapa vazio para `contaId = 0`, `null` e `NaN`.

## Task 1b — falha do MP não pode apagar dado bom (BLOQUEADOR)

`supabase/functions/_shared/faturamento/venda.ts` e `io.ts`

`upsertVenda` grava a **linha inteira** (`onConflict: 'user_id,order_id'`). Com o mapa
vazio/ausente, `mapearPedidoParaVenda` produz `estorno: null` e `money_release_date: null`
— e o upsert **sobrescreve** valores corretos já gravados. O selo de liberação some e o
`notificar-liberacao` deixa de disparar, em silêncio.

Com o token estático isso era quase impossível; com o token do ML o MP pode falhar sozinho
(401, rate limit, indisponibilidade) com a conexão ML válida.

Implementar **como helper puro**, não inline no `io.ts`:

- `preservarDadosMP(novo, anterior)` em `venda.ts`, ao lado de `escolherCompradorNome` —
  que é exatamente o precedente que este guard imita, e é puro e testado em
  `venda.test.ts`. `io.ts` não tem harness de teste (nenhum teste o importa em runtime);
  um guard escrito lá dentro exigiria mockar `from().select().eq().eq().maybeSingle()` +
  `upsert().select().single()` + delete de itens, e acabaria entregue fraco ou com
  `test.skip` — que é bloqueador pelo CLAUDE.md.
- `io.ts` muda em duas linhas: incluir `estorno, money_release_date` no `select` do
  `anterior`, e chamar o helper ao montar `row`.

Seguro para devolução: quando o MP responde, `estorno` vem como **número** (inclusive `0`)
e sobrescreve normalmente — o guard só age em `null`. Um estorno cancelado no MP chega
como `0` e não fica travado.

**Não protege linha nova** (primeiro insert não tem `anterior`) — para vendas novas a rede
é o `reconciliar-faturamento`; para devoluções tardias, a rede é a Task 1c.

**Verificar:** teste de `preservarDadosMP` em `venda.test.ts` — preserva anterior quando o
novo é `null`; sobrescreve quando o novo é `0`; sobrescreve quando o novo tem valor.

## Task 1c — falha do MP tem que re-tentar, não virar 200 (BLOQUEADOR)

O `sync-devolucao` existe **para** capturar o estorno: o comentário em
`sync-devolucao/index.ts:83-85` diz que devolução chega dias/semanas depois, fora da
janela do `reconciliar-faturamento`, e que "falha aqui usa o mesmo retry via QStash".

Essa intenção está derrotada hoje: o `try/catch` **interno** do `carregarLiquidoMP`
engole o erro do MP e devolve mapa vazio, então o erro nunca chega ao `catch` externo que
chamaria `tratarFalha`. O worker responde **200**, o QStash não re-tenta, e **nada volta
àquele pedido**. Cenário: devolução de um pedido de 30 dias atrás, MP dá 429 no momento do
sync → o claim é gravado, o guard da Task 1b preserva o `estorno` antigo, e o número fica
errado para sempre.

Com o retorno `Map | null` da Task 1, cada chamador decide explicitamente:

| Worker | Ao receber `null` |
|---|---|
| `sync-venda` | faz o upsert (não perde a venda nem o alerta de venda nova) e depois responde **502**, para o QStash re-tentar. `upsertVenda` é idempotente. |
| `sync-devolucao` | idem — upsert primeiro (o claim já está gravado), depois 502. |
| `backfill-faturamento` | `console.warn` e segue com mapa vazio. É varredura em lote; derrubar o lote inteiro por um erro do MP é pior. |
| `reconciliar-faturamento` | idem — ele roda periodicamente e volta ao pedido. |

**Verificar:** os dois workers de retry respondem status não-2xx quando o MP falha, e
`upsertVenda` já rodou antes disso.

## Task 2 — os 4 workers passam o que já têm em escopo

Uma linha em cada; `token` e a conexão já estão no escopo do call site (confirmado).

| Arquivo | Vira |
|---|---|
| `sync-venda/index.ts` | `carregarLiquidoMP(token, Number(conexao.contaExternaId))` |
| `sync-devolucao/index.ts` | `carregarLiquidoMP(token, Number(conexao.contaExternaId))` |
| `backfill-faturamento/index.ts` | `carregarLiquidoMP(token, Number(cx.contaExternaId))` |
| `reconciliar-faturamento/index.ts` | `carregarLiquidoMP(token, Number(cx.contaExternaId))` |

`orgId` nunca é `null` nesses pontos (early return `if (!conexao)` em `sync-venda:56` e
`sync-devolucao:49`; backfill e reconciliar iteram linhas que já têm `org_id`). O caso
`contaExternaId` nulo é coberto pelo guard da Task 1.

**Verificar:** os 4 `deno check` passam; nenhum call site restante de `resolverTokenMP`.

## Task 3 — remover o caminho morto do MP ao vivo

- `git rm -r supabase/functions/resumo-financeiro/`
- `git rm src/lib/financeiro.ts src/hooks/useResumoFinanceiro.ts`
- `supabase/config.toml`: **não** tem bloco `[functions.resumo-financeiro]` (verificado).
- Órfãos em `_shared/mercadopago/`: `agregarFinanceiro`, `montarInfoPorPagamento`,
  `rateio.ts` (+ seu teste) e os tipos que só eles usavam (`VendaFinanceira`,
  `ResumoFinanceiro`, `InfoCusto`).
- Órfãos em `_shared/ml/pedidos.ts` — o módulo **sobrevive** (`enriquecimento.ts` usa
  `buscarGtinsDosItens`), mas ficam sem consumidor: `buscarPedidosML`,
  `mapearPagamentoParaItem` e os tipos `PedidoComPagamentos`, `ItemDoPagamento`. Remover
  junto, com os testes correspondentes em `__tests__/pedidos.test.ts`.
- `financeiro.ts` termina com: `PagamentoMP`, `buscarPagamentosMP` e `MP_API`.
- Ajustar `__tests__/financeiro.test.ts`: só o que sobreviveu + o teste de
  `montarMapaLiquido`.

**Verificar:** `rg "resumo-financeiro|useResumoFinanceiro|lib/financeiro|buscarPedidosML|mapearPagamentoParaItem" src supabase`
sem resultado fora de docs/ADRs. `pnpm test`, `pnpm lint` e `pnpm build` passando.

## Task 4 — matar o fallback global

- Remover `escolherTokenMP` e `resolverTokenMP` de `_shared/mercadopago/financeiro.ts` e
  seus testes.
- Migration nova (`supabase migration new mp_token_pela_conexao_ml`):
  - `drop function if exists public.get_mp_token(uuid);`
  - `alter table public.configuracoes drop column if exists mp_access_token_secret_id;`
- Regenerar `src/lib/database.types.ts` (linha ~1283 tem `get_mp_token`).

Sem views, RLS ou funções dependentes (verificado). Sem secret órfão no Vault — nenhuma
org preencheu a coluna. Ordem `drop function` → `drop column` está correta.

**Verificar:** `npm run db:check`.

## Task 5 — documentação

- `docs/reference/edge-functions.md`: remover `resumo-financeiro`.
- `docs/reference/modelo-de-dados.md`: remover `configuracoes.mp_access_token_secret_id`.
- `docs/explanation/arquitetura.md` e `obsidian-vault/01-Arquitetura/Integrações.md`: a
  origem do dado financeiro é a conexão ML.
- `docs/diagrams/seq-financeiro.drawio` e `docs/diagrams/c4-n3-componentes.drawio`:
  referenciam `resumo-financeiro` (a tabela do CLAUDE.md exige atualizar diagramas).
- `docs/project-status.md`: cita o caminho morto como pendência — passa a entregue.
- `docs/TASKS.md`: corrigir o item que afirma que o caminho morto já havia sido removido
  (não havia — a edge seguia deployada em v14) e registrar a entrega.
- Glossários já atualizados neste branch.

---

## Deploy e validação (obrigatório — mudança em `_shared/`)

O PR altera `_shared/faturamento/enriquecimento.ts` **e** `_shared/faturamento/io.ts`.
`io.ts` é importado por **7** funções, não 4 — as três extras (`ml-webhook`,
`sync-mensagem`, `sync-pergunta`) usam `resolverIdentidade`/`resolverOrgPorUserId` e não
chamam `upsertVenda`, então nada quebra hoje; mas deixá-las com bundle antigo viola a
regra do projeto e planta drift.

1. Redeployar as **7**: `sync-venda`, `sync-devolucao`, `backfill-faturamento`,
   `reconciliar-faturamento`, `ml-webhook`, `sync-mensagem`, `sync-pergunta`.
   Conferir versão e `verify_jwt` das 7 depois (todas `false`).
2. Deletar a function `resumo-financeiro` no Supabase (não basta o `git rm` — está
   `ACTIVE` v14).
3. **Validação em produção, antes da migration:** disparar um `sync-venda` de um pedido
   com estorno conhecido e conferir que `ml_vendas.estorno` e `money_release_date`
   continuam preenchidos. Comparar 1:1 com a tela Financeiro antes/depois. Nesta janela o
   rollback é só reverter o commit + redeploy — o schema ainda está intacto.
4. `supabase db push` da migration — **só depois** do passo 3.
5. Quando a DSA conectar o Mercado Livre, conferir que `/v1/payments/search` responde 200
   com o token dela **antes** de considerar o benefício multi-tenant entregue: o teste de
   2026-07-26 cobriu uma conexão pré-existente, não uma recém-criada.
6. **Só depois de tudo isso**, remover os secrets `MP_ACCESS_TOKEN` e
   `MP_FALLBACK_ORG_ID`. Antes de remover, **re-conferir a versão das 7 funções** e
   **repetir a validação do passo 3 logo após a remoção**.

   Por quê: o `resolverTokenMP` antigo ignora o erro da RPC (`financeiro.ts:47`
   destructura só `data`), então uma função que tenha ficado com deploy defasado continua
   funcionando *aparentemente bem* mesmo após o `drop function` — e só passa a gravar
   `estorno`/`money_release_date` nulos quando os secrets somem. É o incidente de
   2026-07-24 (merge sem deploy) com consequência financeira.

## Rollback

Reverter o commit + redeploy das 7 functions. Os secrets ainda existem (passo 6 é o
último). A migration é o único passo não trivial de reverter — por isso vem **depois** da
validação do caminho de código (passo 3).

## Dívidas conhecidas (registradas, não corrigidas aqui)

- **Race read-modify-write** em `io.ts:224-231`: dois upserts concorrentes do mesmo pedido
  (retry QStash × reconciliar) podem fazer A gravar por cima preservando o `null` que
  leu, depois de B ter gravado o estorno. Janela estreita, mesmo padrão já aceito para
  `comprador_nome`.
- `carregarLiquidoMP` segue sem cobrir erro de rede com teste — só a parte pura
  (`montarMapaLiquido`) fica testada.
