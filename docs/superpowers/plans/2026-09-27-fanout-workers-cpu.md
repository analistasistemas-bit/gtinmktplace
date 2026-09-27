# Fan-out por org em lotes retomáveis (incidente CPU 546) — Implementation Plan (v6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acabar com os 546 (`CPU Time exceeded`) de `pulse-coletar`, `backfill-faturamento` e `reconciliar-faturamento`: cada mensagem QStash processa uma org e um lote limitado, sem perder pedido, lote nem notificação.

**Architecture:** O schedule existente vira disparador (1 mensagem por org), ligado por flag por função. Cada (job, org) tem uma linha em `worker_rodadas` que é a **fonte da verdade**: ciclo, `params` (janela/tier gravados na abertura), cursor (`etapa|pos`), acumulado e notificação pendente. Pedidos que falham ficam em `worker_pendencias`, **por org**, compartilhados pelos jobs que tratam pedido. A mensagem só aponta (job, org, ciclo). Cada execução toma uma **posse curta com identidade própria** (`lease_id`, 150 s), processa um lote, faz CAS do cursor com essa posse, publica a continuação (dedup pelo cursor resultante) e solta a posse. Qualquer situação em que a cadeia ainda precisa andar responde **500** (o QStash repete). Caminhos manuais não mudam de comportamento.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres (plpgsql `security definer`), QStash (`_shared/queue.ts`), vitest.

**Spec:** `docs/decisions/0173-fanout-por-org-workers-agendados-cpu.md` (ADR-0173). Revisões do Codex `gpt-6-astra`: diagnóstico APROVADO COM AJUSTES; plano v1–v5 REPROVADOS — esta v6 aplica a correção prescrita na 5ª revisão (falha nova em pendência descartada atualiza o carimbo). A divergência das liberações (Task 6) foi aceita pelo revisor na 3ª rodada.

## Global Constraints

- Limite que estoura: **2 s de CPU por requisição**. Relógio é só proteção secundária.
- Schedules do QStash **não mudam** (cron, body, retries). Nenhum schedule novo.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043).
- RPCs de escrita: `security definer set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`. RLS ligada, `select` só da própria org (`current_org_id()`), precedente `20260927084615_vendas_sku_trafego.sql:53-66`.
- Módulos puros (`_shared/rodada/rodada.ts`, `*/passo.ts`) sem import Deno/npm de runtime (o vitest carrega). `import type` é permitido.
- Mercado Livre / Mercado Pago: só GET (e o refresh OAuth já existente). Nenhuma escrita no ML.
- Caminho manual (JWT) de `pulse-coletar` e `backfill-faturamento`: comportamento inalterado, **provado por teste de caracterização** (Tasks 4 e 5).
- HTTP do consumidor: **200** para `executado|continua|obsoleta|concluida|sem_acesso`; **500** para `erro|ocupada|repetir`.
- Mensagens por org: `retries: 3` explícito (backoff do QStash 12 s → 148 s → ~30 min).
- Ciclo: um formato por job, ordenável como texto — dia BRT `YYYY-MM-DD` (`backfill`, `pulse-completo`), hora UTC `YYYY-MM-DDTHH` (`reconciliar`, `pulse-quente`), instante ISO do disparo (`backfill-recuperacao`). Os crons (`30 6`, `0 9`, `0 */6`, `0 *` UTC) disparam longe da virada do ciclo, e os retries do schedule (≤ ~35 min) não a atravessam; mesmo assim, a janela vale a **gravada na abertura** (a 1ª mensagem do ciclo), nunca a recalculada.
- Flags: `FANOUT_BACKFILL`, `FANOUT_PULSE`, `FANOUT_RECONCILIAR` = `'1'` ligam o disparador em fan-out; sem flag → caminho legado (código de hoje). O consumidor de `MsgOrg` fica sempre deployado.
- Repositório público: nenhum valor real de cliente em R$ em arquivo versionado.

## Review Focus

1. **Queda por CPU no meio do lote** (posse viva): retry → `ocupada`/500; com a posse vencida, o retry refaz o mesmo lote e a cadeia segue — Task 1 teste 2, Task 2 teste 3.
2. **Publicação ambígua da continuação** (aceita mas sem resposta, ou falha após o CAS) e **posse vencida no CAS**: o retry lê o cursor do banco; nunca repete lote, nunca devolve 200 com a cadeia parada — Task 2 testes 4, 6, 7.
3. **Duas primeiras aberturas concorrentes da mesma (job, org)**: uma executa, a outra recebe `ocupada` — Task 1 teste 1 (duas sessões).
4. **Pedido que falha no upsert** (inclusive na recuperação histórica, que não tem próximo ciclo): vira pendência **da org** em `worker_pendencias`; o backfill só registra, o reconciliar horário é o único que retoma e apaga (escopo completo, serializado por org), e o sucesso só apaga falha registrada **antes** do início da própria tentativa; na 5ª falha a pendência é marcada descartada, sem sumir; a rodada conclui `parcial`, não `ok` — Task 1 testes 8–8b, Task 4 testes 7–8, Task 6 teste 8. **Leitura de pedidos com buraco** é detectada e lança — Task 3.
5. **Notificação do Pulse**: registro in-app exatamente uma vez por (usuário, chave), nunca limpo sem ter sido gravado (leituras estritas de assinantes e módulo); Telegram é melhor esforço, no máximo uma vez — Task 1 teste 6, Task 2 testes 9–10, Task 3 `chave.test.ts`, Task 5.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_worker_rodadas.sql` (novo) | `worker_rodadas`; RPCs `abrir/avancar/concluir/liberar_execucao`, `marcar_notificado`, `registrar_falha_coleta_pulse`; colunas de tentativa em `pulse_produtos`; `notificacoes.chave` |
| `supabase/tests/worker_rodadas.sql` (novo) | Contrato das RPCs em Postgres real |
| `supabase/functions/_shared/rodada/rodada.ts` (novo) | Tipos, ciclo, cursor, dedup, `ehMsgOrg`, `executarMensagem` (puro) |
| `supabase/functions/_shared/rodada/deps.ts` (novo) | Fiação real (RPCs + publish), `publicarDisparo`, `fanoutAtivo` |
| `supabase/functions/_shared/notificacoes/config.ts` | `notificarCategoria(..., { chave })` idempotente |
| `supabase/functions/_shared/faturamento/io.ts` | + `buscarPedidosPeriodoEstrito` |
| `supabase/functions/_shared/faturamento/mensagens-io.ts` | + `buscarMensagensPackEstrito`, `upsertMensagensEstrito`, `listarPacksDeVendasEstrito` |
| `supabase/functions/_shared/faturamento/pendencias.ts` (novo) | Leitura/registro de pendências de pedido por org (`worker_pendencias`) |
| `supabase/functions/backfill-faturamento/passo.ts` (novo) | Passo: `pendencias` → `vendas` → `mensagens` |
| `supabase/functions/pulse-coletar/processar.ts` | `processarLoteProdutos` extraído; falha de coleta atômica |
| `supabase/functions/pulse-coletar/passo.ts` (novo) | Passo: `radar` → `produtos` |
| `supabase/functions/reconciliar-faturamento/passo.ts` (novo) | Passo: `pendencias` → `perguntas` → `claims` → `vendas` → `liberacoes` |
| os 3 `index.ts` | Roteamento: `MsgOrg` → consumidor; schedule → disparador (flag) ou legado; JWT → manual |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_worker_rodadas.sql` (via `supabase migration new worker_rodadas`)
- Create: `supabase/tests/worker_rodadas.sql`, `supabase/tests/worker_rodadas_concorrencia.sh`

**Interfaces (Produces, só `service_role`):**
- `abrir_execucao(p_job text, p_org uuid, p_ciclo text, p_params jsonb) returns table (resultado text, lease uuid, estado text, ciclo text, cursor text, acumulado jsonb, params jsonb, notificar_pendente boolean)` — sempre 1 linha; `resultado ∈ {'executar','ocupada','obsoleta','concluida','notificar_anterior'}`.
- `avancar_execucao(p_job text, p_org uuid, p_lease uuid, p_cursor_novo text, p_acumulado jsonb) returns boolean`
- `concluir_execucao(p_job text, p_org uuid, p_lease uuid, p_estado text, p_erro text, p_acumulado jsonb, p_notificar boolean) returns boolean`
- `liberar_execucao(p_job text, p_org uuid, p_lease uuid, p_erro text) returns void`
- `marcar_notificado(p_job text, p_org uuid, p_lease uuid) returns boolean`
- `registrar_pendencias_pedido(p_org uuid, p_ok text[], p_inicio timestamptz, p_falhas text[], p_erro text) returns table (descartados integer)` — **só o reconciliar passa `p_ok`**; o backfill só registra falhas
- `registrar_falha_coleta_pulse(p_org uuid, p_produto uuid) returns void`
- Tabela `worker_pendencias` (pendências de pedido **por org**, compartilhadas por `backfill`, `backfill-recuperacao` e `reconciliar`)
- `pulse_produtos.coleta_tentativa_em timestamptz`, `pulse_produtos.coleta_falhas_seguidas integer not null default 0`
- `notificacoes.chave text` + índice único `(user_id, chave)` (NULL não colide)

