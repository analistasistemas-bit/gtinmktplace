# Fan-out por org em lotes retomáveis (incidente CPU 546) — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acabar com os 546 (`CPU Time exceeded`) de `pulse-coletar`, `backfill-faturamento` e `reconciliar-faturamento`: cada mensagem QStash processa uma org e um lote limitado.

**Architecture:** O schedule existente vira disparador (1 mensagem por org), ligado por flag de ambiente por função. Cada (job, org) tem uma linha em `worker_rodadas` que é a **fonte da verdade** do ciclo, da janela (`params`), do cursor (`etapa|pos`) e do acumulado. A mensagem só diz "trabalhe na (job, org, ciclo)". Cada execução toma uma **posse curta com identidade própria** (`lease_id`, 150 s), processa um lote, faz CAS do cursor com essa posse, publica a continuação (dedup pelo cursor resultante) e solta a posse. Ocupada → 500 (o QStash repete depois). Caminhos manuais (botões) não mudam.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres (plpgsql `security definer`), QStash (`_shared/queue.ts`), vitest.

**Spec:** `docs/decisions/0173-fanout-por-org-workers-agendados-cpu.md` (ADR-0173). Revisões do Codex `gpt-6-astra` (diagnóstico: APROVADO COM AJUSTES; plano v1: REPROVADO — esta v2 responde aos 5 bloqueios).

## Global Constraints

- Limite que estoura: **2 s de CPU por requisição**. Relógio é só proteção secundária.
- Schedules do QStash **não mudam** (cron, body, retries). Nenhum schedule novo.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043).
- RPCs de escrita: `security definer set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`. RLS ligada, `select` só da própria org (`current_org_id()`), precedente `20260927084615_vendas_sku_trafego.sql:53-66`.
- Módulos puros (`_shared/rodada/rodada.ts`, `*/passo.ts`) sem import Deno/npm de runtime (o vitest carrega). `import type` é permitido.
- Mercado Livre / Mercado Pago: só GET (e o refresh OAuth já existente). Nenhuma escrita no ML.
- Caminho manual (JWT) de `pulse-coletar` e `backfill-faturamento`: comportamento inalterado, provado por teste (Task 4 e Task 5), não só por compilação.
- Worker responde **200** para `executado|continua|obsoleta|concluida|sem_acesso` e **500** para `erro|ocupada` (o QStash repete a mesma mensagem).
- Mensagens por org: `retries: 3` explícito (backoff do QStash 12 s → 148 s → ~30 min; a posse de 150 s expira antes da 2ª repetição).
- Flags: `FANOUT_BACKFILL`, `FANOUT_PULSE`, `FANOUT_RECONCILIAR` = `'1'` ligam o disparador em fan-out. Ausente/outro valor → disparador legado (código de hoje). O consumidor de `MsgOrg` fica sempre ativo.
- Repositório público: nenhum valor real de cliente em R$ em arquivo versionado.

## Review Focus

1. **Retry da mensagem que caiu por CPU no meio do lote** (posse ainda viva): responde `ocupada`/500; o retry seguinte, com a posse expirada, reprocessa o mesmo lote (idempotente) e a cadeia segue — Task 2 teste 3 e Task 1 teste 3.
2. **Publicação da continuação aceita pelo QStash mas com resposta perdida** (ou falha depois do CAS): o retry da mensagem atual lê o cursor já avançado no banco, processa o lote seguinte e publica a continuação desse cursor; a cópia duplicada vira trabalho serializado pela posse, nunca lote repetido nem cursor voltando — Task 2 testes 6–7.
3. **Mensagem de ciclo antigo chegando depois do ciclo novo** e **retry do schedule depois da rodada concluída**: `obsoleta` / `concluida`, sem reabrir nem notificar de novo — Task 1 testes 4–5.
4. **Página de pedidos do ML falhando no meio** (hoje `io.ts:295-297` devolve lista parcial): lança, a mensagem responde 500, o cursor não anda — Task 4 teste 5.
5. **Pulse com todos os produtos do trecho em backoff** e **org sem conexão/token morto**: cursor anda só pelos examinados; `sem_acesso` conclui com 200 sem loop — Task 5 testes 5–6, Task 4 teste 1.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_worker_rodadas.sql` (novo) | `worker_rodadas`, RPCs `abrir/avancar/concluir/liberar_execucao`, `marcar_notificado`, colunas de tentativa em `pulse_produtos` |
| `supabase/tests/worker_rodadas.sql` (novo) | Contrato das RPCs em Postgres real |
| `supabase/functions/_shared/rodada/rodada.ts` (novo) | Tipos, ciclo, cursor, dedup, `ehMsgOrg`, `executarMensagem` (puro) |
| `supabase/functions/_shared/rodada/deps.ts` (novo) | Fiação real (RPCs + publish) e `publicarDisparo`, `fanoutAtivo` |
| `supabase/functions/_shared/rodada/__tests__/rodada.test.ts` (novo) | Protocolo com banco falso em memória |
| `supabase/functions/_shared/faturamento/io.ts` | + `buscarPedidosPagina` (1 página, lança em erro) |
| `supabase/functions/_shared/faturamento/mensagens-io.ts` | + `buscarMensagensPackEstrito`, `upsertMensagensEstrito`, `listarPacksDeVendasEstrito` |
| `supabase/functions/backfill-faturamento/passo.ts` (novo) | Passo: `vendas` (páginas) → `mensagens` (lotes de packs) |
| `supabase/functions/pulse-coletar/processar.ts` | `processarLoteProdutos` extraído; tentativa/backoff por produto |
| `supabase/functions/pulse-coletar/passo.ts` (novo) | Passo: `radar` → `produtos` (lotes) + notificação pendente |
| `supabase/functions/reconciliar-faturamento/passo.ts` (novo) | Passo: `perguntas` → `claims` (lotes) → `vendas` (páginas) → `liberacoes` |
| os 3 `index.ts` | Roteamento: `MsgOrg` → consumidor; schedule → disparador (flag) ou legado; JWT → manual |

---

### Task 1: Migration `worker_rodadas` + colunas de tentativa do Pulse

**Files:**
- Create: `supabase/migrations/<timestamp>_worker_rodadas.sql` (via `supabase migration new worker_rodadas`)
- Create: `supabase/tests/worker_rodadas.sql`

**Interfaces (Produces, só `service_role`):**
- `abrir_execucao(p_job text, p_org uuid, p_ciclo text, p_params jsonb) returns table (resultado text, lease uuid, estado text, cursor text, acumulado jsonb, params jsonb, notificar_pendente boolean)` — sempre 1 linha; `resultado ∈ {'executar','ocupada','obsoleta','concluida'}`.
- `avancar_execucao(p_job text, p_org uuid, p_lease uuid, p_cursor_novo text, p_acumulado jsonb) returns boolean`
- `concluir_execucao(p_job text, p_org uuid, p_lease uuid, p_estado text, p_erro text, p_acumulado jsonb, p_notificar boolean) returns boolean`
- `liberar_execucao(p_job text, p_org uuid, p_lease uuid, p_erro text) returns void`
- `marcar_notificado(p_job text, p_org uuid, p_ciclo text) returns boolean`
- `pulse_produtos.coleta_tentativa_em timestamptz`, `pulse_produtos.coleta_falhas_seguidas integer not null default 0`

- [ ] **Step 1: Criar a migration** (`supabase migration new worker_rodadas`):

```sql
-- ADR-0173: estado das rodadas por (job, org) dos workers agendados em fan-out.
-- A linha é a fonte da verdade (ciclo, params, cursor, acumulado); a mensagem QStash só aponta
-- (job, org, ciclo). Cada execução toma uma posse curta com identidade própria (lease), faz o CAS do
-- cursor com ela e a solta no fim. Escrita só pelo service_role.

