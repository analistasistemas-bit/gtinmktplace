# Cancelamento tardio: fila própria armada pelo banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo pedido que o ML passa a dizer `cancelled` e tem baixa de estoque aberta é levado a `tratarPedidoCancelado`, não importa quem gravou a venda nem quando.

**Architecture:**
- Oito colunas `cancelamento_*` em `ml_vendas`. Trigger `before update of raw` que **só arma ou renova a geração**, por atribuição.
- Três RPCs: `reivindicar_cancelamentos` (reabre por baixa posterior e fixa o lote do ciclo), `cancelamento_baixas` (o que o ledger diz), `registrar_cancelamentos_tratados` (desfecho por geração).
- Drenagem dentro do `reconciliar-faturamento`, na execução em que a etapa `pendencias` acha a fila comum vazia. Sem valor novo de cursor. Liga por `DRENAR_CANCELAMENTOS`.
- A drenagem não regrava a venda. Conclui só com o ledger e a resposta do ML ao vivo.

**Tech Stack:** Postgres/Supabase (migration, trigger, RPC), Deno edge function, vitest.

**Spec:** `docs/decisions/0211-obrigacao-de-cancelamento-com-fila-propria.md` revisão 5 (ler inteiro antes de começar; ler também ADR-0121).

**Classificação:** CRÍTICA (migration + caminho de estoque).
- Revisão independente obrigatória antes do merge: Codex Sol na versão mais recente (`codex debug models`), `model_reasoning_effort=high`, `-s read-only`, `< /dev/null`, contexto limpo, recebendo só o diff, os arquivos tocados e o ADR-0211. Ou subagente Opus high, se o autor for Codex.
- Implementador: Sonnet ou superior. Nunca rebaixar.

**Histórico de revisão:** as revisões 1 (`771ce88d`), 2 (`84afe109`), 3 (`d4041a3d`) e 4 (`abad948e`) receberam REVISE do Codex gpt-6.2-sol (high). As tabelas "Pontos da rodada 4", "3", "2" e "1" dizem onde cada ponto é resolvido e testado.

## Global Constraints

- Trabalhar em worktree próprio, nunca na `main`. Copiar `.env.local` e `.env.test`.
- Migration **só** via `supabase migration new ml_vendas_cancelamento_fila` + `supabase db push`. Validar com `npm run db:check`. Antes de criar: `git fetch` e conferir que o timestamp gerado é mais novo que a última migration aplicada.
- Arquivos que **não podem aparecer no diff**:
  - `supabase/functions/backfill-faturamento/index.ts` e `passo.ts`
  - `supabase/functions/sync-venda/` (exceto a linha que passa o substatus, emenda 24/11 ao ADR-0121)
  - tudo em `supabase/functions/_shared/estoque/`, exceto a regra de pré-despacho de `cancelamento.ts` (emenda 24/11 ao ADR-0121, decisão do Diego)
  - `supabase/functions/_shared/faturamento/pendencias.ts`, `io.ts` e `venda.ts`
  - `supabase/functions/_shared/rodada/`
  - `supabase/functions/reconciliar-faturamento/kit.ts`