- [ ] **Step 1: Criar a migration** (`supabase migration new worker_rodadas`). **Ordem importa:** colunas e tabelas antes das funções que as usam (`check_function_bodies` valida o corpo SQL na criação).

```sql
-- ADR-0173: estado das rodadas por (job, org) dos workers agendados em fan-out.
-- A linha é a fonte da verdade (ciclo, params, cursor, acumulado, notificação pendente); a mensagem
-- QStash só aponta (job, org, ciclo). Cada execução toma uma posse curta com identidade própria
-- (lease), faz o CAS do cursor com ela e a solta no fim. Escrita só pelo service_role.

-- 1) Colunas/tabelas primeiro.
alter table public.pulse_produtos
  add column coleta_tentativa_em timestamptz,
  add column coleta_falhas_seguidas integer not null default 0 check (coleta_falhas_seguidas >= 0);

alter table public.notificacoes add column chave text;
create unique index notificacoes_user_chave_key on public.notificacoes (user_id, chave);

create table public.worker_rodadas (
  job                text not null check (job in ('pulse-completo','pulse-quente','backfill','backfill-recuperacao','reconciliar')),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  ciclo              text not null,     -- um formato por job, ordenável como texto (ver plano)
  estado             text not null check (estado in ('rodando','ok','parcial','sem_acesso')),
  params             jsonb not null default '{}'::jsonb,   -- janela/tier gravados na abertura do ciclo
  cursor             text,              -- 'etapa|pos'; null = início
  acumulado          jsonb not null default '{}'::jsonb,
  lease_id           uuid,
  lease_ate          timestamptz,
  notificar_pendente boolean not null default false,
  iniciado_em        timestamptz not null,
  ultimo_ok_em       timestamptz,
  ultimo_erro_em     timestamptz,
  erro               text,
  primary key (job, org_id)
);

-- Pedido que falhou no upsert, por org (qualquer job que processa pedido lê e grava aqui).
-- Descarte NÃO apaga: `descartado_em` preenchido tira da fila automática e deixa a falha terminal
-- visível e recuperável (limpar `descartado_em`/`tentativas` volta o pedido para a fila).
create table public.worker_pendencias (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  order_id      text not null,
  tentativas    integer not null default 1 check (tentativas >= 1),
  ultimo_erro   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  descartado_em timestamptz,
  primary key (org_id, order_id)
);
create index worker_pendencias_ativas_idx on public.worker_pendencias (org_id, order_id) where descartado_em is null;

alter table public.worker_rodadas    enable row level security;
alter table public.worker_pendencias enable row level security;
create policy "worker_rodadas: select org"    on public.worker_rodadas    for select to authenticated using (org_id = (select public.current_org_id()));
create policy "worker_pendencias: select org" on public.worker_pendencias for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.worker_rodadas, public.worker_pendencias from anon;
revoke insert, update, delete, truncate, references, trigger on public.worker_rodadas, public.worker_pendencias from authenticated;
grant select on public.worker_rodadas, public.worker_pendencias to authenticated;

-- 2) Funções.
create function public.abrir_execucao(p_job text, p_org uuid, p_ciclo text, p_params jsonb)
returns table (resultado text, lease uuid, estado text, ciclo text, cursor text, acumulado jsonb,
               params jsonb, notificar_pendente boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  w public.worker_rodadas%rowtype;
  novo uuid := gen_random_uuid();
begin
  -- A linha precisa existir ANTES do lock: FOR UPDATE não trava linha inexistente, e duas primeiras
  -- aberturas concorrentes disputariam o INSERT. Com o insert idempotente, a 2ª espera o lock da 1ª.
  insert into public.worker_rodadas (job, org_id, ciclo, estado, params, iniciado_em)
  values (p_job, p_org, p_ciclo, 'rodando', coalesce(p_params, '{}'::jsonb), now())
  on conflict (job, org_id) do nothing;
  select * into strict w from public.worker_rodadas r where r.job = p_job and r.org_id = p_org for update;

  if w.ciclo > p_ciclo then
    return query select 'obsoleta'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.lease_ate is not null and w.lease_ate > now() then
    return query select 'ocupada'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.ciclo < p_ciclo and w.notificar_pendente then
    -- Entrega primeiro a notificação do ciclo anterior (o chamador responde 500 e o retry abre o novo).
    update public.worker_rodadas r set lease_id = novo, lease_ate = now() + interval '150 seconds'
     where r.job = p_job and r.org_id = p_org;
    return query select 'notificar_anterior'::text, novo, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, true;
    return;
  end if;
  if w.ciclo < p_ciclo then
    -- Ciclo novo assume (o anterior terminou ou morreu com a posse vencida).
    update public.worker_rodadas r set ciclo = p_ciclo, estado = 'rodando', params = coalesce(p_params, '{}'::jsonb),
      cursor = null, acumulado = '{}'::jsonb, lease_id = novo, lease_ate = now() + interval '150 seconds',
      notificar_pendente = false, iniciado_em = now(), erro = null
     where r.job = p_job and r.org_id = p_org;
    return query select 'executar'::text, novo, 'rodando'::text, p_ciclo, null::text, '{}'::jsonb,
      coalesce(p_params, '{}'::jsonb), false;
    return;
  end if;
  -- mesmo ciclo
  if w.estado <> 'rodando' and not w.notificar_pendente then
    return query select 'concluida'::text, null::uuid, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, false;
    return;
  end if;
  update public.worker_rodadas r set lease_id = novo, lease_ate = now() + interval '150 seconds'
   where r.job = p_job and r.org_id = p_org;
  return query select 'executar'::text, novo, w.estado, w.ciclo, w.cursor, w.acumulado, w.params, w.notificar_pendente;
end;
$$;

create function public.avancar_execucao(p_job text, p_org uuid, p_lease uuid, p_cursor_novo text, p_acumulado jsonb)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas set cursor = p_cursor_novo, acumulado = p_acumulado
     where job = p_job and org_id = p_org and lease_id = p_lease and lease_ate > now() and estado = 'rodando'
    returning 1)
  select exists (select 1 from u);
$$;

-- Com p_notificar a posse é MANTIDA (renovada) até marcar_notificado: ninguém notifica em paralelo.
create function public.concluir_execucao(p_job text, p_org uuid, p_lease uuid, p_estado text, p_erro text,
                                         p_acumulado jsonb, p_notificar boolean)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas
       set estado = p_estado,
           acumulado = coalesce(p_acumulado, acumulado),
           notificar_pendente = coalesce(p_notificar, false),
           lease_id  = case when coalesce(p_notificar, false) then lease_id else null end,
           lease_ate = case when coalesce(p_notificar, false) then now() + interval '150 seconds' else null end,
           ultimo_ok_em   = case when p_estado in ('ok','parcial') then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado in ('parcial','sem_acesso') then now() else ultimo_erro_em end,
           erro           = case when p_estado in ('parcial','sem_acesso') then p_erro end
     where job = p_job and org_id = p_org and lease_id = p_lease and lease_ate > now() and estado = 'rodando'
       and p_estado in ('ok','parcial','sem_acesso')
    returning 1)
  select exists (select 1 from u);
$$;

create function public.liberar_execucao(p_job text, p_org uuid, p_lease uuid, p_erro text)
returns void
language sql security definer set search_path = '' as $$
  update public.worker_rodadas
     set lease_id = null, lease_ate = null,
         ultimo_erro_em = case when p_erro is not null then now() else ultimo_erro_em end,
         erro = coalesce(p_erro, erro)
   where job = p_job and org_id = p_org and lease_id = p_lease;
$$;

-- Chamado DEPOIS do envio in-app (idempotente pela chave). Solta a posse.
create function public.marcar_notificado(p_job text, p_org uuid, p_lease uuid)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas set notificar_pendente = false, lease_id = null, lease_ate = null
     where job = p_job and org_id = p_org and lease_id = p_lease
    returning 1)
  select exists (select 1 from u);
$$;

-- Atômico e por TENTATIVA. `p_inicio` = instante em que a tentativa bem-sucedida COMEÇOU: o sucesso só
-- apaga falha registrada ANTES disso — uma falha de outra execução registrada durante/depois (ex.: um
-- upsert concorrente que apagou itens e falhou ao reinserir, io.ts:380) sobrevive e é retomada.
-- Falha entra com 1 ou soma 1 (carimbo por chamada: clock_timestamp()); na 5ª recebe `descartado_em`
-- e continua na tabela. Devolve quantos foram descartados NESTA chamada (RETURNING do contador).
create function public.registrar_pendencias_pedido(p_org uuid, p_ok text[], p_inicio timestamptz,
                                                   p_falhas text[], p_erro text)
returns table (descartados integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare n integer;
begin
  delete from public.worker_pendencias
   where org_id = p_org and order_id = any(coalesce(p_ok, '{}')) and atualizado_em < p_inicio;
  with u as (
    insert into public.worker_pendencias as p (org_id, order_id, ultimo_erro, criado_em, atualizado_em)
    select p_org, x, p_erro, clock_timestamp(), clock_timestamp() from unnest(coalesce(p_falhas, '{}')) as x
    on conflict (org_id, order_id) do update
      -- SEMPRE atualiza carimbo/erro/contador, inclusive em pendência já descartada: senão um sucesso
      -- atrasado (p_inicio anterior a esta falha) acharia o carimbo velho e apagaria a linha. O descarte,
      -- uma vez marcado, permanece (coalesce).
      set tentativas = p.tentativas + 1, ultimo_erro = excluded.ultimo_erro, atualizado_em = clock_timestamp(),
          descartado_em = coalesce(p.descartado_em, case when p.tentativas + 1 >= 5 then clock_timestamp() end)
    returning p.tentativas as tentativas_depois)
  -- Descartado NESTA chamada ⇔ o contador acabou de chegar a 5 (ele nunca para de subir).
  select count(*) filter (where tentativas_depois = 5)::int into n from u;
  return query select n;
end;
$$;

-- Falha de leitura da ficha: incremento atômico e no máximo 1 por hora por produto.
create function public.registrar_falha_coleta_pulse(p_org uuid, p_produto uuid)
returns void
language sql security definer set search_path = '' as $$
  update public.pulse_produtos
     set coleta_falhas_seguidas = coleta_falhas_seguidas + 1, coleta_tentativa_em = now()
   where org_id = p_org and id = p_produto
     and (coleta_tentativa_em is null or coleta_tentativa_em < now() - interval '1 hour' or coleta_falhas_seguidas = 0);
$$;

revoke all on function public.abrir_execucao(text, uuid, text, jsonb)                          from public, anon, authenticated;
revoke all on function public.avancar_execucao(text, uuid, uuid, text, jsonb)                  from public, anon, authenticated;
revoke all on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean)  from public, anon, authenticated;
revoke all on function public.liberar_execucao(text, uuid, uuid, text)                         from public, anon, authenticated;
revoke all on function public.marcar_notificado(text, uuid, uuid)                              from public, anon, authenticated;
revoke all on function public.registrar_pendencias_pedido(uuid, text[], timestamptz, text[], text) from public, anon, authenticated;
revoke all on function public.registrar_falha_coleta_pulse(uuid, uuid)                         from public, anon, authenticated;
grant execute on function public.abrir_execucao(text, uuid, text, jsonb)                       to service_role;
grant execute on function public.avancar_execucao(text, uuid, uuid, text, jsonb)               to service_role;
grant execute on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.liberar_execucao(text, uuid, uuid, text)                      to service_role;
grant execute on function public.marcar_notificado(text, uuid, uuid)                           to service_role;
grant execute on function public.registrar_pendencias_pedido(uuid, text[], timestamptz, text[], text) to service_role;
grant execute on function public.registrar_falha_coleta_pulse(uuid, uuid)                      to service_role;
```