create table public.worker_rodadas (
  job                text not null check (job in ('pulse-completo','pulse-quente','backfill','backfill-recuperacao','reconciliar')),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  ciclo              text not null,     -- dia BRT 'YYYY-MM-DD' ou hora UTC 'YYYY-MM-DDTHH'; ordenável como texto
  estado             text not null check (estado in ('rodando','ok','sem_acesso')),
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

alter table public.worker_rodadas enable row level security;
create policy "worker_rodadas: select org" on public.worker_rodadas for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.worker_rodadas from anon;
revoke insert, update, delete, truncate, references, trigger on public.worker_rodadas from authenticated;
grant select on public.worker_rodadas to authenticated;

create function public.abrir_execucao(p_job text, p_org uuid, p_ciclo text, p_params jsonb)
returns table (resultado text, lease uuid, estado text, cursor text, acumulado jsonb, params jsonb, notificar_pendente boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  w public.worker_rodadas%rowtype;
  novo uuid := gen_random_uuid();
begin
  select * into w from public.worker_rodadas r where r.job = p_job and r.org_id = p_org for update;
  if not found then
    insert into public.worker_rodadas (job, org_id, ciclo, estado, params, lease_id, lease_ate, iniciado_em)
    values (p_job, p_org, p_ciclo, 'rodando', coalesce(p_params, '{}'::jsonb), novo, now() + interval '150 seconds', now());
    return query select 'executar'::text, novo, 'rodando'::text, null::text, '{}'::jsonb, coalesce(p_params, '{}'::jsonb), false;
    return;
  end if;
  if w.ciclo > p_ciclo then
    return query select 'obsoleta'::text, null::uuid, w.estado, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.lease_ate is not null and w.lease_ate > now() then
    return query select 'ocupada'::text, null::uuid, w.estado, w.cursor, w.acumulado, w.params, w.notificar_pendente;
    return;
  end if;
  if w.ciclo < p_ciclo then
    -- ciclo novo assume (o anterior terminou ou morreu com a posse expirada): recomeça do zero
    update public.worker_rodadas r set ciclo = p_ciclo, estado = 'rodando', params = coalesce(p_params, '{}'::jsonb),
      cursor = null, acumulado = '{}'::jsonb, lease_id = novo, lease_ate = now() + interval '150 seconds',
      notificar_pendente = false, iniciado_em = now(), erro = null
     where r.job = p_job and r.org_id = p_org;
    return query select 'executar'::text, novo, 'rodando'::text, null::text, '{}'::jsonb, coalesce(p_params, '{}'::jsonb), false;
    return;
  end if;
  -- mesmo ciclo
  if w.estado <> 'rodando' and not w.notificar_pendente then
    return query select 'concluida'::text, null::uuid, w.estado, w.cursor, w.acumulado, w.params, false;
    return;
  end if;
  update public.worker_rodadas r set lease_id = novo, lease_ate = now() + interval '150 seconds'
   where r.job = p_job and r.org_id = p_org;
  return query select 'executar'::text, novo, w.estado, w.cursor, w.acumulado, w.params, w.notificar_pendente;
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

create function public.concluir_execucao(p_job text, p_org uuid, p_lease uuid, p_estado text, p_erro text,
                                         p_acumulado jsonb, p_notificar boolean)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas
       set estado = p_estado, acumulado = coalesce(p_acumulado, acumulado),
           notificar_pendente = coalesce(p_notificar, false),
           lease_id = null, lease_ate = null,
           ultimo_ok_em   = case when p_estado = 'ok' then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado = 'sem_acesso' then now() else ultimo_erro_em end,
           erro           = case when p_estado = 'sem_acesso' then p_erro end
     where job = p_job and org_id = p_org and lease_id = p_lease and lease_ate > now() and estado = 'rodando'
       and p_estado in ('ok','sem_acesso')
    returning 1)
  select exists (select 1 from u);
$$;

-- Solta a posse da execução (erro transitório ou fim da mensagem). Registra o erro sem mudar o estado.
create function public.liberar_execucao(p_job text, p_org uuid, p_lease uuid, p_erro text)
returns void
language sql security definer set search_path = '' as $$
  update public.worker_rodadas
     set lease_id = null, lease_ate = null,
         ultimo_erro_em = case when p_erro is not null then now() else ultimo_erro_em end,
         erro = coalesce(p_erro, erro)
   where job = p_job and org_id = p_org and lease_id = p_lease;
$$;

-- Envio da notificação é "pelo menos uma vez": envia, depois marca. Retorna false se já não havia pendência.
create function public.marcar_notificado(p_job text, p_org uuid, p_ciclo text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas set notificar_pendente = false
     where job = p_job and org_id = p_org and ciclo = p_ciclo and notificar_pendente
    returning 1)
  select exists (select 1 from u);
$$;

revoke all on function public.abrir_execucao(text, uuid, text, jsonb)                              from public, anon, authenticated;
revoke all on function public.avancar_execucao(text, uuid, uuid, text, jsonb)                      from public, anon, authenticated;
revoke all on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean)      from public, anon, authenticated;
revoke all on function public.liberar_execucao(text, uuid, uuid, text)                             from public, anon, authenticated;
revoke all on function public.marcar_notificado(text, uuid, text)                                  from public, anon, authenticated;
grant execute on function public.abrir_execucao(text, uuid, text, jsonb)                           to service_role;
grant execute on function public.avancar_execucao(text, uuid, uuid, text, jsonb)                   to service_role;
grant execute on function public.concluir_execucao(text, uuid, uuid, text, text, jsonb, boolean)   to service_role;
grant execute on function public.liberar_execucao(text, uuid, uuid, text)                          to service_role;
grant execute on function public.marcar_notificado(text, uuid, text)                               to service_role;