- O código novo não lê nem escreve `worker_pendencias`, não chama `upsertVenda`, `refazerBaixaAdiada`, `desfechoKit` nem `lerPendenciasKit`.
- A regra de quando repor (ADR-0121 decisões 2 e 3) e o mecanismo de aviso não mudam. Nenhuma RPC de estoque é criada ou alterada.
- Nenhuma escrita no ML. Nenhum estorno do acervo por script.
- Testes rodam em foreground. `pnpm test -- <arquivo>` roda a suíte inteira; usar `pnpm vitest run <arquivo>`.
- Portão antes do push: `pnpm preflight`.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/<ts>_ml_vendas_cancelamento_fila.sql` | criar | colunas, índice, trigger, 3 RPCs |
| `supabase/tests/ml_vendas_cancelamento_fila.preludio.sql` | criar | esquema de ensaio com cópias vazias das 2 tabelas |
| `supabase/tests/ml_vendas_cancelamento_fila.sql` | criar | teste SQL do trigger e das RPCs, no esquema de ensaio |
| `supabase/functions/reconciliar-faturamento/cancelamentos.ts` | criar | drenagem: ledger, ML ao vivo, lista fechada, IO |
| `supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts` | criar | testes do arquivo acima |
| `supabase/functions/reconciliar-faturamento/passo.ts` | alterar | chamar a drenagem no fim da etapa `pendencias`; `parcial` |
| `supabase/functions/reconciliar-faturamento/__tests__/passo.test.ts` | alterar | testes da chamada |
| `supabase/functions/reconciliar-faturamento/index.ts` | alterar | fiar a dep `drenarCancelamentos` |
| `scripts/ensaio-drenagem-cancelamentos.ts` | criar | ensaio medido na org de ensaio (Task 6) |
| `supabase/functions/backfill-faturamento/__tests__/passo.test.ts` e `manual.test.ts` | alterar | só testes de caracterização |
| `supabase/functions/_shared/faturamento/__tests__/io.test.ts` | alterar | só teste: `upsertVenda` não envia colunas `cancelamento_*` |
| docs (`0211`, `0121`, `README.md`, `TASKS.md`, `project-status.md`) | alterar | status, ponteiro, índice, pendências |

## Pontos da rodada 5 (ressalvas do revisor na implementação) e decisões do Diego

| # | Ponto | Regra que resolve | Testes |
|---|---|---|---|
| a | Ensaio: esperar 6 min não muda `m.criado_em > concluido_em - 5 min`; com carência zero os `avisado` reabrem e disputam o 2º lote | Uma org de ensaio por cenário (normal, lento, reabertura), ids distintos exigidos pelo script; a reabertura usa **outra** referência de baixa (outro SKU de ensaio) no mesmo pedido | `scripts/ensaio-drenagem-cancelamentos.test.ts` (função pura `planoEnsaio`, `deno test`) |
| b | Prazos ignoravam o tempo gasto antes da drenagem; `registrar` estourado tratado como "nada gravado" | Início da execução capturado na entrada do passo, antes de conexão/token/pendências, e passado à drenagem; 60 s e 100 s contam dele; `registrar` sem resposta = incerto, reconferido pelo ledger no ciclo seguinte | P9, F29, F30, F31 |
| c | `PedidoML.status` é opcional: resposta sem status concluía `nao-cancelado` | `nao-cancelado` só com `status` texto não vazio e ≠ `cancelled`; sem status → `ml: sem status`, pendente | F32 |
| R6-1 | Geração trocada durante `kitLigado` ainda era tratada; contagem ignorava o retorno da RPC | `aindaPendente` logo antes de `tratar`, depois de toda espera; `registrar_cancelamentos_tratados` devolve as conclusões aceitas e a drenagem conta por ele | F33, S9b |
| R6-2 | Status arbitrário, só espaços ou numérico concluía/avisava | Allowlist de status do ML (pedido e envio); fora dela fica pendente; `pending_cancel` não conclui | F34 |
| R6-3 | Prazo conferido depois de a operação começar; prazo vencido na entrada não deixava `parcial` | `comPrazo` recebe a função e só a chama com prazo; sem tempo na entrada a drenagem lança | F35, F30 |
| R6-4 | Versão nula nunca renovava | Trigger troca versão nula pela primeira não nula; drenagem trata `cancelled` ao vivo com versão nula, outro status fica | S6c, F36 |
| R6-5 | Flag desligada mudava cursor e acumulado | `drenagemLigada()` no passo; desligada = idêntico à `main` | P10 e os testes 1/8 da `main` sem alteração |
| R6-6 | Rodada obsoleta checada sem trava | `for share` na linha de `worker_rodadas` | S7i |
| R6-7 | S13 mascarado pelo grant do teste | Catálogo conferido antes de qualquer grant do teste | S13 |
| R6-8 | `registrar` que confirma depois do prazo | Ciclo seguinte não reivindica o concluído nem repete o estorno | F31b |
| R6-9 | Ensaio saía com 0 mesmo reprovando | Qualquer critério falho → `Deno.exit(1)` | script |
| D1 | Remover o trigger como rollback | Proibido (Diego, 24/11). Reversão = desligar `DRENAR_CANCELAMENTOS`; V7 removida | ADR "Como reverter" |

## Pontos da rodada 4 (REVISE sobre `abad948e`)

| # | Ponto | Regra que resolve | Testes |
|---|---|---|---|
| 1 | Falha na leitura do envio encerra a obrigação | Pedido com `shipping.id` e envio não lido (ou sem status) fica pendente; o tratamento não é chamado | F26 |
| 2 | Só o início tinha prazo | Toda espera da drenagem tem prazo, inclusive RPCs e o tratamento; prazo final de 100 s reserva tempo para gravar e avançar o cursor; resultado incerto fica pendente e o ledger reconfere | F27, F28, P8 |
| 3 | Ensaio: `avisado` reabre dentro da margem e ocupa o lote | Uma org de ensaio por cenário (ver rodada 5, ponto a) e conferência dos 20 ids reivindicados antes de medir | Task 6.2 |
| 4 | Reparo: contagem com a unidade em trânsito | Grupo A exige que a contagem tenha incluído a unidade devolvida | Reparo R2 |
| 5 | Remover o trigger abre lacuna | Reversão = desligar `DRENAR_CANCELAMENTOS`, trigger mantido; remover o trigger não é opção de rollback (decisão do Diego) | ADR "Como reverter" |

## Pontos da rodada 3 (REVISE sobre `d4041a3d`)

| # | Ponto | Regra que resolve | Testes |
|---|---|---|---|
| 1 | Conclusão apaga cancelamento mais novo | Todo `cancelled` com versão maior que a guardada gera geração nova, inclusive `cancelled → cancelled`. A conclusão só vale para a geração lida | S17, S18, S19, F25 |
| 2 | Execução atrasada fura o teto | A RPC só reivindica se a rodada `reconciliar` da org está `rodando` com o mesmo `params.ate` | S7g, S7h |
| 3 | Lote cheio trava a reconciliação | Prazo por chamada ao ML (10 s) e orçamento total da drenagem (60 s, ajustável); o que não começou fica pendente | F23, F24, P7, Task 6.2 e 6.3 |
| 4 | Ensaio aceita org errada e a limpeza apaga baixas | Ensaio em branch de banco se houver; senão, org e SKUs criados só para o ensaio, prévia das linhas, sem nenhuma exclusão no ledger | Task 6.2 |
| 5 | Reparo: entrada posterior não absorve a baixa | Grupo A só com contagem física confirmada pelo operador; o resto vai para conferência | Reparo R2 |

## Pontos da rodada 2 (REVISE sobre `84afe109`)

| # | Ponto | Regra que resolve | Testes |
|---|---|---|---|
| 1 | Leitura antiga ainda apaga a obrigação; vendedor ausente aceita qualquer um | O trigger só arma. `raw` posterior não importa. Só a drenagem conclui, comparando a resposta ao vivo com a `versao` armada. Drenagem não roda sem `contaExternaId` | S4, S5, S6, F3, F3b, F4, F6, F6b, F19, F20 |
| 2 | Baixa aberta depois de a fila concluir | A reivindicação reabre obrigação concluída que tenha baixa aberta posterior à conclusão | S15, S16, F21 |
| 3 | `split_part` corta SKU com `:` | Código = referência sem o prefixo `mercado_livre:<pedido>:` | S11 caso (f), F8b |
| 4 | Teto de 20 estoura no retry | `lote` nunca é apagado no ciclo; contagem por `lote` sob trava por org → no máximo 20 vendas distintas | S7, S7b, S7e, S7f |
| 5 | Teste SQL trava `ml_vendas` em produção; sem rodada medida com lote cheio | Teste SQL em esquema de ensaio (cópias vazias); migration real com `lock_timeout`; ensaio medido com 20 baixas abertas, incluindo kit, em org de ensaio | Task 1, Task 6 |

## Pontos da rodada 1 (REVISE sobre `771ce88d`)

| # | Ponto | Onde é resolvido | Testes |
|---|---|---|---|
| 1 | Leitura antiga apaga obrigação ou autoriza estorno | Ver rodada 2, ponto 1. Confirmação sempre por geração | S9, S10, F5 |
| 2 | `reposto`/`sem-baixa` escondem saldo baixado | Ledger antes e depois; itens do ledger; V0/V4 com a mesma evidência | S11, F1, F7–F11 |
| 3 | Etapa nova provoca `refazerBaixaAdiada` pela fila comum | `registrarPendenciaKit` neutralizado na fila | F12–F14 |
| 4 | Teto por execução; rollback interrompe o reconciliar; CPU sem medição | Lote por ciclo; sem cursor novo; drenagem nunca lança; chave por variável | P1–P6, Task 6 |
| 5 | Trigger pode bloquear a gravação manual | Trigger só atribui em `new`, sem conversão de tipo | S12, B3, I1 |

## Teste por risco (os 8 bloqueios das tentativas anteriores)

| # | Risco | Teste |
|---|---|---|
| 1 | Transição perdida se o tratamento falha | S2, S2b. F2: `erro` → `concluir=false`; ciclo seguinte reivindica de novo |
| 2 | `erro` classificado como ok | F1: tabela de **todos** os membros de `ResultadoCancelamento` com `satisfies Record<ResultadoCancelamento, …>` |
| 3 | Venda inédita cancelada na fila | S1. F9: sem baixa aberta, nenhuma chamada ao estoque |
| 4 | `descartado_em` tira da fila | S13 (sem coluna de descarte). S8 |
| 5 | Obrigação lida como baixa adiada | F12–F14, F16 |
| 6 | `throw` no lote tira retentativa de venda `paid` | B1 |
| 7 | Falha fora da fila contada como enfileirada | B2. Diff do backfill vazio (Task 7) |
| 8 | Corridas do aviso | Diff de `_shared/estoque/` vazio (Task 7). `cancelamento.test.ts` verde sem alteração |

---

## Task 1 — Migration e teste SQL

**Files:** `supabase/tests/ml_vendas_cancelamento_fila.preludio.sql`, `supabase/tests/ml_vendas_cancelamento_fila.sql`, `supabase/migrations/<ts>_ml_vendas_cancelamento_fila.sql`

**Como o teste roda sem travar a produção.** Não há Postgres local confiável e o banco local não reproduz a cadeia de migrations (ver `scripts/teste-sql-desfeito.py`). O teste roda no mesmo banco, numa transação sempre desfeita, mas **só toca um esquema de ensaio**:

- O prelúdio cria `ensaio_adr0211` com `ml_vendas`, `estoque_movimentos` e `worker_rodadas` vazias, por `create table … (like public.… including defaults)`. `like` pega só `ACCESS SHARE` nas tabelas reais, que não bloqueia leitura nem escrita. Não copia FKs, políticas nem triggers.
- A migration entra com `public.` trocado por `ensaio_adr0211.` (`sed`), então colunas, índice, trigger e RPCs nascem no esquema de ensaio.
- As fixtures são linhas inventadas nas tabelas de ensaio. Nenhuma linha real é lida ou escrita, e nenhuma tabela real recebe `ALTER`.
- Branch de banco do Supabase: a consulta de 24/11 à lista de branches do projeto respondeu vazia (nenhum branch existe). Isso não prova que o plano permite criar um. Se o Diego confirmar que permite, rodar o teste no branch é melhor e dispensa o esquema de ensaio.

Comando:

```bash
sed 's/public\./ensaio_adr0211./g' supabase/migrations/<ts>_ml_vendas_cancelamento_fila.sql > /tmp/mig_ensaio.sql
python3 scripts/teste-sql-desfeito.py supabase/tests/ml_vendas_cancelamento_fila.sql \
  supabase/tests/ml_vendas_cancelamento_fila.preludio.sql /tmp/mig_ensaio.sql