Antes de escrever, conferir em `supabase/migrations/` (`20260721094323_notificacoes_in_app.sql`) que `notificacoes.user_id` existe e que não há índice/constraint conflitante; e que `pulse_produtos` tem `org_id`.

- [ ] **Step 2: Teste SQL** (`supabase/tests/worker_rodadas.sql`, formato de `supabase/tests/vendas_sku_trafego.sql`). Vencer a posse: `update worker_rodadas set lease_ate = now() - interval '1 second'`.
  1. **Concorrência (duas sessões)** em `supabase/tests/worker_rodadas_concorrencia.sh` (precedente: `scripts/test-platform-billing-concurrency.sh`): sessão A `begin; select * from abrir_execucao('backfill', org, '2026-09-27', '{}');` sem commit; sessão B chama o mesmo e bloqueia; A `commit`; B recebe `ocupada`. Variante com a linha **ainda inexistente** nas duas sessões.
  2. `executar` → vencer a posse → `executar` com **lease diferente**; `avancar_execucao` com o lease antigo → `false`; com o novo → `true`.
  3. Mesmo ciclo, `p_params` diferente → devolve os `params` **gravados** na abertura.
  4. `concluir_execucao(... 'ok' ..., p_notificar => false)` → `true` e posse solta; `abrir` mesmo ciclo → `concluida`; ciclo anterior → `obsoleta`; ciclo novo → `executar` com cursor null e acumulado `{}`.
  5. `concluir(... 'parcial' ...)` grava `estado='parcial'`, `erro`, `ultimo_ok_em`.
  6. **Notificação:** `concluir(... p_notificar => true)` mantém a posse; `abrir` mesmo ciclo → `ocupada`; `marcar_notificado(lease)` → `true` e solta; `abrir` → `concluida`. Variante: `concluir(... true)`, vencer a posse, `abrir` com ciclo **novo** → `notificar_anterior` com ciclo/acumulado antigos; após `marcar_notificado`, `abrir` ciclo novo → `executar`.
  7. `concluir_execucao` com lease vencido → `false`. `liberar_execucao` zera a posse e grava `erro`.
  8. `registrar_pendencias_pedido(org, '{}', now(), '{7}', 'x')` → `tentativas=1`; mais 3 falhas → 4, `descartado_em` null; 5ª → `tentativas=5`, `descartado_em` preenchido, devolve `1`; 6ª → `tentativas=6`, `atualizado_em` e `ultimo_erro` atualizados, `descartado_em` **inalterado**, devolve `0` (inclusive **na mesma transação** da 5ª); sucesso com `p_inicio` posterior à última falha → linha apagada.
  8b. **Sucesso atrasado não apaga falha nova:** `t0 = clock_timestamp()`; registrar falha de `'9'` (carimbo > t0); depois `registrar_pendencias_pedido(org, '{9}', t0, '{}', null)` → a linha de `'9'` **continua**. Com `p_inicio` posterior à falha → apagada. **Variante descartada:** pendência `'9'` já com `descartado_em`; `t0 = clock_timestamp()`; nova falha de `'9'` → `atualizado_em > t0`; `registrar_pendencias_pedido(org, '{9}', t0, '{}', null)` → a linha **continua** (descartada, com o erro novo).
  9. `registrar_falha_coleta_pulse` 2x seguidas → `coleta_falhas_seguidas = 1`; recuando `coleta_tentativa_em` 2 h → 2.
  10. Dois inserts em `notificacoes` com a mesma `(user_id, chave)` → o 2º viola o índice; com `chave` null → ambos entram.
  11. Grants: `authenticated` sem `execute` nas 7 funções e sem `insert/update/delete` nas 2 tabelas; `service_role` com `execute`.
- [ ] **Step 3:** `npm run db:check`; aplicar a migration no Postgres local e rodar os testes por `psql -U supabase_admin` no container. Expected: sem `ERROR`; o script de concorrência imprime `ocupada` nas duas variantes.
- [ ] **Step 4: Commit** — `feat(rodadas): worker_rodadas, worker_pendencias, RPCs de execução, falha atômica do Pulse e chave de notificação (ADR-0173)`.

---

### Task 2: Protocolo compartilhado `_shared/rodada/`

**Files:**
- Create: `supabase/functions/_shared/rodada/rodada.ts`, `supabase/functions/_shared/rodada/deps.ts`
- Test: `supabase/functions/_shared/rodada/__tests__/rodada.test.ts`

**Interfaces (Produces):**