-- Pulse: tentativa de coleta por produto, separada do snapshot. `mlGet` devolve null para QUALQUER
-- erro, então isto não declara a ficha morta: só tira da frente quem falha seguidamente.
alter table public.pulse_produtos
  add column coleta_tentativa_em timestamptz,
  add column coleta_falhas_seguidas integer not null default 0 check (coleta_falhas_seguidas >= 0);
```

- [ ] **Step 2: Teste SQL** (`supabase/tests/worker_rodadas.sql`, formato de `supabase/tests/vendas_sku_trafego.sql`: `\set ON_ERROR_STOP on`, `begin; … rollback;`, cada caso num `do $$ … raise exception … $$`). Para simular expiração: `update worker_rodadas set lease_ate = now() - interval '1 second'`.
  1. 1ª `abrir_execucao('backfill', org, '2026-09-27', '{"desde":"a","ate":"b"}')` → `executar` com lease; 2ª imediata → `ocupada`.
  2. Posse expirada → `executar` com **lease diferente**; `avancar_execucao` com o lease **antigo** → `false`; com o novo → `true` e grava cursor/acumulado.
  3. `abrir` com o mesmo ciclo e `p_params` diferente devolve os `params` **gravados** (a janela da abertura), não os novos.
  4. `concluir_execucao(... 'ok', ..., p_notificar=>false)` → `true`; `abrir` mesmo ciclo → `concluida`; `abrir` ciclo **anterior** (`'2026-09-26'`) → `obsoleta`.
  5. Ciclo novo (`'2026-09-28'`) → `executar` com `cursor` null, `acumulado` `{}` e `params` novos.
  6. `concluir(... p_notificar=>true)` → `abrir` mesmo ciclo → `executar` com `notificar_pendente = true`; `marcar_notificado` → `true`, 2ª vez → `false`; depois `abrir` → `concluida`.
  7. `concluir_execucao` com lease expirado → `false`. `liberar_execucao` zera `lease_id`/`lease_ate` e grava `erro`.
  8. Grants: `has_function_privilege('authenticated', …, 'execute')` false para as 5; `service_role` true.
  9. `insert into pulse_produtos` sem as colunas novas → `coleta_falhas_seguidas = 0`.

- [ ] **Step 3:** `npm run db:check`; aplicar a migration no Postgres local e rodar o teste por `psql -U supabase_admin` no container (se `supabase db reset` estiver quebrado, aplicar o arquivo por `psql -f`). Expected: sem `ERROR`, termina em `ROLLBACK`.
- [ ] **Step 4: Commit** — `feat(rodadas): worker_rodadas com posse por execução, ciclo e params (ADR-0173)`.

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
export type ResultadoMsg = 'executado' | 'continua' | 'obsoleta' | 'concluida' | 'sem_acesso' | 'ocupada' | 'erro';
export interface MsgOrg<P = Record<string, unknown>> { modo: 'org'; job: Job; org_id: string; ciclo: string; params: P }
export class SemAcessoRodada extends Error {}
export interface Cursor { etapa: string; pos: string }
export function lerCursor(c: string | null | undefined): Cursor | null;     // 'etapa|pos' (pos pode ser '')
export const gravarCursor = (c: Cursor): string => `${c.etapa}|${c.pos}`;
export const cicloDiaBrt = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const cicloHoraUtc = (d: Date): string => d.toISOString().slice(0, 13);
export const dedupMsg = (fn: string, m: Pick<MsgOrg, 'job' | 'org_id' | 'ciclo'>, cursor: string | null) =>
  `${fn}:${m.job}:${m.org_id}:${m.ciclo}:${cursor ?? 'inicio'}`.replace(/[^A-Za-z0-9_-]/g, '_');
export function ehMsgOrg(x: unknown): x is MsgOrg;
export interface ResultadoPasso { proximo: string | null; acumulado: Acumulado }
/** Processa UM lote. `params` vem da LINHA (gravados na abertura), não da mensagem. */
export type Passo<P = Record<string, unknown>> = (cursor: string | null, acumulado: Acumulado, params: P) => Promise<ResultadoPasso>;
export interface Abertura { resultado: 'executar' | 'ocupada' | 'obsoleta' | 'concluida'; lease: string | null; estado: string;
  cursor: string | null; acumulado: Acumulado; params: Record<string, unknown>; notificarPendente: boolean }
export interface DepsRodada {
  abrir(m: MsgOrg): Promise<Abertura>;
  avancar(m: MsgOrg, lease: string, cursorNovo: string, acumulado: Acumulado): Promise<boolean>;
  concluir(m: MsgOrg, lease: string, estado: 'ok' | 'sem_acesso', erro: string | null, acumulado: Acumulado | null, notificar: boolean): Promise<boolean>;
  liberar(m: MsgOrg, lease: string, erro: string | null): Promise<void>;
  marcarNotificado(m: MsgOrg): Promise<boolean>;
  publicar(m: MsgOrg, cursor: string): Promise<void>;   // dedup = dedupMsg(fn, m, cursor)
}
export interface OpcoesMsg {
  /** A rodada concluída pede notificação? (Pulse: alertas > 0). Default: nunca. */
  precisaNotificar?: (acumulado: Acumulado) => boolean;
  /** Envia a notificação. Lança → a mensagem responde 500 e o retry reenvia (pelo menos uma vez). */
  notificar?: (acumulado: Acumulado) => Promise<void>;
}
export async function executarMensagem<P>(deps: DepsRodada, m: MsgOrg<P>, passo: Passo<P>, op?: OpcoesMsg): Promise<ResultadoMsg>;
export const statusHttp = (r: ResultadoMsg): number => (r === 'erro' || r === 'ocupada' ? 500 : 200);

// deps.ts (fiação)
export function depsRodada(admin: SupabaseClient, fn: string): DepsRodada;
export async function publicarDisparo(fn: string, msgs: MsgOrg[]): Promise<number>; // dedupMsg(fn, m, null); lança se algum falhou (após tentar todos)
export const fanoutAtivo = (flag: 'FANOUT_BACKFILL' | 'FANOUT_PULSE' | 'FANOUT_RECONCILIAR') => Deno.env.get(flag) === '1';
```

Implementar `executarMensagem` exatamente assim:

