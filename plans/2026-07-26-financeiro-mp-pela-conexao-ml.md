# Plano — Financeiro do MP pela conexão OAuth do ML (ADR-0093)

**Branch:** `worktree-mp-financeiro-conexao-ml`
**ADR:** [0093](../docs/decisions/0093-financeiro-mp-pela-conexao-ml.md)

Objetivo: cada empresa passa a ter financeiro próprio via OAuth, usando a conexão
`mercado_livre` que já existe. Some o token global `MP_ACCESS_TOKEN` e o caminho morto do
MP ao vivo.

---

## Task 1 — `carregarLiquidoMP` recebe token e conta do chamador

`supabase/functions/_shared/faturamento/enriquecimento.ts`

Assinatura passa de `(admin, orgId, lookbackDias)` para
`(token: string, contaId: number, lookbackDias = 120)`.

- Some `resolverTokenMP(admin, orgId)` e `getContaId(token)` (a chamada `/users/me` por
  execução deixa de existir — o id vem de `conexao.contaExternaId`).
- O corpo (filtro `collector_id`, exclusão de `marketplace_shipment`, montagem do mapa)
  não muda.
- O `try/catch` com `console.warn` + mapa vazio fica como está; o dano que ele causava é
  fechado na Task 1b.

Extrair a montagem do mapa numa função **pura** `montarMapaLiquido(pagamentos, contaId)`
— hoje `carregarLiquidoMP` é documentadamente "não testado por vitest", e as Tasks 3/4
deletam toda a cobertura restante do MP. Sem isso o PR fica com zero teste num caminho de
dinheiro.

**Verificar:** `pnpm lint` e `deno check` limpos no arquivo.

## Task 1b — falha do MP não pode apagar dado bom (BLOQUEADOR)

`supabase/functions/_shared/faturamento/io.ts` (`upsertVenda`)

`upsert(row, { onConflict: 'user_id,order_id' })` grava a **linha inteira**. Quando
`carregarLiquidoMP` devolve mapa vazio (erro de rede, 401, rate limit, ou pedido fora da
janela de lookback), `mapearPedidoParaVenda` produz `estorno: null` e
`money_release_date: null` — e o upsert **sobrescreve** valores corretos já gravados.
Consequência: o selo liberado/a-liberar some e `notificar-liberacao` nunca dispara para
aquele pedido, em silêncio.

Hoje isso é quase impossível (o `MP_ACCESS_TOKEN` é estático e não falha). Depois desta
mudança passa a ser possível: o MP pode falhar com o token do ML perfeitamente válido, e
nessa janela o worker passa reto pelo `getValidAccessTokenConexao` e grava nulls. É o
formato do incidente ORIGEM — a probabilidade muda por causa deste PR, então o guard vem
junto.

Fix, no mesmo padrão que a função já usa para `comprador_nome`:

- incluir `estorno, money_release_date` no `select` do `anterior`;
- ao montar `row`, preservar o valor anterior quando o novo vier `null`.

Seguro: MP não "des-estorna" nem apaga data de liberação — esses campos nunca voltam
legitimamente para `null`.

**Verificar:** teste que grava uma venda com `money_release_date`, reprocessa com
`liquidoPorPayment` vazio e afirma que a data **continua lá**.

## Task 2 — os 4 workers passam o que já têm em escopo

Uma linha em cada; `token` e a conexão já estão no escopo do call site.

| Arquivo | Linha atual | Vira |
|---|---|---|
| `supabase/functions/sync-venda/index.ts` | `carregarLiquidoMP(admin, orgId)` | `carregarLiquidoMP(token, Number(conexao.contaExternaId))` |
| `supabase/functions/sync-devolucao/index.ts` | idem | idem |
| `supabase/functions/backfill-faturamento/index.ts` | idem | `carregarLiquidoMP(token, Number(cx.contaExternaId))` |
| `supabase/functions/reconciliar-faturamento/index.ts` | idem | `carregarLiquidoMP(token, Number(cx.contaExternaId))` |

Guarda: `contaExternaId` é `string | null`. Quando `null`, pular a leitura do MP (mapa
vazio) em vez de mandar `NaN` para o filtro de `collector_id` — `NaN !== NaN` descartaria
todos os pagamentos em silêncio, que é justamente o modo de falha que este PR quer
eliminar.

**Verificar:** os 4 `deno check` passam; nenhum call site restante de `resolverTokenMP`.

## Task 3 — remover o caminho morto do MP ao vivo