```ts
// rodada.ts (puro)
export type Job = 'pulse-completo' | 'pulse-quente' | 'backfill' | 'backfill-recuperacao' | 'reconciliar';
export type Acumulado = Record<string, number>;
export type ResultadoMsg = 'executado' | 'continua' | 'obsoleta' | 'concluida' | 'sem_acesso' | 'ocupada' | 'erro' | 'repetir';
export interface MsgOrg<P = Record<string, unknown>> { modo: 'org'; job: Job; org_id: string; ciclo: string; params: P }
export class SemAcessoRodada extends Error {}
export interface Cursor { etapa: string; pos: string }
export function lerCursor(c: string | null | undefined): Cursor | null;
export const gravarCursor = (c: Cursor): string => `${c.etapa}|${c.pos}`;
export const cicloDiaBrt = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const cicloHoraUtc = (d: Date): string => d.toISOString().slice(0, 13);
export const dedupMsg = (fn: string, m: Pick<MsgOrg, 'job' | 'org_id' | 'ciclo'>, cursor: string | null) =>
  `${fn}:${m.job}:${m.org_id}:${m.ciclo}:${cursor ?? 'inicio'}`.replace(/[^A-Za-z0-9_-]/g, '_');
export function ehMsgOrg(x: unknown): x is MsgOrg;
export interface EntradaPasso<P> { cursor: string | null; acumulado: Acumulado; params: P }
/** `parcial` = a rodada termina com pendência de pedido não resolvida (só lido quando `proximo === null`). */
export interface ResultadoPasso { proximo: string | null; acumulado: Acumulado; parcial?: string | null }
export type Passo<P = Record<string, unknown>> = (e: EntradaPasso<P>) => Promise<ResultadoPasso>;
export interface Abertura {
  resultado: 'executar' | 'ocupada' | 'obsoleta' | 'concluida' | 'notificar_anterior';
  lease: string | null; estado: string; ciclo: string; cursor: string | null; acumulado: Acumulado;
  params: Record<string, unknown>; notificarPendente: boolean;
}
export interface DepsRodada {
  abrir(m: MsgOrg): Promise<Abertura>;
  avancar(m: MsgOrg, lease: string, cursorNovo: string, acumulado: Acumulado): Promise<boolean>;
  concluir(m: MsgOrg, lease: string, estado: 'ok' | 'parcial' | 'sem_acesso', erro: string | null,
    acumulado: Acumulado | null, notificar: boolean): Promise<boolean>;
  liberar(m: MsgOrg, lease: string, erro: string | null): Promise<void>;
  marcarNotificado(m: MsgOrg, lease: string): Promise<boolean>;
  publicar(m: MsgOrg, cursor: string): Promise<void>;
}
export interface OpcoesMsg {
  precisaNotificar?: (acumulado: Acumulado) => boolean;
  /** Grava in-app com chave idempotente de (job, org, ciclo) e LANÇA se não conseguir; Telegram é
   *  melhor esforço (ver Task 3). Lança → 500 e retry. */
  notificar?: (acumulado: Acumulado, ciclo: string) => Promise<void>;
}
export async function executarMensagem<P>(deps: DepsRodada, m: MsgOrg<P>, passo: Passo<P>, op?: OpcoesMsg): Promise<ResultadoMsg>;
export const statusHttp = (r: ResultadoMsg): number => (r === 'erro' || r === 'ocupada' || r === 'repetir' ? 500 : 200);

// deps.ts
export function depsRodada(admin: SupabaseClient, fn: string): DepsRodada;
export async function publicarDisparo(fn: string, msgs: MsgOrg[]): Promise<number>;
export const fanoutAtivo = (flag: 'FANOUT_BACKFILL' | 'FANOUT_PULSE' | 'FANOUT_RECONCILIAR') => Deno.env.get(flag) === '1';
export const urlDaFuncao = (fn: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/${fn}`;
```

`executarMensagem` — implementar exatamente:

```ts
export async function executarMensagem(deps, m, passo, op = {}) {
  const a = await deps.abrir(m);
  if (a.resultado === 'obsoleta' || a.resultado === 'concluida' || a.resultado === 'ocupada') return a.resultado;
  const lease = a.lease!;
  const log = (ev: string, extra: Record<string, unknown> = {}) =>
    console.log(`[rodada] ${ev}`, { job: m.job, org_id: m.org_id, ciclo: m.ciclo, ...extra });

  // Notificação pendente (deste ciclo, ou do anterior antes de abrir o novo). A posse é nossa.
  if (a.resultado === 'notificar_anterior' || a.estado !== 'rodando') {
    try {
      if (a.notificarPendente && op.notificar) await op.notificar(a.acumulado, a.ciclo);
      await deps.marcarNotificado(m, lease);
    } catch (e) {
      await deps.liberar(m, lease, msgErro(e));
      log('notificacao falhou', { ciclo_notificado: a.ciclo, erro: msgErro(e) });
      return 'erro';
    }
    return a.resultado === 'notificar_anterior' ? 'repetir' : 'executado';  // repetir → 500 → abre o ciclo novo
  }

  const inicio = Date.now();
  let r: ResultadoPasso;
  try {
    r = await passo({ cursor: a.cursor, acumulado: a.acumulado, params: a.params as P });
  } catch (e) {
    if (e instanceof SemAcessoRodada) {
      await deps.concluir(m, lease, 'sem_acesso', msgErro(e), null, false);
      log('sem_acesso', { erro: msgErro(e) });
      return 'sem_acesso';
    }
    await deps.liberar(m, lease, msgErro(e));
    log('lote falhou', { cursor: a.cursor, erro: msgErro(e) });
    return 'erro';
  }
  log('lote', { cursor: a.cursor, proximo: r.proximo, ms: Date.now() - inicio });

  if (r.proximo === null) {
    const estado = r.parcial ? 'parcial' : 'ok';
    const notificar = !!op.precisaNotificar?.(r.acumulado);
    // false = a posse venceu durante o lote. NÃO é 'obsoleta': o retry refaz o último lote (idempotente).
    if (!(await deps.concluir(m, lease, estado, r.parcial ?? null, r.acumulado, notificar))) return 'erro';
    if (!notificar || !op.notificar) return 'executado';
    try { await op.notificar(r.acumulado, m.ciclo); await deps.marcarNotificado(m, lease); return 'executado'; }
    catch (e) { await deps.liberar(m, lease, msgErro(e)); log('notificacao falhou', { erro: msgErro(e) }); return 'erro'; }
  }

  if (!(await deps.avancar(m, lease, r.proximo, r.acumulado))) return 'erro'; // posse venceu → retry refaz
  try {
    await deps.publicar(m, r.proximo);
  } catch (e) {
    // Cursor já avançou no banco. O retry desta mensagem lê o cursor novo e segue a cadeia.
    await deps.liberar(m, lease, msgErro(e));
    log('publicar falhou', { proximo: r.proximo, erro: msgErro(e) });
    return 'erro';
  }
  await deps.liberar(m, lease, null);
  return 'continua';
}
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));
```

Limite conhecido e aceito (documentar no ADR): esgotados os 3 retries do QStash, a cadeia daquela (job, org) para até o próximo ciclo, que a assume do zero. As pendências de pedido não se perdem (estão em `worker_pendencias`, por org). Fica visível em `worker_rodadas` (linha `rodando` com posse vencida) — base do alarme do follow-up.

- [ ] **Step 1: Testes que falham** — `DepsRodada` falso que **reimplementa a semântica da Task 1 em memória** (linha por job+org, relógio falso para `lease_ate`):
  1. Mensagem nova → passo recebe `cursor:null` e os `params` da abertura; `proximo:'vendas|p1'` → `avancar` + `publicar(m,'vendas|p1')` + `liberar` → `continua`.
  2. `ocupada` → passo não chamado; `statusHttp` 500.
  3. **Queda por CPU**: 1ª execução não libera; retry +12 s → `ocupada`; +160 s → passo com o **mesmo** cursor.
  4. **Posse vence durante o lote** (`avancar` → false) → `erro` (500), nunca `obsoleta`; retry refaz o lote. Idem com `concluir` → false.
  5. Passo lança `Error` → `liberar` + `erro`; `SemAcessoRodada` → `concluir('sem_acesso')` + 200.
  6. **`publicar` lança após o `avancar`** → `erro`; retry recebe o cursor novo e segue; cursor nunca volta.
  7. **Entrega duplicada** da mesma mensagem → a 2ª processa o lote seguinte, nunca repete cursor.
  8. `proximo:null` sem `parcial` → `concluir('ok')`; com `parcial:'2 pedido(s) pendente(s)'` → `concluir('parcial', '2 pedido(s) pendente(s)')`.
  9. `precisaNotificar` true: `concluir(..., notificar:true)` → `notificar(acumulado, ciclo)` → `marcarNotificado`; se `notificar` lança → `erro`; retry (mesmo ciclo, estado `ok`, pendente) → `notificar` de novo → `executado`; próxima entrega → `concluida`.
  10. `notificar_anterior` → `notificar(acumulado_antigo, ciclo_antigo)` → `marcarNotificado` → `repetir` (500); retry → abre o ciclo novo e roda o passo.
  11. Utilitários: `lerCursor('vendas|123')`, `lerCursor('radar|')`, `lerCursor(null)`; `cicloDiaBrt(new Date('2026-09-28T02:30:00Z'))` → `'2026-09-27'`; `cicloHoraUtc` → `'2026-09-28T02'`; `dedupMsg` só `[A-Za-z0-9_-]`; `ehMsgOrg({tier:'completo'})`/`ehMsgOrg({dias:7})` → false.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/rodada` → FAIL.
- [ ] **Step 3:** Implementar. `publicar` = `qstashClient().publishJSON({ url: urlDaFuncao(fn), body: m, retries: 3, deduplicationId: dedupMsg(fn, m, cursor) })`; `publicarDisparo` idem com `cursor=null`, sequencial, lança no fim se algum falhou.
- [ ] **Step 4:** PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(rodadas): protocolo de execução por org com posse, CAS e notificação durável (ADR-0173)`.

---

### Task 3: Leituras/gravações estritas, pendências e notificação idempotente

**Files:**
- Modify: `supabase/functions/_shared/faturamento/io.ts` (novo `buscarPedidosPeriodoEstrito` ao lado de `buscarPedidosPeriodo:272-307`, que fica igual)
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts` (estritas ao lado das atuais, que ficam iguais)
- Modify: `supabase/functions/_shared/notificacoes/config.ts:23-81`
- Create: `supabase/functions/_shared/faturamento/pendencias.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/estritos.test.ts`, `__tests__/pendencias.test.ts`, `supabase/functions/_shared/notificacoes/__tests__/chave.test.ts`