```ts
export async function executarMensagem(deps, m, passo, op = {}) {
  const a = await deps.abrir(m);
  if (a.resultado !== 'executar') return a.resultado;          // ocupada → 500; obsoleta/concluida → 200
  const lease = a.lease!;
  const log = (ev: string, extra: Record<string, unknown> = {}) =>
    console.log(`[rodada] ${ev}`, { job: m.job, org_id: m.org_id, ciclo: m.ciclo, ...extra });

  // Rodada já concluída que ficou com a notificação pendente (a entrega anterior falhou).
  if (a.estado !== 'rodando') {
    try {
      if (a.notificarPendente && op.notificar) { await op.notificar(a.acumulado); await deps.marcarNotificado(m); }
      await deps.liberar(m, lease, null);
      return 'executado';
    } catch (e) { await deps.liberar(m, lease, msgErro(e)); log('notificacao falhou', { erro: msgErro(e) }); return 'erro'; }
  }

  const inicio = Date.now();
  let r: ResultadoPasso;
  try {
    r = await passo(a.cursor, a.acumulado, a.params as P);
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
    const notificar = !!op.precisaNotificar?.(r.acumulado);
    if (!(await deps.concluir(m, lease, 'ok', null, r.acumulado, notificar))) return 'obsoleta';
    if (!notificar || !op.notificar) return 'executado';
    try { await op.notificar(r.acumulado); await deps.marcarNotificado(m); return 'executado'; }
    catch (e) { log('notificacao falhou', { erro: msgErro(e) }); return 'erro'; }   // retry → ramo "já concluída" acima
  }

  if (!(await deps.avancar(m, lease, r.proximo, r.acumulado))) return 'obsoleta'; // perdeu a posse (expirou)
  try {
    await deps.publicar(m, r.proximo);
  } catch (e) {
    // Cursor já avançou no banco. O retry desta mesma mensagem lê o cursor novo e segue a cadeia.
    await deps.liberar(m, lease, msgErro(e));
    log('publicar falhou', { proximo: r.proximo, erro: msgErro(e) });
    return 'erro';
  }
  await deps.liberar(m, lease, null);
  return 'continua';
}
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));
```

- [ ] **Step 1: Testes que falham** — `DepsRodada` falso que **reimplementa a semântica da Task 1 em memória** (uma linha por job+org, `lease_ate` controlado por um relógio falso). Casos:
  1. Mensagem nova → passo chamado com `cursor=null`, `params` da abertura; `proximo:'vendas|p1'` → `avancar` + `publicar(m,'vendas|p1')` + `liberar`; resultado `continua`.
  2. `abrir` → `ocupada` → passo não chamado, `statusHttp` = 500.
  3. **Queda por CPU** (Review Focus 1): 1ª execução chama o passo e "morre" (a promise nunca resolve / o teste abandona sem `liberar`); retry com relógio +12 s → `ocupada`; retry com +160 s → `executar` com o **mesmo** cursor → passo recebe o mesmo cursor (lote refeito).
  4. Passo lança `Error` → `liberar` com erro, resultado `erro` (500), cursor inalterado.
  5. Passo lança `SemAcessoRodada` → `concluir('sem_acesso')`, 200.
  6. **`publicar` lança depois do `avancar`** (Review Focus 2): resultado `erro`; o retry recebe o cursor **novo** do banco, chama o passo a partir dele e publica o cursor seguinte; o cursor nunca volta.
  7. **Publicação duplicada** (a mesma mensagem entregue 2x sequencialmente): a 2ª processa o lote seguinte (cursor do banco), nunca repete um cursor já processado.
  8. `proximo:null` sem `precisaNotificar` → `concluir(ok, notificar=false)` → `executado`; nova entrega do mesmo ciclo → `concluida`.
  9. `precisaNotificar` true e `notificar` lança → `erro`; retry → ramo "já concluída" → chama `notificar` de novo → `marcarNotificado` → `executado`; entrega seguinte → `concluida` (sem 3º envio).
  10. `abrir` → `obsoleta` (ciclo antigo) → 200, passo não chamado.
  11. `lerCursor('vendas|123')` → `{etapa:'vendas',pos:'123'}`; `lerCursor('radar|')` → `{etapa:'radar',pos:''}`; `lerCursor(null)` → `null`; `cicloDiaBrt(new Date('2026-09-28T02:30:00Z'))` → `'2026-09-27'`; `cicloHoraUtc(...)` → `'2026-09-28T02'`; `dedupMsg` só `[A-Za-z0-9_-]`; `ehMsgOrg({tier:'completo'})` e `ehMsgOrg({dias:7})` → false.
- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/rodada` → FAIL.
- [ ] **Step 3:** Implementar `rodada.ts` e `deps.ts`. `deps.abrir` chama `abrir_execucao` e mapeia a 1 linha; `publicar` = `qstashClient().publishJSON({ url: urlDaFuncao(fn), body: m, retries: 3, deduplicationId: dedupMsg(fn, m, cursor) })`; `publicarDisparo` = mesmo com `cursor=null`, sequencial, coleta falhas e lança no fim se houver alguma (o QStash repete o schedule; `abrir_execucao` + dedup seguram a repetição).
- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/rodada` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(rodadas): protocolo de execução por org com posse, CAS e continuação (ADR-0173)`.

---

### Task 3: Leituras e gravações estritas (ML e banco)

**Files:**
- Modify: `supabase/functions/_shared/faturamento/io.ts` (novo `buscarPedidosPagina` ao lado de `buscarPedidosPeriodo:272-307`, que fica igual)
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts` (novas estritas ao lado das atuais, que ficam iguais: `sync-mensagem` e `responder-mensagem` não mudam)
- Test: `supabase/functions/_shared/faturamento/__tests__/estritos.test.ts`

**Interfaces (Produces):**

```ts
// io.ts — UMA página, ordem estável e crescente; qualquer não-2xx LANÇA (nada de lista parcial).
export async function buscarPedidosPagina(
  token: string, sellerId: string, intervalo: { desde: string; ate: string }, offset: number, limit: number,
  f: typeof fetch = fetch,
): Promise<{ pedidos: PedidoML[]; total: number }>;
// params: seller, order.date_created.from/to, sort: 'date_asc', offset, limit. total = paging.total.
export async function buscarSellerId(token: string, f: typeof fetch = fetch): Promise<string>; // /users/me; lança

// mensagens-io.ts
export async function buscarMensagensPackEstrito(token: string, packId: string | number, sellerId: string | number, f?: typeof fetch): Promise<MensagemML[]>;
//   403/404 → []; 429/5xx/rede → lança.
export async function upsertMensagensEstrito(...mesmos parâmetros de upsertMensagens): Promise<{ novasRecebidas: number }>;
//   igual a upsertMensagens (`:49-94`), mas `error` de qualquer um dos 2 upserts → lança.
export async function listarPacksDeVendasEstrito(admin: SupabaseClient, userId: string, limite = 200): Promise<PackVenda[]>;
//   igual a listarPacksDeVendas (`:153`), mas `error` → lança.
```