- `git rm -r supabase/functions/resumo-financeiro/`
- `git rm src/lib/financeiro.ts src/hooks/useResumoFinanceiro.ts`
- `supabase/config.toml`: **não** tem bloco `[functions.resumo-financeiro]` (verificado) —
  nada a remover ali.
- Órfãos em `supabase/functions/_shared/mercadopago/`: `agregarFinanceiro`,
  `montarInfoPorPagamento`, `rateio.ts` (+ `__tests__/rateio.test.ts`) e os tipos que só
  eles usavam (`VendaFinanceira`, `ResumoFinanceiro`, `InfoCusto`).
- `financeiro.ts` deve terminar com apenas: `PagamentoMP`, `buscarPagamentosMP` e o
  `MP_API`. Some `getContaId` (Task 1), `escolherTokenMP` e `resolverTokenMP` (Task 4).
- Ajustar `__tests__/financeiro.test.ts`: ficam os testes do que sobreviveu **mais** o de
  `montarMapaLiquido` (Task 1): filtra `collector_id` de terceiro, exclui
  `marketplace_shipment`, e devolve mapa vazio quando a conta é `null`/`NaN` (o guard da
  Task 2).

**Verificar:** `rg "resumo-financeiro|useResumoFinanceiro|lib/financeiro" src supabase`
sem resultado (exceto docs/ADRs). `pnpm test` e `pnpm build` passando.

## Task 4 — matar o fallback global

- Remover `escolherTokenMP` e `resolverTokenMP` de `_shared/mercadopago/financeiro.ts` e
  seus testes.
- Migration nova (`supabase migration new mp_token_pela_conexao_ml`):
  - `drop function if exists public.get_mp_token(uuid);`
  - `alter table public.configuracoes drop column if exists mp_access_token_secret_id;`
- Regenerar `src/lib/database.types.ts`.

**Verificar:** `npm run db:check`. Confirmar que nenhuma org tinha o secret preenchido
(as duas estavam `null` em 2026-07-26) — se alguma tiver, apagar o secret do Vault antes
do `drop column`, senão fica órfão.

## Task 5 — documentação

- `docs/reference/edge-functions.md`: remover `resumo-financeiro`.
- `docs/reference/modelo-de-dados.md`: remover `configuracoes.mp_access_token_secret_id`.
- `docs/explanation/arquitetura.md` e `obsidian-vault/01-Arquitetura/Integrações.md`: a
  origem do dado financeiro é a conexão ML, não um token MP separado.
- `docs/TASKS.md`: corrigir o item que afirma que o caminho morto já havia sido removido
  (não havia — a edge seguia deployada em v14) e registrar a entrega.
- Glossários já atualizados neste branch (`docs/reference/glossario.md`,
  `obsidian-vault/00-Home/Glossário.md`).

---

## Deploy e validação (obrigatório — mudança em `_shared/`)

1. Redeployar **todas** as funções que importam `_shared/faturamento/enriquecimento.ts`:
   `sync-venda`, `sync-devolucao`, `backfill-faturamento`, `reconciliar-faturamento`.
   Conferir a versão e o `verify_jwt` de cada uma depois (todas `false`).
2. Deletar a function `resumo-financeiro` no Supabase (não basta o `git rm` — está
   `ACTIVE` v14).
3. **Validação em produção, antes da migration:** disparar um `sync-venda` de um pedido
   com estorno conhecido e conferir que `ml_vendas.estorno` e
   `ml_vendas.money_release_date` continuam preenchidos. Comparar 1:1 com a tela
   Financeiro antes/depois. Nesta janela o rollback é só reverter o commit + redeploy — o
   schema ainda está intacto.
4. `supabase db push` da migration (drop da RPC e da coluna) — **só depois** do passo 3.
5. Quando a DSA conectar o Mercado Livre, conferir que `/v1/payments/search` responde 200
   com o token dela **antes** de considerar o benefício multi-tenant entregue: o teste de
   2026-07-26 cobriu uma conexão pré-existente, não uma recém-criada.
6. **Só depois de tudo isso**, remover os secrets `MP_ACCESS_TOKEN` e `MP_FALLBACK_ORG_ID`
   do Supabase. Enquanto não removidos, ficam órfãos e inofensivos (nenhum código os lê) —
   e são o rollback: restaurar o `resolverTokenMP` antigo volta a funcionar na hora.

## Rollback

Reverter o commit + redeploy das 4 functions. Os secrets ainda existem (passo 6 é o
último). A migration é o único passo não trivial de reverter — por isso ela vem **depois**
da validação do caminho de código (passo 3), e não antes.