**Interfaces (Produces):**

```ts
// io.ts
export const TETO_PEDIDOS_JANELA = 5000;
/** Mesma varredura de buscarPedidosPeriodo, mas com COBERTURA VERIFICÁVEL: qualquer página não-2xx ou
 *  exceção lança; `paging.total` > TETO lança (janela grande demais — encurtar); ao fim, deduplica por
 *  id e exige `ids únicos === paging.total` E total igual na 1ª e na última página. Divergência =
 *  reordenação entre páginas durante a leitura (o sort do ML é por date_closed) → lança; o retry da
 *  mensagem relê. Nunca devolve lista com buraco. */
export async function buscarPedidosPeriodoEstrito(token: string, intervalo: { desde: string; ate: string }, f: typeof fetch = fetch): Promise<PedidoML[]>;

// mensagens-io.ts
export async function buscarMensagensPackEstrito(token: string, packId: string | number, sellerId: string | number, f?: typeof fetch): Promise<MensagemML[]>; // 403/404 → []; 429/5xx/rede → lança
export async function upsertMensagensEstrito(/* mesmos params de upsertMensagens :49-57 */): Promise<{ novasRecebidas: number }>; // error em qualquer upsert → lança
export async function listarPacksDeVendasEstrito(admin: SupabaseClient, userId: string, limite = 200): Promise<PackVenda[]>;   // error → lança

// pendencias.ts (fiação fina sobre a Task 1)
export const LOTE_PENDENCIAS = 20;
/** Pendências ativas (descartado_em null) da org com order_id > depoisDe, por order_id (texto), até `limite`. Lança em erro. */
export async function lerPendencias(admin: SupabaseClient, orgId: string, depoisDe: string, limite: number): Promise<string[]>;
/** registrar_pendencias_pedido; `inicio` = ISO do começo da tentativa (só o reconciliar passa `ok`). Devolve descartados. Lança em erro. */
export async function registrarPendencias(admin: SupabaseClient, orgId: string, ok: string[], inicio: string, falhas: string[], erro: string | null): Promise<number>;
/** Há pendência ativa na org? (decide `parcial` no fim da rodada). Lança em erro. */
export async function temPendenciaAtiva(admin: SupabaseClient, orgId: string): Promise<number>; // quantidade

// config.ts
export async function notificarCategoria(admin, orgId, categoria, texto, opcoes?: { chave?: string }): Promise<number>;
```

`notificarCategoria` **com `chave`** (caminho novo, só a rodada do Pulse usa):
1. `lerAssinantes` **estrito**: `error` do select → lança (hoje `:26-31` devolve `[]` e a pendência seria limpa sem ninguém notificado).
2. In-app: `upsert(linhas com chave, { onConflict: 'user_id,chave', ignoreDuplicates: true }).select('user_id')`; `error` → lança. **O in-app é o canal garantido**: gravado exatamente uma vez por (usuário, chave).
3. Telegram: **melhor esforço, no máximo uma vez** — só para assinantes cujo `user_id` voltou do upsert (linha nova). Queda entre o upsert e o envio perde aquele Telegram; o registro in-app fica. Isso é declarado no ADR, não prometido como garantido.
**Sem `chave`**: comportamento de hoje, byte a byte (best-effort, `console.warn`, `lerAssinantes` tolerante).

- [ ] **Step 1: Testes que falham**
  - `buscarPedidosPeriodoEstrito` (fetch falso por página): 2 páginas coerentes (`total:70`) → 70 pedidos; **1ª ok e 2ª 500 → rejeita**; 429 na 1ª → rejeita; `fetch` que lança → rejeita; **páginas sobrepostas** (id 50 nas duas páginas, 69 únicos com `total:70`) → rejeita; **página que omite um id** (total 70, chegam 69 únicos) → rejeita; `total` da 1ª página 70 e da última 71 → rejeita; `total: 5001` → rejeita.
  - `buscarMensagensPackEstrito`: 200 → parseado; 404/403 → `[]`; 429/500/rede → rejeita.
  - `upsertMensagensEstrito`: `error` no 1º ou no 2º upsert → rejeita; sem erro → mesmo `novasRecebidas` de `upsertMensagens`.
  - `listarPacksDeVendasEstrito`: `error` → rejeita.
  - `pendencias.test.ts` (cliente falso): `lerPendencias` filtra `descartado_em is null`, `order_id > depoisDe`, ordena e limita; `error` → rejeita; `registrarPendencias` chama a RPC com os arrays e devolve `descartados`.
  - `chave.test.ts`: com chave, 1ª chamada grava 2 linhas e manda 2 Telegrams; 2ª chamada (upsert devolve `[]`) **não** manda Telegram; `lerAssinantes` com `error` → rejeita; upsert com `error` → rejeita. Sem chave: insert simples, erro só loga, `lerAssinantes` com erro → segue com lista vazia (como hoje).
- [ ] **Step 2:** FAIL. **Step 3:** implementar (extrair o miolo comum para não duplicar parse/mapeamento). **Step 4:** `pnpm test -- supabase/functions/_shared/faturamento supabase/functions/_shared/notificacoes` → PASS (inclui os testes antigos).
- [ ] **Step 5: Commit** — `feat(shared): leituras/gravações estritas, pendências por org e notificação idempotente por chave`.

---

### Task 4: Backfill em rodada por org (pendencias → vendas → mensagens)

**Files:**
- Create: `supabase/functions/backfill-faturamento/passo.ts`
- Modify: `supabase/functions/backfill-faturamento/index.ts` (roteamento em `:217-289`; `processarConexao:92-215` ganha um parâmetro `io` opcional para o teste de caracterização — defaults = as funções importadas hoje, sem mudar a lógica)
- Test: `supabase/functions/backfill-faturamento/__tests__/passo.test.ts`, `__tests__/roteamento.test.ts`, `__tests__/manual.test.ts`

**Interfaces:**
- Consumes: Tasks 2 e 3; `buscarPedido` (`_shared/faturamento/io.ts:221`).
- Produces:

```ts
export interface ParamsBackfill { desde: string; ate: string }
export const LOTE_PEDIDOS = 20;
export const LOTE_PACKS = 40;
export interface DepsBackfill {
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Auth permanente (classificarErroML === 'permanente-auth') → registrarFalhaAuth e lança SemAcessoRodada. */
  token(cx: ConexaoCanal): Promise<string>;
  pedidosDaJanela(token: string, janela: ParamsBackfill): Promise<PedidoML[]>;            // buscarPedidosPeriodoEstrito
  /** Por pedido: frete, shipment, carregarLiquidoMPDoPedido, GTIN fallback, upsertVenda. Nunca lança por pedido. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, pedidos: PedidoML[]): Promise<{ ok: string[]; falhas: string[]; mpFalhou: boolean }>;
  /** Só REGISTRA falhas (ok=[]): quem retoma e apaga pendência é o reconciliar, que tem o escopo completo
   *  (inclui tratarPedidoCancelado) e é serializado por org pela posse. */
  registrarFalhas(falhas: string[], erro: string): Promise<number>;                         // registrarPendencias(org, [], agora, falhas, erro)
  packs(userId: string): Promise<PackVenda[]>;                                              // listarPacksDeVendasEstrito
  processarPacks(token: string, userId: string, orgId: string, contaExternaId: string, packs: PackVenda[]): Promise<number>; // lança na 1ª falha transitória
}
export function passoBackfill(deps: DepsBackfill, orgId: string): Passo<ParamsBackfill>;
```

Regras (acumulado inicial `{}`; somar com `(a.k ?? 0) + n`; cursor `vendas|<ultimoId>` → `mensagens|<ultimoPackId>` → fim):
1. `conexao()` null ou `userId` null → `{ proximo: null, acumulado }` (como `SEM_NADA`, `index.ts:97`).
2. `token(cx)` em toda mensagem.
3. Cursor null → etapa `vendas` com `pos=''`. O backfill **não consome** pendências (ver `registrarFalhas`).
4. **`vendas`**: `pedidosDaJanela` (lança → propaga); ordenar por `Number(id)`; `id > pos`; `LOTE_PEDIDOS`. Vazio → `proximo:'mensagens|'`. Senão `processarPedidos`; `sincronizados += ok.length`; `pedidosComFalha += falhas.length`; `mpFalhou = max`; se houver falhas, `acumulado.pedidosDescartados += registrarFalhas(falhas, 'backfill: ' + resumo)`; `proximo:'vendas|' + ultimoId`.
5. **`mensagens`**: `cx.contaExternaId` null → fim. `packs(userId)` por `packId` (`localeCompare`), `> pos`, `LOTE_PACKS`; vazio → fim; senão `packs += processarPacks(...)`, `proximo:'mensagens|' + ultimo`.
6. **Fim** (`proximo:null`): `parcial = acumulado.pedidosComFalha > 0 ? `${acumulado.pedidosComFalha} pedido(s) com falha, registrados para o reconciliar` : null`. Descartado continua em `worker_pendencias` com `descartado_em` (recuperável limpando a coluna).
7. Não relê perguntas nem claims no caminho agendado.
8. `processarPedidos` real: `carregarCatalogo(admin, userId)` 1x por mensagem; `carregarGtinsFallback(token, pedidos, idsPubliai)`; `chunk(pedidos, PARALELAS)` com `buscarFreteVendedor`, `buscarShipment`, `carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId), paymentIds)` e `upsertVenda` com os argumentos de `index.ts:181-184`; exceção de um pedido → `falhas.push(String(pedido.id))` + `console.warn`.