```

O que o esquema de ensaio **não** prova: a RLS herdada de `ml_vendas` (não há política nova; V1 confere que continua uma só) e o tempo de trava da migration real (coberto pelo `lock_timeout` e pela janela da Task 8).

- [ ] **1.1 Prelúdio:**

```sql
create schema ensaio_adr0211;
create table ensaio_adr0211.ml_vendas (like public.ml_vendas including defaults);
create table ensaio_adr0211.estoque_movimentos (like public.estoque_movimentos including defaults);
create table ensaio_adr0211.worker_rodadas (like public.worker_rodadas including defaults);
grant usage on schema ensaio_adr0211 to service_role;
grant all on all tables in schema ensaio_adr0211 to service_role;
```

- [ ] **1.2 RED: escrever o teste SQL.** Asserções em `do $$ … raise exception`. Escritas de fixture e chamadas de RPC sob `set local role service_role`. Nos casos abaixo, `@N` é o `last_updated` do `raw`.

| Caso | Passos | Esperado |
|---|---|---|
| S1 | `insert` com `raw.status='cancelled'` | `cancelamento_geracao` nula |
| S2 | venda `paid`; `update` de `status` e `raw` para `cancelled@30` | geração preenchida, `versao='…30'`, `armado_em` preenchido, `tentativas=0`, `concluido_em` nulo |
| S2b | venda `paid`; `insert … on conflict (user_id, order_id) do update set status = excluded.status, raw = excluded.raw` (forma do `upsertVenda`; criar o índice único na tabela de ensaio) | armada |
| S3 | venda `paid`; `update` só da coluna `status` para `cancelled` | não arma. Depois `raw` para `cancelled` → arma |
| S4 | sequência `cancelled@30 → cancelled@10 → paid@20` | geração e `versao` iguais às do @30; pendente |
| S5 | sequência `cancelled@30 → paid@10 → paid@40` | geração e `versao` iguais às do @30; pendente (o trigger nunca desarma) |
| S6 | obrigação pendente armada em @30; `raw` volta a `paid` e depois a `cancelled@30` (mesma versão) | geração, `versao`, `tentativas` e `lote` **não** mudam |
| S6b | obrigação concluída (armada em @30) com `lote='L1'`; `raw` → `paid` → `cancelled@50` | geração nova, `versao='…50'`, `concluido_em` nulo, `tentativas=0`, `lote` continua `'L1'` |
| S6d | obrigação concluída (armada em @30); `raw` → `paid@10` → `cancelled@30` (mesma versão) | continua concluída, mesma geração |
| S6c | `raw` sem `last_updated`, ou com valor ilegível, virando `cancelled` | arma com `versao` nula ou o texto como veio; o `update` não falha |
| S17 | corrida da rodada 3: obrigação pendente G1 armada em @30; `update` de `raw` `cancelled → cancelled@50` | geração ≠ G1, `versao='…50'`; `armado_em`, `tentativas` e `lote` preservados. `registrar` com G1 e `concluir=true` devolve 0 e a linha segue pendente |
| S18 | obrigação pendente armada em @30; `update` para `cancelled@10` | nada muda |
| S19 | obrigação concluída `nao-cancelado` (armada em @30); `update` `cancelled → cancelled@50` sem passar por `paid` | rearma: geração nova, `concluido_em` nulo |
| S7 | 25 vendas armadas há mais de 5 min; `reivindicar_cancelamentos(org, 'L1', 20, '5 minutes')` duas vezes | as duas chamadas devolvem os **mesmos** 20; 5 ficam sem lote |
| S7b | concluir 3 das 20 e chamar de novo com `'L1'` | devolve as 17 restantes; nenhuma nova entra |
| S7c | chamar com `'L2'` | devolve 20: as 5 nunca tentadas primeiro |
| S7d | venda armada há 1 minuto | não é reivindicada |
| S7e | no lote `'L1'` cheio: uma concluída é rearmada (S6b) e outra é reaberta por baixa posterior; chamar de novo com `'L1'` | `count(*) where cancelamento_lote='L1'` continua 20; nenhuma 21ª venda entra |
| S7f | lote `'L1'` com 12; mais 15 passam da carência; chamar de novo com `'L1'` | entram 8; total com `'L1'` = 20 |
| S7g | execução atrasada: rodada com `params.ate='L1'` reivindica 20; a rodada passa a `params.ate='L2'` e reivindica 20 (remarca parte); chamar de novo com `'L1'` | devolve 0 linhas e não marca nenhuma |
| S7h | rodada da org com `estado` diferente de `rodando`, ou sem linha em `worker_rodadas` | devolve 0 linhas e não marca nenhuma |
| S8 | obrigação com `cancelamento_tentativas=30` | reivindicável |
| S9 | `registrar_cancelamentos_tratados` com a geração lida, `concluir=true`, `lido_em=T` | `concluido_em=T`, desfecho gravado, `tentativas=1`; devolve 1 |
| S10 | geração lida G1; a linha é concluída e rearmada (G2); registrar com G1, `concluir=true` e depois `false` | devolve 0 nas duas; G2 segue pendente com `tentativas=0` |
| S11 | `cancelamento_baixas` para pedidos com: (a) baixa sem estorno; (b) baixa com `estorno_venda` quantidade > 0; (c) baixa com `estorno_sku_nao_encontrado` quantidade 0; (d) só `cancelamento_sem_baixa`; (e) baixa de kit com coluna `codigo` diferente do código da referência; (f) referência `mercado_livre:<pedido>:ABC:01`; (g) pedido `12` e pedido `123` na mesma org | (a) aberta; (b) `estornada=true`; (c) aberta; (d) uma linha com `codigo_ref` nulo; (e) `codigo_ref` = código da referência; (f) `codigo_ref='ABC:01'`; (g) as baixas do `123` não aparecem no `12`. Toda linha traz `lido_em` |
| S12 | catálogo: corpo da função do trigger | não contém `insert`, `update `, `delete`, `perform`, `::` nem `cast` (sem conversão de tipo); `prosecdef=false` |
| S13 | catálogo e permissões | sem coluna de descarte; as 3 RPCs com `prosecdef=true`, `search_path=""`, dono `postgres`; `has_function_privilege`: `service_role` sim, `anon` e `authenticated` não |
| S14 | tabela de ensaio com vendas `cancelled` inseridas **antes** da migration (ordem: prelúdio, fixtures do acervo no fim do prelúdio, migration) | nenhuma com geração preenchida. Regravar uma delas com `cancelled` de versão mais nova continua sem armar |
| S15 | obrigação concluída `sem-baixa-aberta` em T; baixa aberta criada em T + 1 min; `reivindicar` | reaberta: geração nova, `concluido_em` nulo, desfecho `reaberto: baixa depois da conclusão`, `armado_em` renovado |
| S16 | obrigação concluída `avisado` em T com baixa aberta de T − 2 dias; `reivindicar` | **não** reabre. Com baixa estornada posterior a T: não reabre |

- [ ] **1.3 Prova de vermelho:** rodar só com o prelúdio (sem a migration) tem de falhar.

- [ ] **1.4 GREEN: criar a migration** com `supabase migration new ml_vendas_cancelamento_fila`:

```sql
-- ADR-0211: obrigação de tratar cancelamento, armada na própria linha da venda.
set local lock_timeout = '3s';   -- falha rápido em vez de enfileirar atrás de gravação longa

alter table public.ml_vendas
  add column cancelamento_geracao      uuid,
  add column cancelamento_versao       text,
  add column cancelamento_armado_em    timestamptz,
  add column cancelamento_lote         text,
  add column cancelamento_tentativas   integer not null default 0,
  add column cancelamento_tentado_em   timestamptz,
  add column cancelamento_desfecho     text,
  add column cancelamento_concluido_em timestamptz;
create index ml_vendas_cancelamento_fila_idx on public.ml_vendas (org_id, cancelamento_lote)
  where cancelamento_geracao is not null;

-- Só arma ou renova a geração. Só atribui em NEW, sem conversão de tipo: não cria falha nova no upsert.
-- Versão = raw.last_updated como texto. Em produção o formato é único (29 caracteres, `.000-04:00`,
-- 10.543 linhas em 24/11), então a ordem do texto é a ordem do tempo.
create function public.ml_vendas_cancelamento_fila()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_nova     text    := new.raw->>'last_updated';
  v_pendente boolean := new.cancelamento_geracao is not null and new.cancelamento_concluido_em is null;
begin
  if new.cancelamento_geracao is null then
    -- Nunca armada: só arma na transição. Venda do acervo, já cancelada, não arma.
    if coalesce(old.raw->>'status', old.status, '') = 'cancelled' then
      return new;
    end if;
  elsif ((v_nova collate "C") > (new.cancelamento_versao collate "C")) is not true then
    -- Já armada, e este cancelled não é mais novo que o já visto: nada muda.
    return new;
  end if;
  -- Geração nova: qualquer conclusão em andamento com a geração antiga deixa de valer.
  new.cancelamento_geracao := pg_catalog.gen_random_uuid();
  new.cancelamento_versao  := v_nova;
  if not v_pendente then
    new.cancelamento_armado_em    := clock_timestamp();
    new.cancelamento_tentativas   := 0;
    new.cancelamento_tentado_em   := null;
    new.cancelamento_desfecho     := null;
    new.cancelamento_concluido_em := null;
  end if;
  -- cancelamento_lote fica como está: o teto do ciclo conta por ele.
  return new;
end;
$$;
revoke all on function public.ml_vendas_cancelamento_fila() from public, anon, authenticated;

-- `of raw`: marcarConversaCancelada grava só a coluna status. Só update: venda inédita não arma.
-- Dispara em todo cancelled gravado (inclusive cancelled → cancelled); a função decide.
create trigger ml_vendas_cancelamento_fila
  before update of raw on public.ml_vendas
  for each row
  when (coalesce(new.raw->>'status', '') = 'cancelled')
  execute function public.ml_vendas_cancelamento_fila();