- [ ] **Step 1: Testes que falham** (`fetch` e cliente Supabase falsos):
  - `buscarPedidosPagina`: 200 → `{pedidos, total}` e a URL contém `sort=date_asc`, `offset=40`, `limit=20`; 429 → rejeita; 500 → rejeita; `fetch` que lança → rejeita (**Review Focus 4**).
  - `buscarMensagensPackEstrito`: 200 → parseado; 404/403 → `[]`; 429/500/rede → rejeita.
  - `upsertMensagensEstrito`: 1º upsert com `error` → rejeita; 2º com `error` → rejeita; sem erro → mesmo `novasRecebidas` de `upsertMensagens`.
  - `listarPacksDeVendasEstrito`: `error` → rejeita.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (extrair o miolo comum das versões atuais para não duplicar parse/mapeamento). **Step 4:** `pnpm test -- supabase/functions/_shared/faturamento` → PASS (inclui os testes antigos).
- [ ] **Step 5: Commit** — `feat(faturamento): leituras/gravações estritas para os lotes retomáveis`.

---

### Task 4: Backfill em rodada por org (vendas → mensagens)

**Files:**
- Create: `supabase/functions/backfill-faturamento/passo.ts`
- Modify: `supabase/functions/backfill-faturamento/index.ts:217-289` (roteamento; `processarConexao:92-215` intacta para o manual e para o disparador legado)
- Test: `supabase/functions/backfill-faturamento/__tests__/passo.test.ts`, `supabase/functions/backfill-faturamento/__tests__/roteamento.test.ts`

**Interfaces:**
- Consumes: Task 2 (`MsgOrg`, `Passo`, `lerCursor`, `gravarCursor`, `SemAcessoRodada`, `executarMensagem`, `statusHttp`, `ehMsgOrg`, `cicloDiaBrt`, `depsRodada`, `publicarDisparo`, `fanoutAtivo`); Task 3.
- Produces:

```ts
export interface ParamsBackfill { desde: string; ate: string }
export const LOTE_PEDIDOS = 20;   // = limit da página do ML; ajustar pela medição (Task 8)
export const LOTE_PACKS = 40;
export interface DepsBackfill {
  /** Conexão ML da org + dono legado (criado_por). null = sem conexão. */
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Token válido. Auth permanente (classificarErroML === 'permanente-auth') → registrarFalhaAuth e lança SemAcessoRodada. */
  token(cx: ConexaoCanal): Promise<string>;
  sellerId(token: string): Promise<string>;                                           // buscarSellerId
  pagina(token: string, sellerId: string, janela: ParamsBackfill, offset: number, limit: number): Promise<{ pedidos: PedidoML[]; total: number }>;
  /** Frete, shipment, MP por pedido (carregarLiquidoMPDoPedido), GTIN fallback, upsertVenda — por pedido. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, pedidos: PedidoML[]): Promise<{ ok: number; falhas: number; mpFalhou: boolean }>;
  packs(userId: string): Promise<PackVenda[]>;                                         // listarPacksDeVendasEstrito
  /** buscarMensagensPackEstrito + upsertMensagensEstrito por pack; lança na 1ª falha transitória. */
  processarPacks(token: string, userId: string, orgId: string, contaExternaId: string, packs: PackVenda[]): Promise<number>;
}
export function passoBackfill(deps: DepsBackfill, orgId: string): Passo<ParamsBackfill>;
```

Regras do passo (cursor `vendas|<offset>` → `mensagens|<ultimoPackId>` → fim; acumulado inicial `{}` e cada chave somada com `(a.k ?? 0) + n`):
1. `conexao()` null ou `userId` null → `{ proximo: null, acumulado }` (conclui `ok` vazio, como `SEM_NADA` em `index.ts:97`).
2. `token(cx)` em toda mensagem (auth permanente registrada em qualquer etapa).
3. Cursor null → `vendas|0`. Etapa `vendas`: `offset = Number(pos)`; `pagina(token, seller, params, offset, LOTE_PEDIDOS)`; lançou → propaga (500, cursor parado). `pedidos.length === 0` ou `offset >= total` → `proximo:'mensagens|'`. Senão `processarPedidos(...)`; soma `sincronizados`, `pedidosComFalha`, `mpFalhou` (0/1, máximo); `proximo:'vendas|' + (offset + pedidos.length)`.
   - Por que offset é estável: `sort=date_asc` com a janela `[desde, ate]` fixa (gravada na abertura); pedido novo cai depois do fim, cancelamento não remove pedido da busca.
4. Etapa `mensagens`: `cx.contaExternaId` null → `proximo:null`. `packs(userId)` ordenados por `packId` (string, `localeCompare`), `> pos`, primeiros `LOTE_PACKS`. Vazio → `proximo:null`. Senão soma `packs += processarPacks(...)`; `proximo:'mensagens|' + ultimo.packId`.
5. **Não** relê perguntas nem claims no caminho agendado (o reconciliar relê o mesmo histórico de hora em hora).
6. `processarPedidos` real: `carregarCatalogo(admin, userId)` 1x por mensagem; `carregarGtinsFallback(token, pedidos, idsPubliai)`; `chunk(pedidos, PARALELAS)` com `buscarFreteVendedor`, `buscarShipment`, `carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId), paymentIds)` e `upsertVenda` com os argumentos de `index.ts:181-184` (`liquidoPorPayment ?? undefined`). Falha por pedido: `console.warn` + `falhas++` (igual `:186-189`); pedido com falha fica para o próximo ciclo diário.

Roteamento (`Deno.serve`):

```ts
const FN = 'backfill-faturamento';
if (temAssinatura) {
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  const parsed = parseBody(body);                 // o parse atual de :233-245 extraído para função
  if (ehMsgOrg(parsed)) {
    const r = await executarMensagem(depsRodada(admin, FN), parsed as MsgOrg<ParamsBackfill>, passoBackfill(depsBackfillReal(admin, parsed.org_id), parsed.org_id));
    return json({ resultado: r }, statusHttp(r));
  }
  if (!fanoutAtivo('FANOUT_BACKFILL')) return legado(parsed);   // o laço de hoje (:246-289), sem mudança
  const intervalo = janela(parsed as Body);
  const recuperacao = !!(parsed as Body).desde;
  const job = recuperacao ? 'backfill-recuperacao' : 'backfill';
  const ciclo = recuperacao ? `${intervalo.desde.slice(0, 10)}_${intervalo.ate.slice(0, 10)}` : cicloDiaBrt(new Date());
  const { data, error } = await admin.from('marketplace_connections').select('org_id').eq('canal', 'mercado_livre');
  if (error) return json({ erro: error.message }, 500);
  const orgs = [...new Set((data ?? []).map((r) => r.org_id as string))];
  const n = await publicarDisparo(FN, orgs.map((org_id) => ({ modo: 'org', job, org_id, ciclo, params: intervalo })));
  console.log(`backfill: disparo job=${job} ciclo=${ciclo} janela=${intervalo.desde}..${intervalo.ate} orgs=${n}`);
  return json({ ok: true, orgs: n });
}
// JWT → manual, inalterado
```