Roteamento (`Deno.serve`), com a decisão numa função pura testável:

```ts
export type Rota = 'org' | 'invalida' | 'disparo' | 'legado' | 'manual';
export function rotear(temAssinatura: boolean, parsed: unknown, flagAtiva: boolean): Rota {
  if (!temAssinatura) return 'manual';
  if (ehMsgOrg(parsed)) return 'org';
  // `modo:'org'` malformado NUNCA cai no disparador/legado global: 400 e log (guarda permanente).
  if (parsed && typeof parsed === 'object' && (parsed as { modo?: unknown }).modo === 'org') return 'invalida';
  return flagAtiva ? 'disparo' : 'legado';
}
/** Identidade do disparo. Diário: dia BRT. Recuperação: a própria janela do body (`desde_ate`, ISO
 *  completos) — um retry do disparador gera o MESMO ciclo; recuperações diferentes, ciclos diferentes.
 *  Ordem textual entre recuperações = ordem de `desde`, o que só importa para rejeitar mensagem de uma
 *  recuperação anterior chegando depois de outra (vira `obsoleta`; as pendências ficam na org). */
export function cicloDoDisparo(body: { desde?: string; ate?: string }, agora: Date): { job: Job; ciclo: string };
```

Disparo: `intervalo = janela(parsed)`; `{ job, ciclo } = cicloDoDisparo(parsed, new Date())` (recuperação exige `desde` **e** `ate` explícitos no body; só `desde` → 400); orgs = conexões ML (erro de leitura → 500); `publicarDisparo(FN, orgs.map(org_id => ({ modo:'org', job, org_id, ciclo, params: intervalo })))`; log com job, ciclo, janela e nº de orgs. `org`: `executarMensagem(depsRodada(admin, FN), msg, passoBackfill(depsBackfillReal(admin, msg.org_id), msg.org_id))` → `statusHttp`. `legado`: o laço de hoje (`:246-289`). `manual`: inalterado.