-- Reabre o que ganhou baixa depois de concluído e fixa o lote do ciclo.
-- Teto exato: sob a trava, marca no máximo p_limite − (linhas da org já com este lote); nada apaga o lote.
-- Só o ciclo corrente reivindica: execução atrasada de um ciclo anterior sai sem marcar nada.
create function public.reivindicar_cancelamentos(p_org uuid, p_lote text, p_limite integer, p_carencia interval)
returns table (id uuid, order_id bigint, geracao uuid, versao text)
language plpgsql security definer set search_path = '' as $$
declare v_ja integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cancelamentos|' || p_org::text, 0));
  if not exists (select 1 from public.worker_rodadas w
                  where w.job = 'reconciliar' and w.org_id = p_org and w.estado = 'rodando'
                    and w.params->>'ate' = p_lote) then
    return;
  end if;

  update public.ml_vendas v
     set cancelamento_geracao      = pg_catalog.gen_random_uuid(),
         cancelamento_armado_em    = clock_timestamp(),
         cancelamento_tentativas   = 0,
         cancelamento_tentado_em   = null,
         cancelamento_desfecho     = 'reaberto: baixa depois da conclusão',
         cancelamento_concluido_em = null
   where v.id in (
     select c.id
       from public.ml_vendas c
       join public.estoque_movimentos m
         on m.org_id = c.org_id and m.motivo = 'venda' and m.quantidade < 0
        and split_part(m.referencia_externa, ':', 1) = 'mercado_livre'
        and split_part(m.referencia_externa, ':', 2) = c.order_id::text
      where c.org_id = p_org and c.cancelamento_concluido_em is not null
        and m.criado_em > c.cancelamento_concluido_em - interval '5 minutes'
        and not exists (select 1 from public.estoque_movimentos e
                         where e.org_id = m.org_id and e.motivo = 'estorno_venda' and e.quantidade > 0
                           and e.referencia_externa = 'estorno:' || m.referencia_externa));

  select count(*) into v_ja from public.ml_vendas v
   where v.org_id = p_org and v.cancelamento_lote = p_lote;
  update public.ml_vendas v set cancelamento_lote = p_lote
   where v.id in (
     select c.id from public.ml_vendas c
      where c.org_id = p_org and c.cancelamento_geracao is not null and c.cancelamento_concluido_em is null
        and c.cancelamento_lote is distinct from p_lote
        and c.cancelamento_armado_em <= clock_timestamp() - p_carencia
      order by c.cancelamento_tentado_em asc nulls first, c.order_id
      limit greatest(p_limite - v_ja, 0));

  return query
    select v.id, v.order_id, v.cancelamento_geracao, v.cancelamento_versao
      from public.ml_vendas v
     where v.org_id = p_org and v.cancelamento_lote = p_lote
       and v.cancelamento_geracao is not null and v.cancelamento_concluido_em is null
       and v.cancelamento_armado_em <= clock_timestamp() - p_carencia;
end;
$$;

-- O que o ledger diz de cada pedido, com o instante da leitura. Uma linha por baixa; pedido sem baixa
-- devolve uma linha com codigo_ref nulo. Estorno efetivo = estorno_venda com quantidade > 0.
-- codigo_ref = referência sem o prefixo `mercado_livre:<pedido>:` (o código pode conter `:`, e em
-- venda de kit difere da coluna `codigo`).
create function public.cancelamento_baixas(p_org uuid, p_orders text[])
returns table (order_id text, lido_em timestamptz, codigo_ref text, quantidade integer, estornada boolean)
language sql security definer set search_path = '' as $$
  select o.id, statement_timestamp(),
         substr(m.referencia_externa, length('mercado_livre:' || o.id || ':') + 1),
         -m.quantidade,
         exists (select 1 from public.estoque_movimentos e
                  where e.org_id = m.org_id and e.motivo = 'estorno_venda' and e.quantidade > 0
                    and e.referencia_externa = 'estorno:' || m.referencia_externa)
    from unnest(p_orders) as o(id)
    left join public.estoque_movimentos m
      on m.org_id = p_org and m.motivo = 'venda' and m.quantidade < 0
     and starts_with(m.referencia_externa, 'mercado_livre:' || o.id || ':');
$$;

-- Desfecho por geração. concluido_em = instante da leitura do ledger que justificou a conclusão.
create function public.registrar_cancelamentos_tratados(p_org uuid, p_itens jsonb)
returns integer language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_vendas v
       set cancelamento_tentativas   = v.cancelamento_tentativas + 1,
           cancelamento_tentado_em   = clock_timestamp(),
           cancelamento_desfecho     = x.desfecho,
           cancelamento_concluido_em = case when x.concluir then x.lido_em end
      from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
           as x(id uuid, geracao uuid, concluir boolean, desfecho text, lido_em timestamptz)
     where v.org_id = p_org and v.id = x.id and v.cancelamento_geracao = x.geracao
       and v.cancelamento_concluido_em is null
    returning 1)
  select count(*)::integer from u;
$$;