- [ ] **Step 1: Testes que falham**
  - `passo.test.ts` (`DepsBackfill` falso):
    1. conexão null → `proximo:null`; `userId` null → `proximo:null`, sem chamar `token` (Review Focus 5).
    2. Cursor null, `total:45` → `pagina(…, 0, 20)`, `proximo:'vendas|20'`; `'vendas|40'` com 5 pedidos → `'vendas|45'`; `'vendas|45'` → `'mensagens|'` sem `processarPedidos`.
    3. `pagina` lança → o passo rejeita (Review Focus 4).
    4. `processarPedidos` com `mpFalhou:true` → `acumulado.mpFalhou === 1`; somas corretas partindo de `{}`.
    5. Mensagens: 50 packs → 40 por ordem de string, depois 10, depois `proximo:null`; `contaExternaId` null → `proximo:null`.
    6. `processarPacks` lança → rejeita; `token` lança `SemAcessoRodada` → rejeita com `SemAcessoRodada`.
  - `roteamento.test.ts`: extrair a decisão para uma função pura `rotear(parsed, temJwt, flagAtiva)` → `'org' | 'disparo' | 'legado' | 'manual'` e testar: `MsgOrg` → `org`; `{dias:7}` com flag → `disparo`; sem flag → `legado`; sem assinatura → `manual`. E `ciclo`: `{dias:7}` → dia BRT; `{desde,ate}` → `backfill-recuperacao` com ciclo das datas.
  - Manual: um teste que chama `processarConexao` com deps de IO falsos? Não é injetável hoje → **não refatorar**; o manual prova-se por não ter sido tocado: o diff da Task 4 não pode alterar `processarConexao` nem o ramo JWT (checado na revisão).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- supabase/functions/backfill-faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(backfill): rodada por org em páginas (vendas → mensagens) atrás de FANOUT_BACKFILL (ADR-0173)`.

---

### Task 5: Pulse em rodada por org (radar → produtos) com backoff por produto

**Files:**
- Modify: `supabase/functions/pulse-coletar/processar.ts` (extrair de `processarColetaOrg:411-794`; tentativa/backoff no passo 3 `:460-564`)
- Create: `supabase/functions/pulse-coletar/passo.ts`
- Modify: `supabase/functions/pulse-coletar/index.ts`
- Test: `supabase/functions/pulse-coletar/__tests__/passo.test.ts`, `__tests__/backoff.test.ts`, `__tests__/roteamento.test.ts`

**Interfaces:**
- Consumes: Task 1 (colunas), Task 2.
- Produces:

```ts
// processar.ts
export interface ContextoColeta { token: string; proprioSellerId: number | null; naoClassificavel: boolean }
export interface ResultadoLote { produtos: number; gravadas: number; alertas: number; acao: number }
export type ProdutoColeta = PulseProdutoRow & { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null };
export async function prepararContexto(conexao: ConexaoCanal, orgId: string): Promise<ContextoColeta>;   // :419-434
export async function sincronizarRadar(admin: SupabaseClient, orgId: string): Promise<void>;           // passa a exportada
/** Passos 3→7 para ESTE lote (ofertas, vendedores, price-to-win, status/comissão, visitas se baseline,
 *  alertas). NÃO notifica. Mesma regra de hoje, escopada aos produtos recebidos. */