- [ ] **Step 1: Testes que falham**
  - `passo.test.ts` (`DepsBackfill` falso):
    1. conexão null / `userId` null → `proximo:null`, sem `token`.
    2. Cursor null com 45 pedidos embaralhados → ids 1..20, `'vendas|20'`; `'vendas|40'` → 41..45; `'vendas|45'` → `'mensagens|'`.
    3. `pedidosDaJanela` lança → rejeita.
    4. **Reordenação:** a lista volta em ordem diferente a cada chamada → o lote depende só do cursor.
    5. Mensagens: 50 packs → 40, 10, fim; `contaExternaId` null → fim.
    6. `processarPacks` lança → rejeita; `token` lança `SemAcessoRodada` → rejeita com `SemAcessoRodada`.
    7. **Falha de pedido:** `processarPedidos` devolve `falhas:['7']` → `registrarFalhas(['7'], ...)` e o cursor anda; **o backfill nunca chama remoção de pendência**.
    8. **Fim:** 2 falhas na rodada → `parcial:'2 pedido(s) com falha, registrados para o reconciliar'`; nenhuma → `parcial` null.
  - `roteamento.test.ts`: `rotear` nos 5 casos (inclui `{modo:'org'}` sem `org_id` → `invalida`, com e sem flag); `cicloDoDisparo({})` → `backfill` + dia BRT; `cicloDoDisparo({desde,ate})` → `backfill-recuperacao` + `desde_ate`, **igual em duas chamadas com relógios diferentes**.
  - `manual.test.ts` (caracterização): `processarConexao` com `io` falso → com `soVendas:false` chama perguntas, claims, pedidos e mensagens e usa `carregarLiquidoMP` (120 dias), como hoje; com `soVendas:true` pula perguntas/claims/mensagens.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- supabase/functions/backfill-faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(backfill): rodada por org (pendências → vendas → mensagens) atrás de FANOUT_BACKFILL (ADR-0173)`.

---

### Task 5: Pulse em rodada por org (radar → produtos) com backoff por produto

**Files:**
- Modify: `supabase/functions/pulse-coletar/processar.ts` (extrair de `processarColetaOrg:411-794`; falha de coleta no passo 3 `:460-564`)
- Create: `supabase/functions/pulse-coletar/passo.ts`
- Modify: `supabase/functions/pulse-coletar/index.ts`
- Test: `supabase/functions/pulse-coletar/__tests__/passo.test.ts`, `__tests__/backoff.test.ts`, `__tests__/roteamento.test.ts`, `__tests__/manual.test.ts`

**Interfaces:**

```ts
// processar.ts
export interface ContextoColeta { token: string; proprioSellerId: number | null; naoClassificavel: boolean }
export interface ResultadoLote { produtos: number; gravadas: number; alertas: number; acao: number }
export type ProdutoColeta = PulseProdutoRow & { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null };
export async function prepararContexto(conexao: ConexaoCanal, orgId: string): Promise<ContextoColeta>;   // :419-434
export async function sincronizarRadar(admin: SupabaseClient, orgId: string): Promise<void>;           // exportada
export async function processarLoteProdutos(admin: SupabaseClient, orgId: string, ctx: ContextoColeta,
  produtos: ProdutoColeta[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;  // passos 3→7, sem notificar
export async function notificarRodadaPulse(admin: SupabaseClient, orgId: string,
  r: { alertas: number; acao: number; naoClassificavel: boolean }, chave?: string): Promise<void>;
  // :776-791; com `chave` usa notificarCategoria(..., { chave }) e LANÇA em erro; sem chave, como hoje
export const FALHAS_BACKOFF = 3;
export const DIAS_BACKOFF = 3;
export function elegivelPorBackoff(p: { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null },
  agoraMs: number, tier: 'completo' | 'quente'): boolean;
export interface PartesColeta { prepararContexto: typeof prepararContexto; sincronizarRadar: typeof sincronizarRadar;
  processarLoteProdutos: typeof processarLoteProdutos; notificarRodadaPulse: typeof notificarRodadaPulse }
export async function processarColetaOrg(admin: SupabaseClient, conexao: ConexaoCanal, orgId: string,
  tier: 'completo' | 'quente', maxProdutos: number, baseline = false, partes?: PartesColeta): Promise<ResultadoColeta>;

// passo.ts
export interface ParamsPulse { tier: 'completo' | 'quente' }
export const LOTE_COMPLETO = 20;
export const LOTE_QUENTE = 40;
export const JANELA_LEITURA = 100;
export interface DepsPulse {
  conexao(): Promise<ConexaoCanal | null>;
  contexto(cx: ConexaoCanal): Promise<ContextoColeta>;        // auth permanente → SemAcessoRodada
  sincronizarRadar(): Promise<void>;
  produtos(depoisDe: string, limite: number, tier: 'completo' | 'quente'): Promise<ProdutoColeta[]>; // ativos, id > depoisDe, por id; quente: só 'auto'
  processarLote(ctx: ContextoColeta, produtos: ProdutoColeta[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;
  agora(): number;
}
export function passoPulse(deps: DepsPulse): Passo<ParamsPulse>;
export const precisaNotificarPulse = (a: Acumulado) => (a.alertas ?? 0) > 0;
export const chaveNotificacaoPulse = (job: string, orgId: string, ciclo: string) => `pulse:${job}:${orgId}:${ciclo}`;
```

Regras:
1. `processarColetaOrg` (manual e legado) = composição das `partes`: `prepararContexto` → (`completo`) `sincronizarRadar` → seleção de hoje (`:439-446`, trazendo também as 2 colunas novas; **sem** filtro de backoff) → `processarLoteProdutos` → `notificarRodadaPulse` **sem chave** se `alertas > 0`. Retorno `{ produtos, gravadas, alertas }` idêntico ao de hoje.
2. Passo 3: `json === null` → `admin.rpc('registrar_falha_coleta_pulse', { p_org: orgId, p_produto: produto.id })` e `return` (snapshot preservado). Leitura boa → o `patch` de `:548-557` ganha `coleta_tentativa_em: agora, coleta_falhas_seguidas: 0` (valor constante: idempotente).
3. `elegivelPorBackoff`: `falhas < 3` → true; senão quente → false; senão `tentativa == null || agoraMs - Date.parse(tentativa) >= 3 * 86_400_000`.
4. `passoPulse` (cursor `radar|` → `produtos|<ultimoIdExaminado>` → fim; `parcial` sempre null):
   - Cursor null: `conexao()` null → `SemAcessoRodada`. `completo` → `sincronizarRadar()`, `proximo:'produtos|'`. `quente` → etapa produtos com `pos=''` na mesma mensagem.
   - `produtos`: `ctx = contexto(cx)`; `lidos = produtos(pos, JANELA_LEITURA, tier)`; vazio → `proximo:null`. Percorrer `lidos` em ordem acumulando elegíveis até `LOTE`; `ultimoExaminado` = id do último percorrido. **O cursor nunca passa de item não examinado.** Com elegíveis → `processarLote(..., baseline = tier === 'completo')`; somar `produtos, gravadas, alertas, acao`; `acumulado.naoClassificavel = Math.max(acumulado.naoClassificavel ?? 0, ctx.naoClassificavel ? 1 : 0)`. `proximo:'produtos|' + ultimoExaminado`.
5. Consumidor: `executarMensagem(deps, m, passoPulse(depsPulseReal(admin, m.org_id)), { precisaNotificar: precisaNotificarPulse, notificar: (a, ciclo) => notificarRodadaPulse(admin, m.org_id, { alertas: a.alertas ?? 0, acao: a.acao ?? 0, naoClassificavel: (a.naoClassificavel ?? 0) === 1 }, chaveNotificacaoPulse(m.job, m.org_id, ciclo)) })`. `notificarRodadaPulse` checa o módulo `pulse` antes (`:777-781`); **com chave, a leitura de `organizations.modulos_habilitados` é estrita** (`error` → lança, o retry repete); módulo desligado (leitura boa) → não envia e não lança.
6. Disparador (flag `FANOUT_PULSE`, mesma `rotear` da Task 4 copiada para o Pulse): tier do body (`:42`); orgs = conexões ML cuja org tem `'pulse'` em `organizations.modulos_habilitados`; `pulse-completo` + `cicloDiaBrt` ou `pulse-quente` + `cicloHoraUtc`; `params:{ tier }`; log com publicadas e fora por módulo. Sem flag → legado (`:45-80`).

- [ ] **Step 1: Testes que falham**
  - `backoff.test.ts`: falhas 0/2 → true; 3 em quente → false; 3 em completo: tentativa há 1 dia → false, há 3 dias → true, `null` → true.
  - `passo.test.ts`: (1) completo, cursor null → radar 1x, sem lote, `'produtos|'`; (2) quente, cursor null → sem radar, lote de 40 com `baseline:false`; (3) conexão null → `SemAcessoRodada`; (4) 45 elegíveis `p01..p45` → lote `p01..p20`, `proximo:'produtos|p20'`; (5) `p01..p10` em backoff + resto elegível → lote `p11..p30`, `'produtos|p30'`; (6) janela lida toda em backoff → sem lote, cursor no último lido; (7) `lidos` vazio → `proximo:null`; (8) `naoClassificavel` fica 1 depois de visto.
  - `roteamento.test.ts`: `{tier:'quente'}` com flag → disparo `pulse-quente` com ciclo por hora; sem flag → legado.
  - `manual.test.ts`: `processarColetaOrg` com `partes` espiãs → radar só no completo, sem filtro de backoff, `notificarRodadaPulse` só com `alertas > 0` e **sem chave**, retorno `{produtos, gravadas, alertas}`.
  - Teste de `notificarRodadaPulse` com chave: módulo desligado → não chama `notificarCategoria`; leitura do módulo com `error` → rejeita; módulo ligado → chama `notificarCategoria(..., { chave })`. E no `passo.test.ts`: contexto com `naoClassificavel:false` mantém `acumulado.naoClassificavel` 0; com `true` vira 1 e continua 1 no lote seguinte mesmo com contexto `false`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar em 3 commits locais: (a) extração mecânica com os testes antigos (`alertas-severidade`, `dedupe-preco-caiu`) verdes; (b) falha atômica/backoff; (c) `passo.ts` + roteamento. **Step 4:** `pnpm test -- supabase/functions/pulse-coletar` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(pulse): rodada por org em lotes, só orgs com módulo, backoff por produto, atrás de FANOUT_PULSE (ADR-0173)`.

---

### Task 6: Reconciliar em rodada por org

**Files:**
- Create: `supabase/functions/reconciliar-faturamento/passo.ts`
- Modify: `supabase/functions/reconciliar-faturamento/index.ts` (o laço de hoje vira `legado()`; blocos `:91-121`, `:123-167`, `:175-233` viram deps por org)
- Test: `supabase/functions/reconciliar-faturamento/__tests__/passo.test.ts`

**Interfaces:**

```ts
export interface ParamsReconciliar { desde: string; ate: string; hojeBRT: string }
export const LOTE_CLAIMS = 10;     // cada claim custa ~8 requisições (index.ts:125-127)
export const LOTE_PEDIDOS = 25;
export interface DepsReconciliar {
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Token + registrarSyncOk; auth permanente → registrarFalhaAuth + notificação 'integracao' se !jaAlertado
   *  (exatamente :65-78) e lança SemAcessoRodada. Chamado em TODA etapa. */
  token(cx: ConexaoCanal): Promise<string>;
  perguntas(token: string, userId: string, orgId: string): Promise<number>;             // :92-120 para UMA org
  /** buscarClaimsSeller + carregarDevolucoesLocais + claimPrecisaProcessar (:124-132): os OBJETOS pendentes. */
  claimsPendentes(token: string, userId: string): Promise<ClaimML[]>;
  /** :136-165 (catalogoDe(userId) 1x por mensagem) para os claims do lote. Nunca lança por claim. */
  processarClaims(token: string, cx: ConexaoCanal, userId: string, orgId: string, claims: ClaimML[]): Promise<number>;
  pedidosDaJanela(token: string, janela: { desde: string; ate: string }): Promise<PedidoML[]>;  // buscarPedidosPeriodoEstrito
  pedidoPorId(token: string, id: string): Promise<PedidoML>;
  pendencias(depoisDe: string, limite: number): Promise<string[]>;                         // lerPendencias(org)
  /** `inicio` = ISO capturado ANTES de processar o lote (a tentativa). */
  registrarPendencias(ok: string[], inicio: string, falhas: string[], erro: string | null): Promise<number>;
  pendentesAtivos(): Promise<number>;
  agora(): string;                                                                           // new Date().toISOString()
  /** :206-229 com carregarLiquidoMPDoPedido por pedido; mantém tratarPedidoCancelado. Nunca lança por pedido. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, orgId: string, pedidos: PedidoML[]): Promise<{ ok: string[]; falhas: string[] }>;
  /** carregarLiquidoMP (120 d) + reconciliarLiberacoes (:181-205). MP null → loga e devolve 0. */
  liberacoes(token: string, cx: ConexaoCanal, orgId: string, hojeBRT: string): Promise<number>;
}
export function passoReconciliar(deps: DepsReconciliar, orgId: string): Passo<ParamsReconciliar>;
```

Regras (cursor `pendencias|` → `perguntas|` → `claims|<ultimoId>` → `vendas|<ultimoId>` → `liberacoes|` → fim):
1. Cursor null → etapa `pendencias` com `pos=''`. `conexao()` null ou `userId` null → `proximo:null`.
2. **`pendencias`** (o reconciliar é o ÚNICO consumidor — escopo completo, com `tratarPedidoCancelado`, serializado por org pela posse): `ids = pendencias(pos, LOTE_PEDIDOS)`; vazio → `'perguntas|'`. `inicio = agora()` **antes** de ler/processar; para cada id `pedidoPorId` (exceção = falha); `processarPedidos` dos lidos; `acumulado.pedidosDescartados += registrarPendencias(ok, inicio, falhas, 'reconciliar: ' + resumo)`. `ids.length === LOTE_PEDIDOS` → `'pendencias|' + ultimoId`; senão `'perguntas|'`.
2b. **`vendas`**: como a regra 4 da Task 4, com `inicio = agora()` antes do lote e `registrarPendencias(ok, inicio, falhas, ...)` (o `ok` limpa pendência anterior do mesmo pedido); fim → `'liberacoes|'`.
2c. **Fim**: `n = pendentesAtivos()`; `parcial = n > 0 ? `${n} pedido(s) pendente(s)` : (acumulado.pedidosDescartados > 0 ? `${acumulado.pedidosDescartados} pedido(s) descartado(s) após 5 tentativas` : null)`.
3. `perguntas` → soma, `'claims|'`. `claims`: `claimsPendentes`, ordenar por `Number(id)`, `> pos`, `LOTE_CLAIMS`; vazio → `'vendas|'`; senão soma e `'claims|' + ultimoId`.
4. `liberacoes` → soma `liberacoesCorrigidas`, `proximo:null`.
5. Disparador (flag `FANOUT_RECONCILIAR`): conexões com `criado_por` não nulo; `job:'reconciliar'`, `ciclo: cicloHoraUtc(agora)`, `params:{ desde: agora-72h, ate: agora, hojeBRT }`. Sem flag → `legado()` (código de hoje, com `ORCAMENTO_MS`).

**Liberações — divergência declarada com a revisão do Codex.** A etapa `liberacoes` **não é fatiada nesta entrega**: a varredura de 120 dias é limitada por construção (`buscarPagamentosMP`: 2 status × até 2.000 pagamentos em páginas de 50 = ≤ 80 páginas — `_shared/mercadopago/financeiro.ts:49-69`), roda isolada numa mensagem (a CPU dela aparece sozinha no `cpu_time_used`) e fatiar por página do MP pode separar os pagamentos de um pedido e gravar data de liberação errada (`mapaLiberacaoPorOrder` agrega por pedido). **Portão:** se a mensagem `liberacoes` passar de 1.500 ms de CPU na validação (Task 8, Step 7), a ativação do reconciliar é revertida (flag) e entra a alternativa: lotes de pedidos locais com liberação ainda relevante (`money_release_date` nulo ou ≥ hoje−1, `date_closed` nos últimos 120 dias), carregando **todos** os pagamentos de cada pedido por `carregarLiquidoMPDoPedido` antes de `reconciliarLiberacoes`, rodando só nos ciclos de hora múltipla de 6 (custo em requisições ao MP maior que a varredura — 1 por pagamento contra ≤ 80 páginas —, por isso não é o padrão).

- [ ] **Step 1: Testes que falham**: (1) cursor null sem pendências → `'perguntas|'` sem processar pedido; com 3 pendências → processa as 3 e `'perguntas|'`; etapa `perguntas` → `'claims|'`; (2) `userId` null → `proximo:null` sem `token`; (3) 23 claims pendentes (objetos) → 10/10/3 e `'vendas|'`, e `processarClaims` recebe objetos, não ids; (4) vendas com 60 pedidos → 25/25/10, depois `'liberacoes|'`; (5) `liberacoes` → `proximo:null`; (6) `token` chamado em toda etapa, `SemAcessoRodada` propaga de qualquer uma; (7) `pedidosDaJanela` lança → rejeita; (8) pedido com falha → `registrarPendencias(ok, inicio, ['id'], ...)` com `inicio` capturado antes do processamento; `pendentesAtivos()` > 0 no fim → `parcial`; 25 pendências → 20 e `'pendencias|<20º>'`, depois 5 e `'perguntas|'`; `pedidoPorId` que lança conta como falha; (9) `rotear` do reconciliar: `MsgOrg` → `org` com e sem flag; `{modo:'org'}` malformado → `invalida`; body do schedule sem flag → `legado`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- supabase/functions/reconciliar-faturamento supabase/functions/_shared/faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(reconciliar): rodada por org em etapas atrás de FANOUT_RECONCILIAR (ADR-0173)`.

---

### Task 7: Equivalência do MP por pedido + documentação

**Files:**
- Test: `supabase/functions/_shared/faturamento/__tests__/mp-por-pedido.test.ts`
- Modify: `docs/reference/edge-functions.md` (modos das 3 funções `~:90-110`; flags `FANOUT_*`; runbook de ativação/rollback; seção do backfill `~:1290-1310`; nota de que `materializar-metricas` está sem schedule em produção, `:157`), `docs/reference/modelo-de-dados.md` (`worker_rodadas`, colunas de `pulse_produtos`, `notificacoes.chave`), `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/01-Arquitetura/Edge Functions.md`, `obsidian-vault/05-Bugs/Incidentes.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`

- [ ] **Step 1: Equivalência** — `montarMapaLiquido` (`enriquecimento.ts:8`) e `mapaLiberacaoPorOrder` (`:40`) aplicados (a) aos pagamentos de um pedido extraídos da varredura de 120 dias e (b) aos pagamentos que `carregarLiquidoMPDoPedido` devolve para o mesmo pedido produzem o mesmo resultado para: pedido com **2 pagamentos**, **estorno total**, **estorno parcial**. `buscarPagamentoMP` que lança → `carregarLiquidoMPDoPedido` devolve `null` (vira `mpFalhou`). Se algum caso divergir: **parar** e voltar ao planejamento (não trocar o MP).
- [ ] **Step 2:** Documentação (skill `docs-update-checklist`); ADR-0173 com o protocolo v3 (posse por execução, ciclo/params/pendências na linha, notificação pendente com chave, flags, limite de retries esgotados, divergência das liberações). `pnpm docs:links` → OK.
- [ ] **Step 3: Commit** — `docs: ADR-0173 protocolo v3, runbook de ativação e rollback`.

---

### Task 8: Portão, revisão, deploy desligado, ativação medida e recuperação

- [ ] **Step 1: Portão local** — `pnpm preflight` verde.
- [ ] **Step 2: Revisão pré-merge** — Grok 4.7 xhigh via Cursor no diff inteiro da branch (regra do projeto). Corrigir o que proceder.
- [ ] **Step 3: Push + CI verde** (`frontend`, `backend-lint`).
- [ ] **Step 4: Deploy com fan-out DESLIGADO** — `supabase db push` (conferir a migration aplicada) → deploy das 3 funções **e de toda função que importe arquivo alterado de `_shared/`**: listar com `grep -rl "notificacoes/config.ts\|faturamento/mensagens-io.ts\|faturamento/io.ts" supabase/functions --include=*.ts` (regra do projeto; `notificarCategoria` é usado por muitas) → `supabase functions deploy <lista> --no-verify-jwt` → conferir versões. Sem flags, os schedules seguem no legado. Merge fast-forward na `main`.
- [ ] **Step 5: Ativação por função (OK do Diego antes de cada uma)**, ordem backfill → pulse → reconciliar:
  1. `supabase secrets set FANOUT_X=1` e conferir com `supabase secrets list` (memória: `secrets set` pode gravar vazio em silêncio);
  2. publicar 1 disparo manual pelo QStash com **o mesmo body do schedule** (ou esperar o schedule);
  3. medir antes de ativar a próxima: `worker_rodadas` com todas as orgs `ok`/`parcial` no ciclo; `function_logs` com `[rodada] lote` por mensagem e **`cpu_time_used` por etapa < 1.500 ms** (radar, perguntas, claims, vendas, mensagens, liberações, catálogo por mensagem); acima disso, desligar a flag e reduzir o lote (etapa por lote) ou abrir tarefa (etapa de custo fixo).
- [ ] **Step 6: Rollback — sem depender de inspecionar a fila.**
  1. Rollback normal = `supabase secrets unset FANOUT_X`: o disparador volta ao legado no próximo schedule; mensagens `MsgOrg` já enfileiradas, pausadas ou atrasadas seguem consumidas pelo código novo, que permanece deployado.
  2. Se for preciso reverter **código** do consumidor (bug no passo), a versão de rollback é a versão **legada + a guarda de `MsgOrg`**, nunca o commit anterior puro: o `Deno.serve` de cada uma das 3 funções mantém, antes de qualquer outro ramo assinado, `if (ehMsgOrg(parsed)) return 200 { ignorada: 'rollback' }` (loga org e ciclo). A guarda é **permanente**: qualquer versão futura dessas funções, inclusive a remoção do legado no follow-up, preserva o reconhecimento de `MsgOrg`. Assim uma entrega tardia jamais vira execução global (no backfill, janela default de 90 dias).
  3. Teste da guarda: `roteamento.test.ts` das 3 funções cobre `ehMsgOrg` → rota `org` mesmo com flag desligada; o ADR registra a regra.
- [ ] **Step 7: Validação em produção (3 dias, só leitura)**: 0 shutdowns `CPUTime`; `cpu_time_used` por etapa < 1.500 ms (liberações: portão da Task 6); `worker_rodadas` sem linha `rodando` com posse vencida há mais de 1 h; `notificacoes` `pulse` com no máximo 1 linha por (usuário, chave); `pulse_produtos` da DSA sem elegível com snapshot parado > 2 dias; `worker_pendencias` por org visível, com as ativas decrescendo.
- [ ] **Step 8: Recuperação histórica (só após o Step 7 verde, com OK do Diego)** — 1 mensagem ao disparador do backfill com `{"desde":"2026-09-10T00:00:00Z","ate":"<agora ISO, fixado uma vez>"}` (`backfill-recuperacao`, ciclo = a própria janela; um retry do disparador cai no mesmo ciclo). Conferir `ml_vendas` de 10–27/09, mensagens novas e `worker_pendencias` da org: ativas são retomadas pelo reconciliar horário; descartadas ficam listadas para decisão. Só então marcar o incidente resolvido.
- [ ] **Step 9 (follow-up, fora desta entrega):** após 7 dias estáveis, remover o legado e as flags (mantendo a guarda de `MsgOrg`); alarme de rodada parada / pendência descartada a partir de `worker_rodadas` e `worker_pendencias`; medir rejeições de cobertura de `buscarPedidosPeriodoEstrito` e, se recorrentes, subdividir a janela; contagem durável de descartes (hoje, queda entre registrar o descarte e salvar o acumulado pode concluir `ok` — a linha descartada segue visível e recuperável).