revoke all on function public.reivindicar_cancelamentos(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function public.cancelamento_baixas(uuid, text[]) from public, anon, authenticated;
revoke all on function public.registrar_cancelamentos_tratados(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reivindicar_cancelamentos(uuid, text, integer, interval) to service_role;
grant execute on function public.cancelamento_baixas(uuid, text[]) to service_role;
grant execute on function public.registrar_cancelamentos_tratados(uuid, jsonb) to service_role;
```

O SQL acima é desenho: não foi executado. A Task 1.5 é a prova. `concluir=true` com `lido_em` nulo tem de ser recusado pela drenagem antes de chamar a RPC (F22).

- [ ] **1.5 Rodar verde** com o comando do início da task → `TESTE_OK`.
- [ ] **1.6** `npm run db:check`. Commit: `feat(estoque): obrigação de cancelamento armada na venda (ADR-0211)`.

## Task 2 — `cancelamentos.ts`: a drenagem

**Files:** `supabase/functions/reconciliar-faturamento/cancelamentos.ts` (criar), `__tests__/cancelamentos.test.ts` (criar)

Contrato (o corpo é do implementador; os testes fixam o comportamento):

```ts
// ADR-0211: drenagem da obrigação de cancelamento. Não regrava a venda, não toca a fila comum nem a de kit.
export const LOTE_CANCELAMENTOS = 20;
export const CARENCIA = '5 minutes';
export const PRAZO_CHAMADA_MS = 10_000;   // cada leitura do ML
export const PRAZO_TOTAL_MS = 60_000;     // até aqui a drenagem ainda começa obrigação nova
export const PRAZO_TRATAMENTO_MS = 30_000; // espera pelo tratamento de uma obrigação
export const PRAZO_FINAL_MS = 100_000;    // a partir daqui só grava e devolve; a posse da rodada é de 150 s

/** `1` = todas as orgs; lista de ids separada por vírgula = só essas; ausente = desligada. */
export function drenagemLigada(valor: string | undefined, orgId: string): boolean;

export interface Obrigacao { id: string; orderId: string; geracao: string; versao: string | null }
export interface Ledger { lidoEm: string; baixas: Array<{ codigoRef: string; quantidade: number; estornada: boolean }> }
export interface Registro { id: string; geracao: string; concluir: boolean; desfecho: string; lido_em: string | null }

export interface IoFila {
  /** Vendedor da conexão. A drenagem não roda sem ele. */
  contaExternaId: string;
  reivindicar(lote: string): Promise<Obrigacao[]>;
  ledger(orderIds: string[]): Promise<Map<string, Ledger>>;
  pedido(orderId: string): Promise<PedidoML>;
  envio(shippingId: number | string): Promise<{ status: string | null } | null>;
  aindaPendente(o: Obrigacao): Promise<boolean>;
  kitLigado(): Promise<boolean>;
  tratar(p: PedidoCancelado): Promise<ResultadoCancelamento>;
  registrar(itens: Registro[]): Promise<void>;
  agora(): number;
}

/** `registrarPendenciaKit` vira função vazia: a retentativa do crédito de kit fica na fila própria. */
export function depsDaFila(base: DepsCancelamento): DepsCancelamento;

/** Um lote. Só lança se `reivindicar`, `ledger` ou `registrar` lançarem; quem chama captura. */
export async function drenarCancelamentos(io: IoFila, lote: string, prazoTotalMs?: number, inicioMs?: number): Promise<{ concluidos: number; pendentes: number }>;
```

Regra de `drenarCancelamentos`, por obrigação:

1. `ledger` do pedido. Nenhuma baixa aberta → registro `sem-baixa-aberta`, `concluir=true`, `lido_em` do ledger. Fim.
2. `pedido`. Falha de leitura, `String(pedido.id) !== orderId` ou `String(pedido.seller?.id) !== contaExternaId` → `ml: <motivo>`, não conclui. A comparação do vendedor é direta, sem `ehVendaDaConta` (que aceita qualquer vendedor quando a conta é nula).
3. Versão: `r = Date.parse(pedido.last_updated)`, `a = Date.parse(versao)`. Qualquer um ausente ou ilegível → `ml: sem versão`, não conclui.
   - `status === 'cancelled'` e `r >= a` → segue.
   - `status` texto não vazio, `!== 'cancelled'`, e `r > a` → `nao-cancelado`, `concluir=true`, `lido_em` do ledger. Fim. Sem `status` (`undefined`, `null`, `''`) → `ml: sem status`, não conclui.
   - senão → `ml: resposta antiga`, não conclui.
   
   O tipo `PedidoML` não declara `last_updated`: ler com um tipo local, sem alterar `venda.ts`.
4. `envio` (quando o pedido tem `shipping.id`). Com `shipping.id` presente, envio que não leu (`null`) ou veio sem `status` → `ml: envio não lido`, não conclui, sem chamar `tratar`. `buscarShipment` devolve `null` em qualquer erro de rede ou HTTP, e um 503 não pode virar aviso com a baixa pré-despacho aberta. Estado misto (alguma baixa estornada e alguma aberta) e o envio não é pré-despacho → `parcial-sem-pre-despacho`, não conclui, sem chamar `tratar`. Pré-despacho se decide com `entraNoCreditoKit({ …, kitLigado: true })`, que é o predicado de `cancelamento.ts`.
5. `aindaPendente` falso → não trata e não registra.
6. `tratar` com `itens = baixas abertas.map((b) => ({ codigo: b.codigoRef, quantity: b.quantidade }))`, `catalogoIncompleto: false`, `kitLigado: await io.kitLigado()`.
7. Desfecho: `reposto` → reler `ledger`; nenhuma aberta conclui com o `lido_em` **da releitura**, senão `reposicao-incompleta`. `avisado` e `silenciado` concluem com o `lido_em` da primeira leitura. Todo o resto, inclusive exceção, não conclui.

Paralelismo: 5 por vez. `kitLigado` é lido no máximo uma vez por lote.

Prazos (a drenagem roda antes de `perguntas` e não pode segurar a rodada). **Toda** espera corre contra um temporizador; nenhuma é ilimitada:

| Espera | Prazo | Se estourar |
|---|---|---|
| `reivindicar` | 10 s | a drenagem lança; o passo registra o erro e segue para `perguntas` |
| `ledger` (primeira leitura e releitura), `aindaPendente`, `kitLigado` | 10 s cada | as obrigações afetadas ficam sem registro (pendentes) |
| `pedido`, `envio` | 10 s cada | `ml: tempo esgotado`, não conclui |
| `tratar` | 30 s | resultado incerto: `tratamento: tempo esgotado`, não conclui |
| `registrar` | 10 s | resultado **incerto** (pode ter gravado depois): a drenagem lança; o ciclo seguinte reconfere pelo ledger (F31) |

- Os prazos de 60 s e 100 s contam do **início da execução** (`inicioMs`, capturado na entrada do passo, antes de conexão, token e pendências), não do início da drenagem. Passou de 60 s antes de chamar `reivindicar` → devolve sem reivindicar.
- Antes de **começar** cada obrigação, confere `io.agora()` contra `inicioMs` + `prazoTotalMs` (60 s). Estourou → as que não começaram ficam sem registro e voltam primeiro no ciclo seguinte.
- Em início + `PRAZO_FINAL_MS` (100 s) a drenagem para de esperar o que estiver em andamento, chama `registrar` com o que tem e devolve. Sobram 50 s de posse para gravar e avançar o cursor.
- **Resultado incerto fica pendente.** A operação abandonada (tratamento, RPC, leitura) pode terminar depois, sem ninguém esperando. O ciclo seguinte começa pelo ledger: se o estorno aconteceu, conclui `sem-baixa-aberta`; se não, trata de novo. O estorno é idempotente por referência e o aviso por reserva.
- As funções de leitura do ML não aceitam sinal de cancelamento e `io.ts` não muda: a chamada abandonada segue até responder ou a execução terminar.

- [ ] **2.1 RED: testes** (IO falso em memória; F12–F14 e F18 usam funções **reais** de `_shared/` com dependências falsas).

| Caso | Cenário | Esperado |
|---|---|---|
| F1 | Para cada membro de `ResultadoCancelamento` devolvido por `tratar` (tabela `satisfies Record<ResultadoCancelamento, 'conclui' \| 'fica' \| 'confere-ledger'>`) | `avisado`/`silenciado` concluem; `reposto` confere o ledger; os demais ficam |
| F2 | `tratar` devolve `erro` | `concluir=false`; em novo ciclo a obrigação é tratada de novo |
| F3 | ML devolve `paid` com data ≤ `versao` (leitura velha enquanto o webhook confirma `cancelled`) | `ml: resposta antiga`, não conclui; `tratar` não chamado |
| F3b | ML devolve `paid` com data > `versao` | conclui `nao-cancelado`; `tratar` não chamado |
| F4 | ML devolve `cancelled` com data < `versao` | não conclui; `tratar` não chamado |
| F5 | `aindaPendente` falso | `tratar` não chamado; nenhum registro para o pedido |
| F6 | Resposta com `id` de outro pedido; resposta de outro vendedor; resposta sem `seller`; `last_updated` ausente | cada uma: não conclui, `tratar` não chamado |
| F6b | Fiação: conexão sem `contaExternaId` | a drenagem devolve zeros sem chamar `reivindicar` |
| F7 | 2 SKUs, `tratar` devolve `reposto`, releitura mostra 1 aberta | `reposicao-incompleta`, não conclui |
| F8 | O vínculo do item mudou depois da venda | os itens passados a `tratar` têm o `codigoRef` do ledger |
| F8b | `codigoRef='ABC:01'` | o item passado a `tratar` tem `codigo='ABC:01'`; `refBaixa('mercado_livre', pedido, 'ABC:01')` é igual à referência da baixa |
| F9 | Sem baixa aberta | conclui `sem-baixa-aberta`; nenhuma chamada a `pedido`, `envio` ou `tratar` |
| F10 | Ciclo 1 envio `ready_to_ship` → `reposto` e ledger limpo → conclui. Rearma. Ciclo 2 envio `cancelled` | ciclo 2 conclui `sem-baixa-aberta` sem chamar `tratar` |
| F11 | Estado misto com envio `shipped` | `parcial-sem-pre-despacho`; `tratar` não chamado. Com `handling` → `tratar` só com as abertas |
| F12 | Kit, ciclo 1: `tratarPedidoCancelado` real com `depsDaFila(base)`, crédito de participante falha | `pendente`; `base.registrarPendenciaKit` (espião) não chamado; não conclui |
| F13 | Kit, ciclo 2: ML devolve `paid` com data ≤ `versao` | não conclui; `tratar` não chamado; espião segue em 0 |
| F14 | Baixa adiada legítima preexistente na fila comum | o IO da fila não tem acesso a ela; nada é lido nem alterado |
| F15 | Lote de 20, **todos com baixa aberta**, 5 deles itens de kit | exatamente 20 leituras de pedido, no máximo 20 de envio, `ledger` 1 + (nº de `reposto`) vezes, `kitLigado` 1 vez, `registrar` 1 vez, `reivindicar` 1 vez |
| F16 | Estrutural: texto de `cancelamentos.ts` | não contém `refazerBaixaAdiada`, `worker_pendencias`, `desfechoKit`, `upsertVenda`, `lerPendenciasKit`, `ehVendaDaConta` |
| F17 | `drenagemLigada` | `undefined` e `''` → falso; `'1'` → verdadeiro; lista → só para os ids listados |
| F18 | Item do ledger sem `ml_item_id`: `classificarItensKit` e `gravarIdentidades` reais com `incerto=false` | o item volta em `certos` com o mesmo código |
| F19 | Sequência `cancelled@30 → cancelled@10 → paid@20` em `raw`; ML ao vivo `cancelled@30` | trata (a `versao` usada é 30, não a de `raw`) |
| F20 | Sequência `cancelled@30 → paid@10 → paid@40`; ML ao vivo `paid@40` | conclui `nao-cancelado` |
| F21 | Baixa depois da confirmação: ciclo 1 conclui `sem-baixa-aberta`; entra baixa aberta; ciclo 2 (obrigação reaberta pela RPC, simulada no IO) com ML `cancelled` e envio `shipped` | `tratar` chamado com a baixa nova; conclui `avisado` |
| F22 | Conclusão sem `lidoEm` | a drenagem registra `concluir=false` (`sem instante do ledger`) em vez de concluir |
| F23 | Relógio falso: `pedido` de uma obrigação nunca responde | depois de 10 s vira `ml: tempo esgotado`, não conclui; as outras 19 seguem |
| F24 | Relógio falso: lote de 20 com respostas de 9 s cada; orçamento de 20 s | as que começaram terminam e são registradas; as que não começaram não têm registro e contam em `pendentes`; `registrar` chamado 1 vez; a função retorna |
| F26 | Pedido com `shipping.id`; `envio` devolve `null`; depois, `envio` devolve objeto sem `status` | nas duas: `ml: envio não lido`, não conclui, `tratar` não chamado. Pedido **sem** `shipping.id` segue para `tratar` com `temEnvio=false` |
| F27 | Relógio falso: `tratar` de uma obrigação nunca responde | depois de 30 s vira `tratamento: tempo esgotado`, não conclui; as outras seguem; no ciclo seguinte, com o ledger já sem baixa aberta, conclui `sem-baixa-aberta` sem chamar `tratar` |
| F28 | Relógio falso, uma dependência por vez nunca responde: `ledger`, `aindaPendente`, `kitLigado`, `registrar`, `reivindicar` | em todos a função retorna ou lança em menos de `PRAZO_FINAL_MS` + 10 s; nenhuma obrigação é concluída sem evidência |
| F29 | Início da execução 55 s antes da drenagem; respostas de 9 s | quase nada começa; o que não começou fica sem registro |
| F30 | Início da execução 61 s antes | `reivindicar` não é chamado; devolve zeros |
| F31 | `registrar` nunca responde (gravou ou não, incerto) | a drenagem lança em menos de `PRAZO_FINAL_MS` + 10 s; no ciclo seguinte, ledger limpo → `sem-baixa-aberta`; `avisado` repetido → `silenciado` conclui |
| F32 | ML responde sem `status` (`undefined`, `null`, `''`) com data mais nova | `ml: sem status`, não conclui, `tratar` não chamado |
| F25 | Corrida da rodada 3: obrigação G1 (`versao` @30); ML ao vivo `paid@40`; antes do `registrar`, a geração da linha muda (IO falso que só aceita a geração corrente) | o registro `nao-cancelado` com G1 não conclui nada; no ciclo seguinte, com `versao` @50 e ML `cancelled@50`, trata |

- [ ] **2.2 Rodar e ver falhar:** `pnpm vitest run supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts`.
- [ ] **2.3 GREEN: implementar** conforme o contrato e a regra.
- [ ] **2.4** Rodar verde. Commit: `feat(reconciliar): drenagem da obrigação de cancelamento (ADR-0211)`.

## Task 3 — Chamada em `passo.ts`

**Files:** `supabase/functions/reconciliar-faturamento/passo.ts`, `__tests__/passo.test.ts`

- [ ] **3.1 RED: testes.**

| Caso | O que prova |
|---|---|
| P1 | Nenhum cursor novo: o conjunto de etapas em `proximo` é o de hoje |
| P2 | Com pendências na fila comum, o último lote devolve `pendencias|<último id>`. A execução seguinte, com a fila comum vazia, chama `drenarCancelamentos(params.ate)` e devolve `perguntas|`. Ajustar o teste existente "25 pendências" |
| P3 | `drenarCancelamentos` lança → o passo não lança, devolve `perguntas|` e `acumulado.cancelamentosErro = 1` |
| P4 | Repetição da mesma execução: a drenagem é chamada de novo com o **mesmo** `params.ate` |
| P5 | Fim da rodada: `cancelamentosPendentes > 0` ou `cancelamentosErro > 0` → `parcial` com o texto novo; os dois zerados → `parcial` igual ao de hoje |
| P6 | Na execução da drenagem, `processarPedidos` e `registrarPendencias` não são chamados |
| P7 | A drenagem devolve com parte do lote pendente por prazo | o passo devolve `perguntas|` (o cursor avança) e a rodada termina `parcial` |
| P8 | A drenagem lança por prazo de `registrar` ou `reivindicar` | o passo devolve `perguntas|` com `cancelamentosErro = 1` |
| P9 | `inicioMs` passado à drenagem | é o instante capturado na entrada do passo, antes de `conexao`, `token` e `pendencias` |

- [ ] **3.2 Rodar e ver falhar.**
- [ ] **3.3 GREEN.** Em `DepsReconciliar`:

```ts
  /** ADR-0211: um lote da fila de cancelamento, fixado por `lote`. Devolve zeros quando desligada. */
  drenarCancelamentos(token: string, cx: ConexaoCanal, userId: string, lote: string, inicioMs: number): Promise<{ concluidos: number; pendentes: number }>;
```

Na etapa `pendencias`:

```ts
      if (ids.length === 0) {
        // ADR-0211: a drenagem roda sozinha nesta execução e nunca segura as etapas seguintes.
        let acc = acumulado;
        try {
          const d = await deps.drenarCancelamentos(token, cx, userId, params.ate, inicioMs);
          acc = somar(somar(acc, 'cancelamentosTratados', d.concluidos), 'cancelamentosPendentes', d.pendentes);
        } catch (e) {
          console.error(`reconciliar: drenagem de cancelamentos da org ${orgId} falhou: ${(e as Error)?.message ?? e}`);
          acc = somar(acc, 'cancelamentosErro', 1);
        }
        return { proximo: ir('perguntas'), acumulado: acc };
      }
      …
      // Sempre volta a `pendencias`: a execução com a fila comum vazia é a que drena os cancelamentos.
      return { proximo: ir('pendencias', ids[ids.length - 1]), acumulado: acc };
```

Em `fim`:

```ts
  const canc = (acumulado.cancelamentosPendentes ?? 0) + (acumulado.cancelamentosErro ?? 0);
  const partes = [
    pendentes > 0 ? `${pendentes} pedido(s) pendente(s)`
      : descartados > 0 ? `${descartados} pedido(s) descartado(s) após 5 tentativas` : null,
    canc > 0 ? `${acumulado.cancelamentosPendentes ?? 0} cancelamento(s) aguardando tratamento` : null,
  ].filter(Boolean);
  return { proximo: null, acumulado, parcial: partes.length ? partes.join('; ') : null };
```

- [ ] **3.4** Rodar verde. Commit: `feat(reconciliar): drena cancelamentos no fim das pendências (ADR-0211)`.

## Task 4 — Fiação em `index.ts`

**Files:** `supabase/functions/reconciliar-faturamento/index.ts`

- [ ] **4.1** Em `depsReal`, a dep nova. Nenhuma linha existente de `processarPedidos` muda.

```ts
    async drenarCancelamentos(token, cx, userId, lote, inicioMs) {
      if (!drenagemLigada(Deno.env.get('DRENAR_CANCELAMENTOS'), orgId)) return { concluidos: 0, pendentes: 0 };
      if (!cx.contaExternaId) {
        console.warn(`reconciliar: drenagem de cancelamentos pulada na org ${orgId}: conexão sem conta externa`);
        return { concluidos: 0, pendentes: 0 };
      }
      const deps = depsDaFila(depsCancelamento);
      return await drenarCancelamentos({
        contaExternaId: String(cx.contaExternaId),
        reivindicar: (l) => /* rpc reivindicar_cancelamentos(orgId, l, LOTE_CANCELAMENTOS, CARENCIA); erro lança */,
        ledger: (ids) => /* rpc cancelamento_baixas(orgId, ids) agrupado por order_id; erro lança */,
        pedido: (id) => buscarPedido(token, id),
        envio: (id) => buscarShipment(token, id),
        aindaPendente: (o) => /* select id de ml_vendas por id + geracao + concluido_em nulo; erro lança */,
        kitLigado: async () => (await catalogoDe(userId, orgId)).kitLigado,
        tratar: (p) => tratarPedidoCancelado(admin, deps, { ...p, orgId, userId, canal: 'mercado_livre' }),
        registrar: (itens) => /* rpc registrar_cancelamentos_tratados(orgId, itens); erro lança */,
        agora: () => Date.now(),
      }, lote, Number(Deno.env.get('DRENAR_CANCELAMENTOS_PRAZO_MS')) || PRAZO_TOTAL_MS, inicioMs);
    },
```

- [ ] **4.2** `buscarShipment` devolve `null` em erro de rede ou HTTP. A fiação repassa o `null` sem interpretar; quem decide é a drenagem (regra 4 da Task 2): com `shipping.id` presente, envio não lido deixa a obrigação **pendente** e o tratamento não é chamado. `tratarPedidoCancelado` só recebe `shipmentStatus` nulo quando o pedido não tem envio.
- [ ] **4.3 Verificar:** `pnpm vitest run supabase/functions/reconciliar-faturamento` verde; typecheck do `pnpm preflight:static` sem erro.
- [ ] **4.4** Commit: `feat(reconciliar): fiação da drenagem de cancelamentos (ADR-0211)`.

## Task 5 — Caracterização do que não muda

**Files:** só testes.

- [ ] **5.1** B1 e B2 em `backfill-faturamento/__tests__/passo.test.ts` (ver "Teste por risco" 6 e 7).
- [ ] **5.2** B3 em `backfill-faturamento/__tests__/manual.test.ts`: `processarConexao` com um pedido `cancelled` cujo `upsertVenda` funciona e um `paid` cujo `upsertVenda` falha → `sincronizados=1`, `pedidosComFalha=1`, não lança.
- [ ] **5.3** I1 em `_shared/faturamento/__tests__/io.test.ts`: a linha que `upsertVenda` envia ao banco não tem chave começando por `cancelamento_`.
- [ ] **5.4** Os quatro passam **sem alterar código de produção**. Commit: `test: travas de regressão do ADR-0211`.

## Task 6 — Medição de custo antes de ligar (portão do ADR-0173)

Três medições, nesta ordem. `DRENAR_CANCELAMENTOS=1` só depois das três.

- [ ] **6.1 Contagem determinística (antes do deploy):** F15, com lote cheio de 20 baixas abertas incluindo kit. Fixa o teto de chamadas por lote.

- [ ] **6.2 Ensaio medido, sem dado de cliente (depois da migration, antes de ligar).** O script `scripts/ensaio-drenagem-cancelamentos.ts` (Deno, local) roda `drenarCancelamentos` **real**, com as três RPCs reais, `tratarPedidoCancelado` real e `depsDaFila(depsCancelamento)` real. Só `pedido` e `envio` são fixos.

  **Onde roda.** Duas opções, nesta ordem de preferência:

  - **A. Branch de banco do Supabase.** Descartável; nada toca a produção. Em 24/11 a lista de branches do projeto está vazia; não foi verificado se o plano permite criar. Só usar se o Diego confirmar.
  - **B. Produção, em org criada só para o ensaio.** Exige OK explícito do Diego sobre a prévia abaixo.

  **Regras da opção B:**

  - Três orgs, criadas pela tela só para o ensaio, uma por cenário: `ENSAIO ADR-0211 A` (rodada normal), `ENSAIO ADR-0211 B` (rodada lenta) e `ENSAIO ADR-0211 C` (reabertura). Módulo `kit_variacao` ligado. Sem conexão ML. O teto do lote e a reabertura são por org: separar pedidos ou SKUs na mesma org não isola os cenários.
  - Os 20 SKUs são criados só para o ensaio, com saldo próprio de 10 unidades cada. 5 são marcados participantes de kit com variação por linhas de fixture (sem anúncio: a saga não tem alvo e não escreve no ML). Nenhum SKU de cliente participa.
  - **Prévia antes de qualquer escrita.** O script imprime, para cada uma das três orgs: nome e id; contagem de linhas da org em `ml_vendas`, `estoque_movimentos`, `variacoes`, `marketplace_connections`, `anuncios_externos`; a lista exata do que vai inserir. Recusa continuar se: os três ids (`ENSAIO_ORG_A`, `ENSAIO_ORG_B`, `ENSAIO_ORG_C`) não forem distintos; algum nome não for o exato do seu cenário; a org tiver conexão, anúncio ou venda; ou a org tiver SKU que não seja do ensaio. O Diego confere a prévia e só então o script roda com `--executar`.
  - Toda mutação do script leva o `org_id` da org de ensaio do cenário no filtro ou no valor. No fim, o script confere que nenhuma linha de outra org mudou: contagem e maior `criado_em`/`atualizado_em` de `ml_vendas` e `estoque_movimentos` das outras orgs, antes e depois, só podem diferir por atividade normal (o script lista as diferenças para conferência).
  - **Nada é apagado do ledger.** Os SKUs, as vendas sintéticas e os movimentos do ensaio ficam na org de ensaio, que não tem cliente. Não há limpeza que possa deixar saldo sem lastro.

  **Como rodar** (prévia primeiro; `--executar` só depois do OK do Diego). A chave de serviço vem do painel; nunca é impressa:

  ```bash
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  ENSAIO_ORG_A=<uuid> ENSAIO_ORG_B=<uuid> ENSAIO_ORG_C=<uuid> \
  deno run --node-modules-dir=none -A --env-file=.env.local scripts/ensaio-drenagem-cancelamentos.ts [--executar]
  ```

  O script cria os SKUs `ENS0211-<org>-NN` (lote, família, variações e entrada de 10 por `registrar_entrada`) e, na org A, um kit rascunho com 5 participantes.

  **Passos do script (iguais nas duas opções):**

  1. Linha em `worker_rodadas` para a org de ensaio (`job='reconciliar'`, `estado='rodando'`, `params.ate` = lote do ensaio), exigida pela RPC.
  2. 20 linhas em `ml_vendas` com `order_id` de faixa inventada (`9000000000000001` em diante) e `raw.status='paid'`.
  3. Baixa de cada uma pela função real (`registrarBaixaVenda`).
  4. `raw.status='cancelled'` em cada uma (o trigger real arma).
  5. Drenagem com carência `'0 seconds'`: 10 pedidos com envio `ready_to_ship`, 10 com `shipped`. Antes de medir, confere que os 20 ids reivindicados são os 20 criados.
  6. (Sem espera.) Esperar não muda `m.criado_em > concluido_em - 5 min`: os `avisado` da org A reabrem no próximo `reivindicar` da org A, por desenho. Por isso cada cenário tem a sua org.
  7. Rodada **lenta**, na org B: 20 vendas sintéticas, `pedido` fixo com atraso de 15 s. Antes de medir, o script confere que os 20 ids reivindicados são exatamente os 20 criados na org B; se não forem, aborta sem medir. Confere que a drenagem retorna em menos de 60 s com as 20 pendentes por `ml: tempo esgotado`.
  8. Reabertura, na org C: 2 vendas com baixa, canceladas, drenadas com envio `ready_to_ship` (`reposto`). Depois, uma baixa nova em um dos dois pedidos com **outra** referência (outro SKU de ensaio: a RPC de baixa recusa repetir a referência original). Reivindicar com lote novo → só esse pedido reabre (conferir o id e que o outro não reabriu).

  **Mede:** tempo total, tempo de cada RPC, idas ao banco, CPU do processo (`process.cpuUsage()`).

  **Confere:** 10 `reposto` com saldo de volta a 10 e ledger limpo; 10 `avisado` com saldo em 9; 20 linhas com o lote; nenhuma linha das orgs de ensaio em `worker_pendencias`.

  **Aceite:** CPU do processo abaixo de 500 ms no lote; tempo total da rodada normal abaixo de 30 s; `reivindicar_cancelamentos` abaixo de 200 ms. Rodar também `explain analyze` do `select` interno da reabertura para a maior org (somente leitura) e registrar o tempo.

  **O que este ensaio não mede:** as duas leituras reais do ML por pedido e a posse/cursor da função deployada. Isso é o 6.3.

- [ ] **6.3 Canário em produção:** ligar `DRENAR_CANCELAMENTOS` só para duas orgs, uma delas com `kit_variacao`. Observar 24 ciclos: campo `ms` do log `[rodada] lote` da execução que segue para `perguntas|`; métricas `CPUTime`, `WORKER_RESOURCE_LIMIT`, `IDLE_TIMEOUT`. Aceite: zero erro de limite; `ms` abaixo de 60.000; CPU no patamar do ADR-0173 (mediana ~200 ms, máximo < 500 ms).

  **Prazo na Edge:** em um dos ciclos do canário, com obrigação pendente na org, definir `DRENAR_CANCELAMENTOS_PRAZO_MS=1`. Esperado na função deployada: a drenagem não reivindica nada (prazo vencido na entrada lança `sem tempo`), `cancelamentosErro = 1`, cursor em `perguntas|` e rodada concluída `parcial` ("drenagem de cancelamentos falhou"). Remover a variável em seguida; o ciclo seguinte trata o lote.

- [ ] **6.4** Fora do aceite em qualquer das três: não ligar, voltar ao desenho. Dentro: `DRENAR_CANCELAMENTOS=1` e registrar os números no ADR-0211.

Limite conhecido: o acervo não arma, então o canário verá lotes pequenos. O lote cheio é coberto pelo 6.1 (contagem) e pelo 6.2 (execução real sem ML). Lote cheio com ML lento **na Edge** não é reproduzido: o 6.2 cobre o código (fora da Edge) e o 6.3 cobre o caminho de prazo na Edge com o lote que houver.

## Task 7 — Portão, revisão e documentação

- [ ] **7.1** `pnpm preflight` verde.
- [ ] **7.2** Estes comandos saem vazios:
  - `git diff origin/main --stat -- supabase/functions/backfill-faturamento/index.ts supabase/functions/backfill-faturamento/passo.ts`
  - `git diff origin/main --stat -- supabase/functions/_shared/estoque/ supabase/functions/_shared/rodada/ supabase/functions/_shared/faturamento/pendencias.ts supabase/functions/_shared/faturamento/io.ts supabase/functions/reconciliar-faturamento/kit.ts`
- [ ] **7.3** Revisão independente (ver Classificação). Entregar ao revisor as tabelas "Pontos da rodada 4", "3", "2", "1" e "Teste por risco" e pedir veredito por linha.
- [ ] **7.4** Docs: ADR-0211 → `Aceito` com os SHAs e a medição; emenda de uma linha no ADR-0121 apontando para o 0211; linha no `docs/decisions/README.md`; `docs/TASKS.md`; `docs/project-status.md`. Seguir a skill `docs-update-checklist`. O repositório é público: nenhum id de org, nome de comprador ou lista de pedidos nos docs.
- [ ] **7.5** Atualizar o Graphify (skill `graphify-update-maintenance`).

## Task 8 — Deploy

- [ ] **8.1** Rodar V0 e guardar a saída fora do repositório.
- [ ] **8.2** Push → CI verde → merge fast-forward na `main` → `supabase db push` → `npm run db:check`. Rodar o `db push` fora dos minutos :00 (reconciliar), :40 (`renovar-tokens-ml`) e de 06:30 UTC (backfill). A migration tem `lock_timeout` de 3 s: se não conseguir a trava de `ml_vendas`, falha sem ter mudado nada e é só repetir. O trigger começa a armar; ninguém drena.
- [ ] **8.3** Rodar V1 e V2.
- [ ] **8.4** `supabase functions deploy reconciliar-faturamento`. Conferir a versão ativa. **Só esta função.** Sem a variável, a drenagem continua desligada.
- [ ] **8.5** Ensaio medido na org de ensaio (6.2), canário (6.3) e aceite. Só depois `DRENAR_CANCELAMENTOS=1`.
- [ ] **8.6** Deletar a branch, remover o worktree, `git pull --ff-only` no checkout principal.

A ordem migration → função é a recomendada, mas a inversa não derruba nada: a drenagem falha, registra o erro e o reconciliar segue.

## Verificação pós-deploy (somente `SELECT`)

**V0 — linha de base do acervo.** Mesma evidência que a fila usa: estorno efetivo é `estorno_venda` com quantidade > 0, e cancelado é o que o ML disse (`raw`).

```sql
with baixa as (
  select m.org_id, split_part(m.referencia_externa, ':', 2) order_id
    from public.estoque_movimentos m
   where m.motivo = 'venda' and m.quantidade < 0 and m.referencia_externa like 'mercado\_livre:%'
     and not exists (select 1 from public.estoque_movimentos e
                      where e.org_id = m.org_id and e.motivo = 'estorno_venda' and e.quantidade > 0
                        and e.referencia_externa = 'estorno:' || m.referencia_externa)
   group by 1, 2)
select b.org_id, b.order_id, n.chave is not null avisado
  from baixa b
  join public.ml_vendas v on v.org_id = b.org_id and v.order_id::text = b.order_id
                         and v.raw->>'status' = 'cancelled'
  left join public.ml_notificacoes_enviadas n
         on n.org_id = b.org_id and n.entidade = 'estoque_cancelado_despachado' and n.chave = b.order_id;
```

Medido em 24/11/2026: 388 pedidos, 77 com `avisado = false`.

**V1 — objetos e permissões (logo após a migration).**

```sql
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.ml_vendas'::regclass and not tgisinternal;
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'ml_vendas';
select proname, pg_get_userbyid(proowner) dono, prosecdef, proconfig::text, proacl::text from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('ml_vendas_cancelamento_fila', 'reivindicar_cancelamentos',
                   'cancelamento_baixas', 'registrar_cancelamentos_tratados');
```

Esperado: 2 triggers; 1 política em `ml_vendas` (a de `SELECT` por org, como antes); as 3 RPCs com dono `postgres`, `prosecdef = true`, `search_path=""`, execute só para `postgres` e `service_role`; a função do trigger com `prosecdef = false`.

**V2 — sem rajada (logo após a migration).**

```sql
select count(*) from public.ml_vendas where cancelamento_geracao is not null;
```

Esperado: 0, ou só os cancelamentos dos minutos desde o `db push`.

**V3 — a fila anda (com a variável ligada; repetir depois do backfill das 06:30 UTC).**

```sql
select org_id, order_id, cancelamento_versao, cancelamento_armado_em, cancelamento_lote, cancelamento_tentativas,
       cancelamento_desfecho, cancelamento_concluido_em
  from public.ml_vendas where cancelamento_geracao is not null order by cancelamento_armado_em desc limit 100;
select org_id, ciclo, estado, cursor, erro, acumulado->>'cancelamentosTratados' tratados,
       acumulado->>'cancelamentosPendentes' pendentes, acumulado->>'cancelamentosErro' erros
  from public.worker_rodadas where job = 'reconciliar';
```

Esperado: nenhuma obrigação armada há mais de 2h com `tentativas = 0`; `erros` nulo; no máximo 20 linhas por org com o mesmo `cancelamento_lote`.

**V4 — o problema parou.** Rodar V0 de novo e comparar com a linha de base. Pedido novo com `avisado = false` só é aceitável se estiver pendente na fila:

```sql
select org_id, order_id, cancelamento_desfecho, cancelamento_tentativas from public.ml_vendas
 where cancelamento_geracao is not null and cancelamento_concluido_em is null;
```

Para conferir um pedido específico:

```sql
select referencia_externa, motivo, quantidade, criado_em from public.estoque_movimentos
 where org_id = '<org>' and referencia_externa like '%mercado\_livre:<order_id>:%' order by criado_em;
select entidade, chave, enviado_em from public.ml_notificacoes_enviadas
 where org_id = '<org>' and chave = '<order_id>';
```

**V5 — obrigação parada (semanal, até entrar na rotina).**

```sql
select org_id, order_id, cancelamento_armado_em, cancelamento_tentativas, cancelamento_desfecho
  from public.ml_vendas
 where cancelamento_geracao is not null and cancelamento_concluido_em is null and cancelamento_tentativas >= 3
 order by cancelamento_tentativas desc;
```

Esperado: vazio. `reposicao-incompleta` e `parcial-sem-pre-despacho` pedem olhar o ledger do pedido; `ml: …` repetido pede olhar o pedido no ML.

**V6 — a fila comum não foi tocada.**

```sql
select obrigatoria, descartado_em is not null descartada, count(*) from public.worker_pendencias group by 1, 2;
```

Esperado: nenhuma linha criada pela drenagem. Em 24/11/2026 a tabela estava vazia.

## Reparo do acervo (separado do deploy, sem código)

Os 388 pedidos (V0) já estão `cancelled` e **não** entram na fila nova. O reparo é do operador de cada org, com conferência física.

Regras:

- Nenhum estorno em lote. Nenhum script escreve em `estoque_movimentos`. Nenhuma chamada a `estornar_estoque` pelo agente.
- Toda correção é entrada manual pela tela de Estoque, feita pelo operador, um SKU por vez.
- O agente só lê: monta a planilha e entrega.
- A planilha fica fora do repositório (repo público).

Passos:

- [ ] **R1** Rodar V0 e enriquecer cada linha (uma consulta por org) com: SKU e quantidade da baixa, `ml_vendas.shipping_status`, data da venda, claim mais recente (`ml_devolucoes`), e os movimentos manuais do SKU **depois** da baixa, com motivo, quantidade, `estoque_anterior`, `estoque_resultante`, observação e data. No ledger de hoje os motivos manuais são `entrada` (soma) e `ajuste`.
- [ ] **R2** Classificar cada linha. Uma `entrada` posterior **não** absorve a baixa: ela soma ao saldo e a diferença continua. Um `ajuste` também pode preservá-la (ajuste por perda, por exemplo). O ledger não distingue contagem física de outro ajuste, então o grupo A depende de confirmação do operador.

| Grupo | Critério | Ação sugerida ao operador |
|---|---|---|
| A | Houve `ajuste` do SKU depois da baixa **e** o operador confirma uma das duas: (1) foi contagem física do saldo inteiro **feita com a unidade deste pedido já de volta na prateleira** (ou o pedido nunca saiu e a unidade estava lá); (2) foi correção que repôs exatamente esta baixa | Nada. A unidade já está no saldo |
| B | Não é A, e o envio está `delivered`, `shipped` ou `not_delivered` | Dar entrada manual só quando o produto voltar |
| C | Não é A, e o envio está `cancelled`, `pending`, `handling`, `ready_to_ship` ou nulo | Conferência física do SKU. Se a unidade está lá, entrada manual |

  Contagem feita com a mercadoria ainda em trânsito confirma o saldo daquele momento, sem a unidade: se ela voltar depois, o saldo fica abaixo do físico. Esse caso **não** é A: vai para B (dar entrada quando voltar).

  Na planilha, ajuste posterior sem confirmação aparece como "candidato a A: confirmar se a contagem incluiu a unidade deste pedido". Sem confirmação, o SKU vai para B ou C. Entrada posterior aparece só como informação.

- [ ] **R3** Entregar ao Diego uma planilha por org, ordenada por SKU, com o grupo e a ação. Os 77 sem aviso vêm destacados.
- [ ] **R4** O Diego decide como cada org recebe a lista. O sistema não dispara aviso em massa.
- [ ] **R5** Depois de cada org terminar, rodar V0 só dela. Os pedidos dos grupos A e B continuam na consulta; o fechamento é a planilha conferida, não a consulta zerada.
- [ ] **R6** Caso já decidido: pedido `2000019609391838` não é estornado (a contagem de 18/11 zerou o SKU depois da baixa).

## Fora de escopo

- Qualquer mudança no aviso de `cancelamento.ts` (decisão do Diego).
- Corrigir `houveBaixaDeVenda` nos caminhos antigos (aviso "não reposto" depois de estorno; ver ADR-0211, Achado fora do escopo).
- Impedir na origem a baixa obsoleta do `sync-venda` e dar controle de versão ao `upsertVenda` (a fila repara pela reabertura; mudar a origem pede ADR próprio).
- Drenar no caminho legado do reconciliar.
- Alerta automático de obrigação parada.
- Usar o histórico do envio como prova de pré-despacho (muda a decisão 3 do ADR-0121; pede ADR próprio).
- Tela para a fila.

## Medição (preencher ao fim)

classificação · modelos (principal e subagentes) · revisões · escalonamento