export async function processarLoteProdutos(admin: SupabaseClient, orgId: string, ctx: ContextoColeta,
  produtos: ProdutoColeta[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;
export async function notificarRodadaPulse(admin: SupabaseClient, orgId: string,
  r: { alertas: number; acao: number; naoClassificavel: boolean }): Promise<void>;   // :776-791; LANÇA em erro de envio in-app
export const FALHAS_BACKOFF = 3;
export const DIAS_BACKOFF = 3;
export function elegivelPorBackoff(p: { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null },
  agoraMs: number, tier: 'completo' | 'quente'): boolean;

// passo.ts
export interface ParamsPulse { tier: 'completo' | 'quente' }
export const LOTE_COMPLETO = 20;   // ajustar pela medição (Task 8)
export const LOTE_QUENTE = 40;
export const JANELA_LEITURA = 100; // ids lidos do banco por mensagem para achar até LOTE elegíveis
export interface DepsPulse {
  conexao(): Promise<ConexaoCanal | null>;
  contexto(cx: ConexaoCanal): Promise<ContextoColeta>;        // auth permanente → SemAcessoRodada
  sincronizarRadar(): Promise<void>;
  /** Produtos ativos com id > depoisDe, ordenados por id, no máximo `limite` (quente: só origem 'auto'). */
  produtos(depoisDe: string, limite: number, tier: 'completo' | 'quente'): Promise<ProdutoColeta[]>;
  processarLote(ctx: ContextoColeta, produtos: ProdutoColeta[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;
  agora(): number;
}
export function passoPulse(deps: DepsPulse): Passo<ParamsPulse>;
export const precisaNotificarPulse = (a: Acumulado) => (a.alertas ?? 0) > 0;
```

Regras:
1. `processarColetaOrg` (caminho manual e disparador legado) passa a ser composição das partes: `prepararContexto` → (`completo`) `sincronizarRadar` → mesma seleção de hoje (`:439-446`, agora trazendo também `coleta_falhas_seguidas, coleta_tentativa_em`; **sem** filtro de backoff, para não mudar o manual) → `processarLoteProdutos` → `notificarRodadaPulse` se `alertas > 0` (em try/catch com `console.warn`, como hoje). Retorno `{ produtos, gravadas, alertas }` idêntico.
2. Passo 3: `json === null` → `update pulse_produtos set coleta_tentativa_em = now(), coleta_falhas_seguidas = produto.coleta_falhas_seguidas + 1 where id = …` e `return` (snapshot anterior preservado). Leitura boa → o `patch` de `:548-557` ganha `coleta_tentativa_em: agora, coleta_falhas_seguidas: 0`.
3. `elegivelPorBackoff`: `falhas < 3` → true; senão quente → false; senão `tentativa == null || agoraMs - Date.parse(tentativa) >= 3 * 86_400_000`.
4. `passoPulse` (cursor `radar|` → `produtos|<ultimoIdExaminado>` → fim):
   - Cursor null: `conexao()` null → `throw new SemAcessoRodada('sem conexão ML')`. `completo` → `sincronizarRadar()`, `proximo:'produtos|'` (etapa própria, sem ML). `quente` → segue direto na etapa produtos com `pos = ''`.
   - Etapa `produtos`: `ctx = contexto(cx)`; `lidos = produtos(pos, JANELA_LEITURA, tier)`. `lidos` vazio → `proximo:null`. Percorrer `lidos` **em ordem**, acumulando elegíveis até `LOTE`; `ultimoExaminado` = id do último item percorrido (elegível ou pulado por backoff). **O cursor nunca passa de um item não examinado.** Se houver elegíveis → `processarLote(ctx, elegiveis, tier, baseline = tier === 'completo')`; somar `produtos, gravadas, alertas, acao`; `acumulado.naoClassificavel = max(atual, ctx.naoClassificavel ? 1 : 0)`. `proximo:'produtos|' + ultimoExaminado`.
5. Consumidor: `executarMensagem(deps, m, passoPulse(depsPulseReal(admin, m.org_id)), { precisaNotificar: precisaNotificarPulse, notificar: (a) => notificarRodadaPulse(admin, m.org_id, { alertas: a.alertas ?? 0, acao: a.acao ?? 0, naoClassificavel: (a.naoClassificavel ?? 0) === 1 }) })`. `notificarRodadaPulse` checa o módulo `pulse` antes de enviar (como `:777-781`).
6. Disparador (flag `FANOUT_PULSE`): tier do body como `:42`; orgs = conexões ML cuja org tem `'pulse'` em `organizations.modulos_habilitados`; `job` `pulse-completo` (ciclo `cicloDiaBrt`) ou `pulse-quente` (ciclo `cicloHoraUtc`); `params: { tier }`. Log com orgs publicadas e orgs fora por módulo. Sem flag → legado (`:45-80`).

- [ ] **Step 1: Testes que falham**
  - `backoff.test.ts`: falhas 0/2 → true; 3 em quente → false; 3 em completo com tentativa há 1 dia → false, há 3 dias → true, `null` → true.
  - `passo.test.ts`:
    1. completo, cursor null → `sincronizarRadar` 1x, sem `processarLote`, `proximo:'produtos|'`.
    2. quente, cursor null → sem radar, já processa o 1º lote com `LOTE_QUENTE` e `baseline:false`.
    3. conexão null → rejeita com `SemAcessoRodada`.
    4. 45 elegíveis (ids `p01..p45`), completo, `'produtos|'` → `processarLote` com `p01..p20`, `proximo:'produtos|p20'` (**nunca `p45` nem o fim da janela lida**).
    5. Janela lida com `p01..p10` em backoff e `p11..p45` elegíveis → processa `p11..p30`, `proximo:'produtos|p30'` (Review Focus 5).
    6. Janela lida inteira em backoff → sem `processarLote`, `proximo:'produtos|<último lido>'`.
    7. `lidos` vazio → `proximo:null`.
    8. `naoClassificavel` do contexto vira 1 no acumulado e continua 1 nos lotes seguintes.
  - `roteamento.test.ts`: mesma função `rotear` da Task 4 aplicada ao Pulse (`{tier:'quente'}` com flag → disparo com job `pulse-quente` e ciclo por hora).
  - Manual: teste de `processarColetaOrg` compondo as partes com `processarLoteProdutos` e `sincronizarRadar` substituídos por espiões — prova que o manual chama radar só no completo, **não** aplica backoff, notifica só com `alertas > 0` e devolve `{produtos, gravadas, alertas}`. Para permitir isso, `processarColetaOrg` recebe um parâmetro opcional `partes = { sincronizarRadar, processarLoteProdutos, notificarRodadaPulse, prepararContexto }` com default nas implementações reais.
- [ ] **Step 2:** FAIL. **Step 3:** implementar em 3 commits locais: (a) extração mecânica sem mudar regra, com os testes antigos `alertas-severidade`/`dedupe-preco-caiu` verdes; (b) tentativa/backoff; (c) `passo.ts` + roteamento. **Step 4:** `pnpm test -- supabase/functions/pulse-coletar` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(pulse): rodada por org em lotes, só orgs com módulo, backoff por produto, atrás de FANOUT_PULSE (ADR-0173)`.

---

### Task 6: Reconciliar em rodada por org (perguntas → claims → vendas → liberacoes)

**Files:**
- Create: `supabase/functions/reconciliar-faturamento/passo.ts`
- Modify: `supabase/functions/reconciliar-faturamento/index.ts` (o laço de hoje vira a função `legado()`; blocos `:91-121`, `:123-167`, `:175-233` viram deps por org)
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
  /** :92-120 para UMA org (lista inteira, filtro perguntaPrecisaUpsert, upsert das pendentes). */
  perguntas(token: string, userId: string, orgId: string): Promise<number>;
  /** :124-132: ids de claims que precisam de reprocesso (claimPrecisaProcessar), ordenados crescente. */
  claimsPendentes(token: string, userId: string): Promise<string[]>;
  /** :137-165 para os claims deste lote (MP por pedido já é o caminho de hoje). */
  processarClaims(token: string, cx: ConexaoCanal, userId: string, orgId: string, ids: string[]): Promise<number>;
  sellerId(token: string): Promise<string>;
  pagina(token: string, sellerId: string, janela: { desde: string; ate: string }, offset: number, limit: number): Promise<{ pedidos: PedidoML[]; total: number }>;
  /** :206-229 com carregarLiquidoMPDoPedido por pedido no lugar do mapa de 120 dias; mantém tratarPedidoCancelado. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, orgId: string, pedidos: PedidoML[]): Promise<number>;
  /** carregarLiquidoMP (120 d) + reconciliarLiberacoes (:181-205). MP null → loga e devolve 0. */
  liberacoes(token: string, cx: ConexaoCanal, orgId: string, hojeBRT: string): Promise<number>;
}
export function passoReconciliar(deps: DepsReconciliar, orgId: string): Passo<ParamsReconciliar>;
```

Regras (cursor `perguntas|` → `claims|<ultimoId>` → `vendas|<offset>` → `liberacoes|` → fim):
1. Cursor null → `perguntas|`. `conexao()` null ou `userId` null → `proximo:null` (hoje `:63` pula sem dono).
2. `perguntas`: soma `perguntas`; `proximo:'claims|'`.
3. `claims`: `claimsPendentes` (lista relida por mensagem — custo fixo medido na Task 8), `> pos` (comparação numérica), `LOTE_CLAIMS`; vazio → `'vendas|0'`; senão soma e `'claims|' + ultimo`.
4. `vendas`: igual à etapa de vendas do backfill (página `date_asc`, offset), usando `params.desde/ate`; fim → `'liberacoes|'`.
5. `liberacoes`: soma `liberacoesCorrigidas`; `proximo:null`. **Não é paginado de propósito**: `mapaLiberacaoPorOrder` agrega vários pagamentos do mesmo pedido, e cortar a varredura do MP em páginas pode gravar a data de liberação errada (dado financeiro). O custo desta etapa é medido isolado na Task 8 (é a única coisa na mensagem); se passar do teto, abre-se tarefa própria com agrupamento por pedido antes de paginar.
6. Disparador (flag `FANOUT_RECONCILIAR`): conexões com `criado_por` não nulo; `job:'reconciliar'`, `ciclo: cicloHoraUtc(agora)`, `params: { desde: agora-72h, ate: agora, hojeBRT }` (gravados na abertura). Sem flag → `legado()` (código de hoje, incluindo `ORCAMENTO_MS`).

- [ ] **Step 1: Testes que falham** (`DepsReconciliar` falso): (1) cursor null com conexão → `perguntas` chamado, `proximo:'claims|'`; (2) `userId` null → `proximo:null` sem `token`; (3) 23 claims pendentes → 10/10/3 e depois `'vendas|0'`; (4) vendas `total:60` → `'vendas|25'`, `'vendas|50'`, `'vendas|60'`, depois `'liberacoes|'`; (5) `liberacoes` → `proximo:null` e soma; (6) `token` é chamado em todas as etapas e `SemAcessoRodada` propaga de qualquer uma; (7) `pagina` lança → rejeita.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- supabase/functions/reconciliar-faturamento supabase/functions/_shared/faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(reconciliar): rodada por org em etapas atrás de FANOUT_RECONCILIAR (ADR-0173)`.

---

### Task 7: Teste de equivalência do MP por pedido + documentação

**Files:**
- Test: `supabase/functions/_shared/faturamento/__tests__/mp-por-pedido.test.ts`
- Modify: `docs/reference/edge-functions.md` (modos das 3 funções `~:90-110`; flags `FANOUT_*` e runbook de ativação/rollback; seção do backfill `~:1290-1310`; nota de que `materializar-metricas` está sem schedule em produção, `:157`), `docs/reference/modelo-de-dados.md` (`worker_rodadas`, colunas de `pulse_produtos`), `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/01-Arquitetura/Edge Functions.md`, `obsidian-vault/05-Bugs/Incidentes.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md`

- [ ] **Step 1: Teste de equivalência** — `montarMapaLiquido` (`enriquecimento.ts:8`) aplicado (a) à lista de pagamentos da varredura de 120 dias filtrada aos pagamentos de um pedido e (b) aos pagamentos que `carregarLiquidoMPDoPedido` devolveria para o mesmo pedido produz o mesmo resultado para: pedido com **2 pagamentos**, **estorno total**, **estorno parcial**, e `mapaLiberacaoPorOrder` idem. `carregarLiquidoMPDoPedido` com um `buscarPagamentoMP` que lança → `null` (o passo conta `mpFalhou`). Se a equivalência falhar em algum caso, **parar** e voltar ao planejamento (não trocar o MP nesse caso).
- [ ] **Step 2:** Documentação seguindo a skill `docs-update-checklist`; ADR-0173 atualizado com o protocolo v2 (posse por execução, ciclo/params na linha, notificação pendente, flags). `pnpm docs:links` → OK.
- [ ] **Step 3: Commit** — `docs: ADR-0173 protocolo v2, runbook de ativação e rollback`.

---

### Task 8: Portão, revisão, deploy em etapas, ativação e validação

- [ ] **Step 1: Portão local** — `pnpm preflight`. Expected: verde.
- [ ] **Step 2: Revisão pré-merge** — Grok 4.7 xhigh via Cursor revisa o diff inteiro da branch (regra do projeto). Corrigir o que ele apontar.
- [ ] **Step 3: Push + CI verde** (`frontend`, `backend-lint`).
- [ ] **Step 4: Deploy com fan-out DESLIGADO** — `supabase db push` (confirmar a migration aplicada) → `supabase functions deploy backfill-faturamento pulse-coletar reconciliar-faturamento sync-mensagem responder-mensagem --no-verify-jwt` (as duas últimas importam `mensagens-io.ts`, que mudou) → conferir versões ativas. Sem flags, os schedules seguem no caminho legado: nada muda em produção além do consumidor novo estar disponível. Merge fast-forward na `main`.
- [ ] **Step 5: Ativação por função (OK do Diego antes de cada uma)**, na ordem backfill → pulse → reconciliar:
  1. `supabase secrets set FANOUT_BACKFILL=1` e conferir com `supabase secrets list` que o digest mudou (memória: `secrets set` pode gravar vazio em silêncio);
  2. esperar o próximo schedule (ou publicar 1 disparo manual pelo QStash com o mesmo body do schedule);
  3. conferir `worker_rodadas` (todas as orgs `ok` no ciclo), `function_logs` (`[rodada] lote` por mensagem, 0 `CPUTime`) antes de ativar a próxima função.
- [ ] **Step 6: Rollback** — desligar a flag (`supabase secrets unset FANOUT_X`): o disparador volta ao legado no próximo schedule; mensagens `MsgOrg` já enfileiradas continuam consumidas pelo código novo, que permanece deployado. **Nunca** redeployar a versão anterior das funções com `MsgOrg` na fila: o handler antigo leria a mensagem como execução global (no backfill, janela default de 90 dias). Se for inevitável, antes esvaziar/pausar a fila no QStash.
- [ ] **Step 7: Validação em produção (3 dias, só leitura)**:
  1. 0 shutdowns `CPUTime` nas 3 funções;
  2. `cpu_time_used` dos shutdowns por mensagem, **por etapa** (cada etapa é uma mensagem) < 1.500 ms; acima disso reduzir o `LOTE_*` da etapa; se a etapa for de custo fixo (`radar`, `perguntas`, `claims` lista, `liberacoes`), abrir tarefa própria;
  3. `worker_rodadas`: cada (job, org) com `ok` no ciclo esperado, nenhuma linha `rodando` com `lease_ate` vencido há mais de 1 h;
  4. `notificacoes` categoria `pulse`: no máximo 1 por rodada por org;
  5. `pulse_produtos` da DSA: nenhum produto elegível sem snapshot há mais de 2 dias.
- [ ] **Step 8: Recuperação do buraco de dados (só depois do Step 7 verde e com OK do Diego)** — publicar UMA mensagem ao disparador do backfill com `{"desde":"2026-09-10T00:00:00Z","ate":"<agora ISO>"}` (job `backfill-recuperacao`, não colide com o diário). Conferir `ml_vendas` de 10–27/09 e mensagens novas em `ml_mensagens`. Só então marcar o incidente como resolvido nos docs.
- [ ] **Step 9 (follow-up, fora desta entrega):** depois de 7 dias estáveis, remover o caminho legado e as flags; alarme de rodada parada a partir de `worker_rodadas`.
