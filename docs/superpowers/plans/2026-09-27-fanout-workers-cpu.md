# Fan-out por org em lotes retomáveis (incidente CPU 546) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acabar com os 546 (`CPU Time exceeded`) de `pulse-coletar`, `backfill-faturamento` e `reconciliar-faturamento`: cada mensagem QStash processa uma org e um lote de tamanho fixo.

**Architecture:** O schedule existente vira disparador (1 mensagem por org, dedup por ciclo). Cada (job, org) tem uma rodada em `worker_rodadas` (posse com TTL, cursor `etapa|pos`, acumulado jsonb, ciclo). Um orquestrador puro compartilhado (`_shared/rodada/`) executa **um lote por mensagem** e publica a continuação. Cada função fornece o seu `passo` (o que é um lote e qual é o próximo cursor). Caminhos manuais (botões) não mudam.

**Tech Stack:** Supabase Edge Functions (Deno), Postgres (RPCs `security definer`), QStash (`@upstash/qstash` via `_shared/queue.ts`), vitest.

**Spec:** `docs/decisions/0173-fanout-por-org-workers-agendados-cpu.md` (ADR-0173). Diagnóstico e revisão do Codex: seções "Evidência" do ADR.

## Global Constraints

- Limite que estoura: **2 s de CPU por requisição**. Relógio (90 s) é só proteção secundária.
- Schedules do QStash **não mudam** (cron, body, retries). Nenhum schedule novo.
- Migrations só por `supabase migration new` + `supabase db push`; validar com `npm run db:check` (ADR-0043).
- RPCs de escrita: `security definer set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`. RLS ligada, `select` só da própria org (`current_org_id()`), precedente `20260927084615_vendas_sku_trafego.sql:53-66`.
- Nada de Deno/npm import em módulo puro de `_shared/rodada/` (o vitest carrega). `import type` de `jsr:@supabase/supabase-js@2` é permitido.
- Mercado Livre: só GET (e o refresh OAuth já existente em `_shared/ml/token.ts`). Nenhuma escrita no ML.
- Caminho manual (JWT) de `pulse-coletar` e `backfill-faturamento` **inalterado** no comportamento.
- Worker QStash responde 200 para `ok|continua|obsoleta|sem_acesso` e 500 para `erro` (o QStash repete a mesma mensagem).
- Mensagens por org: `retries: 2` explícito. Continuação: mesma URL da função.
- Repositório público: nenhum valor real de cliente em R$ em arquivo versionado.
- Deploy: `supabase db push` → `supabase functions deploy <fn> --no-verify-jwt` das 3 funções (e de quem importar arquivo alterado de `_shared/`) → conferir versão.

## Review Focus

1. **Retry do schedule depois de a rodada terminar** (dedup do QStash expirado): não pode abrir 2ª rodada no mesmo ciclo nem notificar 2x → `reservar_rodada` recusa ciclo já `ok` (teste SQL na Task 1; teste de orquestrador na Task 2).
2. **Mensagem de continuação atrasada chegando depois de uma rodada nova**: tem que virar `obsoleta`, sem gravar cursor (CAS por rodada+cursor; teste na Task 1 e Task 2).
3. **Org sem conexão / token morto / conexão sem `criado_por`**: conclui `sem_acesso` (ou `ok` vazio para sem dono) e responde 200, sem loop de retry (Tasks 4, 5, 6).
4. **Pulse com 0 produtos elegíveis / todos em backoff**: rodada conclui `ok` sem notificar (Task 5).
5. **Lote que lança no meio** (ML 5xx, erro de rede): 500, retry reprocessa o MESMO lote sem duplicar dado (upserts idempotentes) e o cursor não anda (Task 2).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_worker_rodadas.sql` (novo) | Tabela `worker_rodadas`, 4 RPCs, colunas de tentativa em `pulse_produtos` |
| `supabase/tests/worker_rodadas.sql` (novo) | Contrato das RPCs em Postgres real |
| `supabase/functions/_shared/rodada/rodada.ts` (novo) | Tipos, ciclo, cursor `etapa|pos`, dedup, `ehMsgOrg`, `executarRodada` (puro) |
| `supabase/functions/_shared/rodada/deps.ts` (novo) | Fiação real: RPCs + publish QStash + `publicarDisparo` |
| `supabase/functions/_shared/rodada/__tests__/rodada.test.ts` (novo) | Testes do orquestrador |
| `supabase/functions/_shared/faturamento/mensagens-io.ts` | + `buscarMensagensPackEstrito` |
| `supabase/functions/backfill-faturamento/passo.ts` (novo) | Passo da rodada do backfill (vendas → mensagens) |
| `supabase/functions/backfill-faturamento/index.ts` | Roteamento disparador / org / manual |
| `supabase/functions/pulse-coletar/processar.ts` | Extrair `processarLoteProdutos`; tentativa/backoff por produto |
| `supabase/functions/pulse-coletar/passo.ts` (novo) | Passo da rodada do Pulse (radar → produtos) + notificação na conclusão |
| `supabase/functions/pulse-coletar/index.ts` | Roteamento; disparador filtra módulo `pulse` |
| `supabase/functions/reconciliar-faturamento/passo.ts` (novo) | Passo (perguntas_claims → vendas → liberacoes) |
| `supabase/functions/reconciliar-faturamento/index.ts` | Roteamento disparador / org |
| docs (Task 7) | `edge-functions.md`, `TASKS.md`, `project-status.md`, obsidian |

---

### Task 1: Migration `worker_rodadas` + colunas de tentativa do Pulse

**Files:**
- Create: `supabase/migrations/<timestamp>_worker_rodadas.sql` (via `supabase migration new worker_rodadas`)
- Create: `supabase/tests/worker_rodadas.sql`

**Interfaces:**
- Produces (SQL, só `service_role`):
  - `reservar_rodada(p_job text, p_org uuid, p_ciclo text) returns table (rodada timestamptz)` — 1 linha = posse tomada; 0 linhas = posse viva de outra cadeia OU ciclo já concluído `ok`.
  - `renovar_rodada(p_job text, p_org uuid, p_rodada timestamptz, p_cursor text) returns table (acumulado jsonb)` — 1 linha = ainda é a dona e o cursor bate (posse renovada); 0 linhas = obsoleta.
  - `avancar_rodada(p_job text, p_org uuid, p_rodada timestamptz, p_cursor_atual text, p_cursor_novo text, p_acumulado jsonb) returns boolean`
  - `concluir_rodada(p_job text, p_org uuid, p_rodada timestamptz, p_estado text, p_erro text, p_acumulado jsonb) returns boolean` — só a dona **ainda `rodando`**; `true` uma única vez por rodada.
  - Colunas `pulse_produtos.coleta_tentativa_em timestamptz`, `pulse_produtos.coleta_falhas_seguidas integer not null default 0`.

- [ ] **Step 1: Criar a migration**

Run: `supabase migration new worker_rodadas` e preencher:

```sql
-- ADR-0173: estado das rodadas por (job, org) dos workers agendados em fan-out. Escrita só pelo
-- service_role via RPCs. Contrato: reservar → (renovar no início de cada continuação) → avancar após
-- cada lote → concluir. `rodada` truncada em ms (ida e volta por Date do JS preserva o CAS).

create table public.worker_rodadas (
  job            text not null check (job in ('pulse-completo','pulse-quente','backfill','reconciliar')),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  ciclo          text not null,                 -- dia BRT (diários) ou hora UTC (reconciliar, pulse-quente)
  estado         text not null check (estado in ('rodando','ok','erro','sem_acesso')),
  rodada         timestamptz not null,
  posse_ate      timestamptz,                   -- posse viva enquanto > now()
  cursor         text,                          -- 'etapa|pos'; null = início
  acumulado      jsonb not null default '{}'::jsonb,
  iniciado_em    timestamptz not null,
  ultimo_ok_em   timestamptz,
  ultimo_erro_em timestamptz,
  erro           text,
  primary key (job, org_id)
);

alter table public.worker_rodadas enable row level security;
create policy "worker_rodadas: select org" on public.worker_rodadas for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke all on public.worker_rodadas from anon;
revoke insert, update, delete, truncate, references, trigger on public.worker_rodadas from authenticated;
grant select on public.worker_rodadas to authenticated;

-- Posse nova só se não há cadeia viva E o ciclo pedido ainda não terminou ok. Rodada anterior que
-- morreu (posse expirada, estado 'rodando') é assumida: começa do zero (cursor/acumulado limpos).
create function public.reservar_rodada(p_job text, p_org uuid, p_ciclo text)
returns table (rodada timestamptz)
language sql security definer set search_path = '' as $$
  insert into public.worker_rodadas as w (job, org_id, ciclo, estado, rodada, posse_ate, iniciado_em)
  values (p_job, p_org, p_ciclo, 'rodando', date_trunc('milliseconds', now()), now() + interval '10 minutes', now())
  on conflict (job, org_id) do update set
    ciclo = p_ciclo, estado = 'rodando', rodada = date_trunc('milliseconds', now()),
    posse_ate = now() + interval '10 minutes', iniciado_em = now(), cursor = null,
    acumulado = '{}'::jsonb, erro = null
  where (w.posse_ate is null or w.posse_ate <= now())
    and not (w.ciclo = p_ciclo and w.estado = 'ok')
  returning w.rodada;
$$;

create function public.renovar_rodada(p_job text, p_org uuid, p_rodada timestamptz, p_cursor text)
returns table (acumulado jsonb)
language sql security definer set search_path = '' as $$
  update public.worker_rodadas as w set posse_ate = now() + interval '10 minutes'
   where w.job = p_job and w.org_id = p_org and w.rodada = p_rodada and w.estado = 'rodando'
     and w.cursor is not distinct from p_cursor
  returning w.acumulado;
$$;

create function public.avancar_rodada(p_job text, p_org uuid, p_rodada timestamptz,
                                      p_cursor_atual text, p_cursor_novo text, p_acumulado jsonb)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas
       set cursor = p_cursor_novo, acumulado = p_acumulado, posse_ate = now() + interval '10 minutes'
     where job = p_job and org_id = p_org and rodada = p_rodada and estado = 'rodando'
       and cursor is not distinct from p_cursor_atual
    returning 1)
  select exists (select 1 from u);
$$;

create function public.concluir_rodada(p_job text, p_org uuid, p_rodada timestamptz, p_estado text,
                                       p_erro text default null, p_acumulado jsonb default null)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.worker_rodadas
       set estado = p_estado, posse_ate = null,
           acumulado      = coalesce(p_acumulado, acumulado),
           ultimo_ok_em   = case when p_estado = 'ok' then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado in ('erro','sem_acesso') then now() else ultimo_erro_em end,
           erro           = case when p_estado in ('erro','sem_acesso') then p_erro end
     where job = p_job and org_id = p_org and rodada = p_rodada and estado = 'rodando'
       and p_estado in ('ok','erro','sem_acesso')
    returning 1)
  select exists (select 1 from u);
$$;

revoke all on function public.reservar_rodada(text, uuid, text)                                   from public, anon, authenticated;
revoke all on function public.renovar_rodada(text, uuid, timestamptz, text)                       from public, anon, authenticated;
revoke all on function public.avancar_rodada(text, uuid, timestamptz, text, text, jsonb)          from public, anon, authenticated;
revoke all on function public.concluir_rodada(text, uuid, timestamptz, text, text, jsonb)         from public, anon, authenticated;
grant execute on function public.reservar_rodada(text, uuid, text)                                to service_role;
grant execute on function public.renovar_rodada(text, uuid, timestamptz, text)                    to service_role;
grant execute on function public.avancar_rodada(text, uuid, timestamptz, text, text, jsonb)       to service_role;
grant execute on function public.concluir_rodada(text, uuid, timestamptz, text, text, jsonb)      to service_role;

-- Pulse: tentativa de coleta por produto, separada do snapshot. `mlGet` devolve null para QUALQUER
-- erro, então isto não declara a ficha morta: só tira da frente da fila quem falha seguidamente.
alter table public.pulse_produtos
  add column coleta_tentativa_em timestamptz,
  add column coleta_falhas_seguidas integer not null default 0 check (coleta_falhas_seguidas >= 0);
```

- [ ] **Step 2: Escrever o teste SQL** (`supabase/tests/worker_rodadas.sql`, mesmo formato de `supabase/tests/vendas_sku_trafego.sql`: `\set ON_ERROR_STOP on`, `begin; ... rollback;`, asserts com `do $$ ... raise exception ... $$`). Casos obrigatórios, cada um num bloco `do`:
  1. `reservar_rodada('backfill', org, '2026-09-27')` devolve 1 linha; chamar de novo em seguida devolve 0 linhas (posse viva).
  2. `update worker_rodadas set posse_ate = now() - interval '1 second'` → `reservar_rodada` com o mesmo ciclo devolve 1 linha nova (rodada morta é assumida), `cursor` e `acumulado` zerados.
  3. `concluir_rodada(... 'ok' ...)` devolve `true`; segunda chamada devolve `false`; `reservar_rodada` com o **mesmo ciclo** devolve 0 linhas; com ciclo **diferente** devolve 1 linha.
  4. `avancar_rodada` com rodada antiga (timestamp diferente) devolve `false`; com cursor atual errado devolve `false`; com os certos devolve `true` e grava `cursor`/`acumulado`.
  5. `renovar_rodada` devolve o `acumulado` quando rodada+cursor batem; 0 linhas depois de `concluir_rodada`.
  6. Grants: `has_function_privilege('authenticated', 'public.reservar_rodada(text,uuid,text)', 'execute')` é `false` para as 4 funções; `service_role` é `true`.
  7. `insert into pulse_produtos` sem as colunas novas → `coleta_falhas_seguidas = 0`.

- [ ] **Step 3: Rodar contra Postgres real e ver passar**

Run: `supabase start` (se não estiver no ar) → `npm run db:check` → aplicar a migration no banco local e rodar o teste por `psql` no container, como descrito em memória do projeto (`psql -U supabase_admin`; se `supabase db reset` estiver quebrado, aplicar o arquivo da migration por `psql -f`). Expected: nenhum `ERROR`, saída termina em `ROLLBACK`.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add supabase/migrations/*_worker_rodadas.sql supabase/tests/worker_rodadas.sql
/usr/bin/git commit -F <arquivo-de-mensagem>   # "feat(rodadas): tabela worker_rodadas + RPCs de posse/cursor (ADR-0173)"
```

---

### Task 2: Orquestrador compartilhado `_shared/rodada/`

**Files:**
- Create: `supabase/functions/_shared/rodada/rodada.ts`
- Create: `supabase/functions/_shared/rodada/deps.ts`
- Test: `supabase/functions/_shared/rodada/__tests__/rodada.test.ts`

**Interfaces:**
- Consumes: RPCs da Task 1; `qstashClient()` de `_shared/queue.ts`; `delaySegundos` de `_shared/trafego/fiacao.ts` não é necessário (sem atraso nesta versão).
- Produces (`rodada.ts`, puro):

```ts
export type Job = 'pulse-completo' | 'pulse-quente' | 'backfill' | 'reconciliar';
export type Acumulado = Record<string, number>;
export type ResultadoRodada = 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso';

/** Mensagem por org. `params` carrega o modo original (tier, janela) — nunca reusa o caminho manual. */
export interface MsgOrg<P = Record<string, unknown>> {
  modo: 'org'; job: Job; org_id: string; ciclo: string; params: P;
  primeira: boolean; rodada?: string; cursor?: string | null;
}

/** Erro de token/conexão: a rodada conclui `sem_acesso` e responde 200 (não adianta repetir). */
export class SemAcessoRodada extends Error {}

export interface Cursor { etapa: string; pos: string }
export const lerCursor = (c: string | null | undefined): Cursor | null => { /* 'etapa|pos' → {etapa,pos}; null → null */ };
export const gravarCursor = (c: Cursor): string => `${c.etapa}|${c.pos}`;

export const cicloDiaBrt = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const cicloHoraUtc = (d: Date): string => d.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'

const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_'); // mesmo filtro de trafego/fiacao.ts
export const dedupPrimeira = (fn: string, m: Pick<MsgOrg, 'job' | 'org_id' | 'ciclo'>) => seguro(`${fn}:${m.job}:${m.org_id}:${m.ciclo}`);
export const dedupContinuacao = (fn: string, m: MsgOrg) => seguro(`${fn}:${m.job}:${m.org_id}:${m.rodada}:${m.cursor ?? ''}`);

export function ehMsgOrg(x: unknown): x is MsgOrg { /* modo==='org' && org_id string && job válido && ciclo string && typeof primeira==='boolean' */ }

/** Resultado de um lote. `proximo = null` = a cadeia terminou. */
export interface ResultadoPasso { proximo: string | null; acumulado: Acumulado }
/** Processa UM lote a partir de `cursor` (null = início). Lança SemAcessoRodada ou Error. */
export type Passo = (cursor: string | null, acumulado: Acumulado) => Promise<ResultadoPasso>;

export interface DepsRodada {
  reservar(job: Job, orgId: string, ciclo: string): Promise<string | null>;               // rodada | null
  renovar(job: Job, orgId: string, rodada: string, cursor: string | null): Promise<Acumulado | null>;
  avancar(job: Job, orgId: string, rodada: string, atual: string | null, novo: string | null, acumulado: Acumulado): Promise<boolean>;
  concluir(job: Job, orgId: string, rodada: string, estado: 'ok' | 'erro' | 'sem_acesso', erro: string | null, acumulado: Acumulado | null): Promise<boolean>;
  continuar(msg: MsgOrg): Promise<void>;
}

/** Executa UM lote da rodada. `aoConcluir` roda só se `concluir('ok')` devolveu true (1x por rodada). */
export async function executarRodada(
  deps: DepsRodada, msg: MsgOrg, passo: Passo, aoConcluir?: (acumulado: Acumulado) => Promise<void>,
): Promise<ResultadoRodada>;

/** HTTP da resposta ao QStash: 500 só para 'erro'. */
export const statusHttp = (r: ResultadoRodada): number => (r === 'erro' ? 500 : 200);
```

- Produces (`deps.ts`, fiação real):

```ts
export function depsRodada(admin: SupabaseClient, urlFuncao: string, fn: string): DepsRodada;
/** Publica 1 MsgOrg `primeira` por org (retries 2, dedupPrimeira). Lança se algum publish falhar
 *  (o disparador responde 500 e o QStash repete o schedule; o dedup + reservar_rodada seguram a repetição). */
export async function publicarDisparo(urlFuncao: string, fn: string, msgs: MsgOrg[]): Promise<number>;
export const urlDaFuncao = (fn: string) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/${fn}`;
```

Comportamento de `executarRodada` (implementar exatamente):

```ts
export async function executarRodada(deps, msg, passo, aoConcluir) {
  let rodada: string;
  let cursor: string | null;
  let acumulado: Acumulado;
  if (msg.primeira) {
    const r = await deps.reservar(msg.job, msg.org_id, msg.ciclo);
    if (!r) return 'obsoleta';
    rodada = r; cursor = null; acumulado = {};
  } else {
    if (!msg.rodada) return 'obsoleta';
    const a = await deps.renovar(msg.job, msg.org_id, msg.rodada, msg.cursor ?? null);
    if (!a) return 'obsoleta';
    rodada = msg.rodada; cursor = msg.cursor ?? null; acumulado = a;
  }
  const inicio = Date.now();
  let res: ResultadoPasso;
  try {
    res = await passo(cursor, acumulado);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    if (e instanceof SemAcessoRodada) {
      await deps.concluir(msg.job, msg.org_id, rodada, 'sem_acesso', erro, null);
      console.warn('[rodada] sem_acesso', { job: msg.job, org_id: msg.org_id, erro });
      return 'sem_acesso';
    }
    // NÃO conclui: o QStash repete esta mesma mensagem (posse viva, cursor parado). Esgotados os retries,
    // a posse expira em 10 min e o próximo ciclo assume.
    console.error('[rodada] lote falhou', { job: msg.job, org_id: msg.org_id, cursor, erro });
    return 'erro';
  }
  console.log('[rodada] lote', { job: msg.job, org_id: msg.org_id, cursor, proximo: res.proximo, ms: Date.now() - inicio });
  if (res.proximo === null) {
    const dona = await deps.concluir(msg.job, msg.org_id, rodada, 'ok', null, res.acumulado);
    if (!dona) return 'obsoleta';
    if (aoConcluir) {
      try { await aoConcluir(res.acumulado); }
      catch (e) { console.error('[rodada] aoConcluir falhou', { job: msg.job, org_id: msg.org_id, erro: e instanceof Error ? e.message : e }); }
    }
    return 'ok';
  }
  if (!(await deps.avancar(msg.job, msg.org_id, rodada, cursor, res.proximo, res.acumulado))) return 'obsoleta';
  await deps.continuar({ ...msg, primeira: false, rodada, cursor: res.proximo });
  return 'continua';
}
```

Nota para o implementador: se `continuar` lançar depois do `avancar`, a mensagem responde 500 e o retry chega com o cursor ANTIGO → `renovar` devolve 0 linhas → `obsoleta`, e a cadeia fica parada até a posse expirar. Para não perder a cadeia, trate assim: `try { await deps.continuar(...) } catch (e) { await deps.avancar(msg.job, msg.org_id, rodada, res.proximo, cursor, acumulado /* o de entrada */); throw e; }` — devolve o cursor ao ponto anterior antes de propagar, e o `executarRodada` externo converte o throw em `'erro'` (envolver o bloco final no mesmo padrão de log).

- [ ] **Step 1: Escrever os testes que falham** (`rodada.test.ts`, deps falsas em memória simulando a tabela: um objeto `{ rodada, cursor, acumulado, estado, posseViva, ciclo }`). Casos:
  1. `primeira` com reservar=null → `'obsoleta'`, passo não é chamado.
  2. `primeira`, passo devolve `{proximo:'vendas|10', acumulado:{n:5}}` → `'continua'`; `avancar` chamado com `(null → 'vendas|10')`; `continuar` recebe `{primeira:false, rodada, cursor:'vendas|10'}`.
  3. continuação com `renovar`=null → `'obsoleta'`, passo não chamado (Review Focus 2).
  4. passo devolve `proximo:null` → `concluir('ok')` com o acumulado; `aoConcluir` chamado 1x; se `concluir` devolver false → `'obsoleta'` e `aoConcluir` NÃO chamado (Review Focus 1).
  5. passo lança `Error` → `'erro'`, `avancar`/`concluir`/`continuar` não chamados (Review Focus 5).
  6. passo lança `SemAcessoRodada` → `concluir('sem_acesso')`, resultado `'sem_acesso'`, `statusHttp` = 200.
  7. `continuar` lança → cursor devolvido ao anterior (segunda chamada de `avancar` com novo→antigo) e resultado `'erro'`.
  8. `aoConcluir` lança → resultado continua `'ok'`.
  9. `lerCursor('vendas|123')` → `{etapa:'vendas',pos:'123'}`; `lerCursor('radar|')` → `{etapa:'radar',pos:''}`; `lerCursor(null)` → `null`.
  10. `cicloDiaBrt(new Date('2026-09-28T02:30:00Z'))` → `'2026-09-27'`; `cicloHoraUtc(new Date('2026-09-28T02:30:00Z'))` → `'2026-09-28T02'`.
  11. `dedupPrimeira` só contém `[A-Za-z0-9_-]`; `ehMsgOrg({})` false; `ehMsgOrg({tier:'completo'})` false (body de schedule nunca é MsgOrg).

- [ ] **Step 2:** `pnpm test -- supabase/functions/_shared/rodada` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `rodada.ts` e `deps.ts` (deps: cada método chama a RPC da Task 1 via `admin.rpc`, lançando em `error`; `reservar` devolve `data?.[0]?.rodada ?? null`; `renovar` devolve `data?.[0]?.acumulado ?? null`; `continuar` = `qstashClient().publishJSON({ url, body: msg, retries: 2, deduplicationId: dedupContinuacao(fn, msg) })`; `publicarDisparo` idem com `dedupPrimeira`, sequencial, lança no primeiro erro depois de tentar todos e loga quantos saíram).
- [ ] **Step 4:** `pnpm test -- supabase/functions/_shared/rodada` → PASS; `pnpm lint:functions && pnpm check:functions` → sem erro.
- [ ] **Step 5: Commit** — `feat(rodadas): orquestrador de rodada por org com cursor (ADR-0173)`.

---

### Task 3: Leitura estrita de mensagens do pack

**Files:**
- Modify: `supabase/functions/_shared/faturamento/mensagens-io.ts:37-45` (adicionar função; a existente fica igual — `sync-mensagem` e `responder-mensagem` continuam usando `buscarMensagensPack`)
- Test: `supabase/functions/_shared/faturamento/__tests__/mensagens-estrito.test.ts` (conferir se a pasta existe; senão criar)

**Interfaces:**
- Produces:

```ts
/** Igual a buscarMensagensPack, mas falha transitória (429, 5xx, timeout/rede) LANÇA — o backfill
 *  repete o lote em vez de gravar "sem mensagens" calado. 403/404 = pack sem mensagens acessíveis → []. */
export async function buscarMensagensPackEstrito(
  token: string, packId: string | number, sellerId: string | number, f: typeof fetch = fetch,
): Promise<MensagemML[]> {
  const url = `${API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`;
  const resp = await f(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (resp.status === 403 || resp.status === 404) return [];
  if (!resp.ok) throw new Error(`ML /messages ${resp.status} (pack ${packId})`);
  return extrairMensagens(await resp.json());
}
```

- [ ] **Step 1:** Testes com `fetch` falso: 200 com corpo de mensagens → lista parseada (usar o mesmo formato que `extrairMensagens` já aceita — copiar um fixture de teste existente, se houver, ou montar `{ messages: [...] }` conforme o parser); 404 → `[]`; 403 → `[]`; 429 → rejeita; 500 → rejeita; `fetch` que lança (rede) → rejeita.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** — `feat(faturamento): leitura estrita de mensagens do pack para o backfill`.

---

### Task 4: Backfill em rodada por org (vendas → mensagens)

**Files:**
- Create: `supabase/functions/backfill-faturamento/passo.ts`
- Modify: `supabase/functions/backfill-faturamento/index.ts:217-289` (roteamento); `processarConexao` (`:92-215`) fica intacta para o caminho manual
- Test: `supabase/functions/backfill-faturamento/__tests__/passo.test.ts`

**Interfaces:**
- Consumes: `executarRodada`, `SemAcessoRodada`, `lerCursor`, `gravarCursor`, `MsgOrg`, `depsRodada`, `publicarDisparo`, `urlDaFuncao`, `statusHttp`, `cicloDiaBrt`, `ehMsgOrg` (Task 2); `buscarMensagensPackEstrito` (Task 3).
- Produces:

```ts
export interface ParamsBackfill { desde: string; ate: string }
export const LOTE_PEDIDOS = 20;   // medir e ajustar (Task 8)
export const LOTE_PACKS = 40;
export interface DepsBackfill {
  /** Dono legado da conexão da org (criado_por) + conexão; null = org sem conexão ML. */
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  token(): Promise<string>;                        // lança SemAcessoRodada em erro permanente de auth
  pedidos(intervalo: ParamsBackfill): Promise<{ id: number }[]>; // lista completa da janela (buscarPedidosPeriodo)
  processarPedidos(pedidos: { id: number }[]): Promise<{ ok: number; falhas: number; mpFalhou: boolean }>;
  packs(): Promise<{ packId: string }[]>;          // listarPacksDeVendas(admin, userId)
  processarPacks(packs: { packId: string }[]): Promise<number>; // lança em falha transitória (Task 3)
}
export function passoBackfill(deps: DepsBackfill, params: ParamsBackfill): Passo;
```

Regras do `passoBackfill` (cursor `vendas|<ultimoOrderId>` → `mensagens|<ultimoPackId>` → fim):
1. `conexao()` null ou `userId` null → `{ proximo: null, acumulado }` (conclui `ok` vazio; mesmo efeito de `SEM_NADA` hoje, `index.ts:97`).
2. Cursor null ou etapa `vendas`: `pedidos(params)`, ordenar por `id` asc (numérico), pegar os de `id > pos` (pos vazio = todos), fatiar `LOTE_PEDIDOS`. Lote vazio → `proximo = 'mensagens|'`. Senão `processarPedidos(lote)`; `acumulado.sincronizados += ok`, `acumulado.pedidosComFalha += falhas`, `acumulado.mpFalhou = 1` se `mpFalhou`; `proximo = 'vendas|' + ultimoId`.
3. Etapa `mensagens`: `conexao().cx.contaExternaId` null → fim. Senão `packs()`, ordenar por `packId` (string, `localeCompare`), `> pos`, fatiar `LOTE_PACKS`. Vazio → `proximo: null`. Senão `acumulado.packs += await processarPacks(lote)`; `proximo = 'mensagens|' + ultimoPackId`.
4. **Não** relê perguntas nem claims (ADR-0173 §7: o reconciliar relê de hora em hora).

`processarPedidos` real (em `index.ts` ou `passo.ts`, fiação): por lote, `carregarCatalogo(admin, userId)` 1x; `carregarGtinsFallback(token, lote, idsPubliai)`; por pedido em `chunk(lote, PARALELAS)`: `buscarFreteVendedor`, `buscarShipment`, **`carregarLiquidoMPDoPedido(token, Number(cx.contaExternaId), paymentIds)`** (em vez da varredura de 120 dias — mesmo contrato de retorno, `null` = MP falhou → `mpFalhou`), `upsertVenda(...)` com os mesmos argumentos de `index.ts:181-184`. Falha por pedido: `console.warn` e conta em `falhas` (igual `:186-189`). `pedidos()` lança se `buscarPedidosPeriodo` lançar (vira `erro` → retry).

`token()`: `getValidAccessTokenConexao(cx)`; se o erro for `MLApiError` classificado `permanente-auth` por `classificarErroML` → `throw new SemAcessoRodada(msg)`; senão relança.

Roteamento novo em `Deno.serve` (substitui `:217-289` mantendo o ramo manual idêntico):

```ts
const FN = 'backfill-faturamento';
if (temAssinatura) {
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  const parsed = parseBody(body);                       // extrair o parse atual (:233-245) para uma função
  if (ehMsgOrg(parsed)) {
    const msg = parsed as MsgOrg<ParamsBackfill>;
    const r = await executarRodada(depsRodada(admin, urlDaFuncao(FN), FN), msg,
      passoBackfill(depsBackfillReal(admin, msg.org_id), msg.params));
    return new Response(JSON.stringify({ resultado: r }), { status: statusHttp(r), headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // Disparador: janela calculada UMA vez aqui, todas as orgs da rodada usam a mesma.
  const intervalo = janela(parsed as Body);
  console.log(`backfill: disparo janela ${intervalo.desde}..${intervalo.ate}`);
  const { data } = await admin.from('marketplace_connections').select('org_id').eq('canal', 'mercado_livre');
  const orgs = [...new Set((data ?? []).map((r) => r.org_id as string))];
  const ciclo = (parsed as Body).desde ? `manual-${intervalo.desde.slice(0, 10)}-${intervalo.ate.slice(0, 10)}` : cicloDiaBrt(new Date());
  const n = await publicarDisparo(urlDaFuncao(FN), FN, orgs.map((org_id) => ({
    modo: 'org', job: 'backfill', org_id, ciclo, params: intervalo, primeira: true,
  })));
  return new Response(JSON.stringify({ ok: true, orgs: n }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
// ramo manual (JWT) — inalterado: processarConexao + auditarOperacaoSuporte + resposta atual
```

- [ ] **Step 1: Testes que falham** (`passo.test.ts`, `DepsBackfill` falso):
  1. conexão null → `proximo:null` (Review Focus 3); `userId` null → `proximo:null`.
  2. 45 pedidos (ids 1..45 embaralhados), cursor null → processa ids 1..20, `proximo:'vendas|20'`, `acumulado.sincronizados` soma o `ok`.
  3. cursor `'vendas|40'` → processa 41..45, `proximo:'vendas|45'`; cursor `'vendas|45'` → lote vazio → `proximo:'mensagens|'` sem chamar `processarPedidos`.
  4. `processarPedidos` devolve `mpFalhou:true` → `acumulado.mpFalhou === 1`.
  5. mensagens: 50 packs, cursor `'mensagens|'` → 40 primeiros por ordem de string, `proximo:'mensagens|<40º>'`; depois o resto; depois `proximo:null`.
  6. `contaExternaId` null na etapa mensagens → `proximo:null`.
  7. `processarPacks` lança → o passo propaga (o orquestrador converte em `erro`).
  8. `token()` lança `SemAcessoRodada` → o passo propaga `SemAcessoRodada`.
  9. `pedidos()` nunca é chamado na etapa `mensagens`; `packs()` nunca na etapa `vendas`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar `passo.ts` + fiação `depsBackfillReal` + roteamento. **Step 4:** `pnpm test -- supabase/functions/backfill-faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(backfill): fan-out por org em lotes (vendas → mensagens), sem reler perguntas/claims no agendado (ADR-0173)`.

---

### Task 5: Pulse em rodada por org (radar → produtos), com backoff por produto

**Files:**
- Modify: `supabase/functions/pulse-coletar/processar.ts` (extrair `processarLoteProdutos` de `processarColetaOrg:411-794`; tentativa/backoff no passo 3 `:460-564`)
- Create: `supabase/functions/pulse-coletar/passo.ts`
- Modify: `supabase/functions/pulse-coletar/index.ts` (roteamento; disparador filtra módulo)
- Test: `supabase/functions/pulse-coletar/__tests__/passo.test.ts`, `supabase/functions/pulse-coletar/__tests__/backoff.test.ts`

**Interfaces:**
- Consumes: Task 2 (`executarRodada`, `MsgOrg`, `lerCursor`, `gravarCursor`, `SemAcessoRodada`, `depsRodada`, `publicarDisparo`, `urlDaFuncao`, `statusHttp`, `cicloDiaBrt`, `cicloHoraUtc`, `ehMsgOrg`); colunas da Task 1.
- Produces:

```ts
// processar.ts
export interface ContextoColeta { token: string; proprioSellerId: number | null; naoClassificavel: boolean }
export interface ResultadoLote { produtos: number; gravadas: number; alertas: number; acao: number }
/** Passos 3→7 (ofertas, vendedores, price-to-win, status/comissão, visitas se baseline, alertas) para ESTE
 *  lote. NÃO notifica. Mesma lógica de hoje, só escopada aos produtos recebidos. */
export async function processarLoteProdutos(
  admin: SupabaseClient, orgId: string, ctx: ContextoColeta, produtos: PulseProdutoRow[],
  tier: 'completo' | 'quente', baseline: boolean,
): Promise<ResultadoLote>;
export async function prepararContexto(conexao: ConexaoCanal, orgId: string): Promise<ContextoColeta>; // token + seller id (:419-434)
export { sincronizarRadar };  // passa a ser exportada
export async function notificarRodadaPulse(admin: SupabaseClient, orgId: string, total: number, acao: number, naoClassificavel: boolean): Promise<void>; // :776-791 extraído
/** Janela de backoff: produto com >= 3 falhas seguidas só volta depois de 3 dias sem tentativa. */
export const FALHAS_BACKOFF = 3;
export const DIAS_BACKOFF = 3;
export function elegivelPorBackoff(p: { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null }, agoraMs: number, tier: 'completo' | 'quente'): boolean;

// passo.ts
export interface ParamsPulse { tier: 'completo' | 'quente' }
export const LOTE_COMPLETO = 20;   // medir e ajustar (Task 8)
export const LOTE_QUENTE = 40;
export interface DepsPulse {
  conexao(): Promise<ConexaoCanal | null>;
  contexto(cx: ConexaoCanal): Promise<ContextoColeta>;          // lança SemAcessoRodada em auth permanente
  sincronizarRadar(): Promise<void>;
  /** Próximos `limite` produtos ativos com id > depoisDe, ordenados por id (quente: só origem 'auto'). */
  produtos(depoisDe: string, limite: number, tier: 'completo' | 'quente'): Promise<(PulseProdutoRow & { coleta_falhas_seguidas: number; coleta_tentativa_em: string | null })[]>;
  processarLote(ctx: ContextoColeta, produtos: PulseProdutoRow[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;
  agora(): number;
}
export function passoPulse(deps: DepsPulse, params: ParamsPulse): Passo;
```

Regras:
1. `processarColetaOrg` continua existindo para o **caminho manual** e passa a ser: `prepararContexto` → (`completo`) `sincronizarRadar` → mesma seleção de hoje (`:439-446`, ordenada por `ultimo_snapshot_em`, `limit maxProdutos`) → `processarLoteProdutos` → `notificarRodadaPulse` se `alertas > 0`. Resultado externo idêntico ao de hoje (`{ produtos, gravadas, alertas }`).
2. Passo 3 (`:460-564`): quando `json === null` → `update pulse_produtos set coleta_tentativa_em = now, coleta_falhas_seguidas = <atual + 1>` e `return` (o snapshot anterior fica). Quando a leitura dá certo → o `patch` de `:548-557` ganha `coleta_tentativa_em: agora, coleta_falhas_seguidas: 0`. Para ter o valor atual, o select de produtos passa a trazer `coleta_falhas_seguidas`.
3. `elegivelPorBackoff`: `falhas < FALHAS_BACKOFF` → true; senão `tier === 'quente'` → false; senão `coleta_tentativa_em == null || agoraMs - Date.parse(coleta_tentativa_em) >= DIAS_BACKOFF * 86_400_000`.
4. `passoPulse` (cursor `radar|` → `produtos|<ultimoId>` → fim):
   - Cursor null: `conexao()` null → `throw new SemAcessoRodada('sem conexão ML')`. Tier `completo` → `sincronizarRadar()` e `proximo = 'produtos|'` (etapa própria: o radar lê todos os anúncios publicados da org). Tier `quente` → cai direto na etapa produtos com `pos=''`.
   - Etapa `produtos`: `ctx = contexto(cx)` (1x por mensagem); busca `produtos(pos, limite*2, tier)` e filtra `elegivelPorBackoff`, pegando até `limite` (`LOTE_COMPLETO`/`LOTE_QUENTE`). O cursor avança para o **último id lido do banco** (inclusive os pulados por backoff), para nunca travar. Nenhum id lido → `proximo: null`. Lote elegível vazio mas houve ids lidos → só avança o cursor. Senão `processarLote(ctx, elegiveis, tier, baseline = tier === 'completo')`; somar `produtos, gravadas, alertas, acao` no acumulado; guardar `acumulado.naoClassificavel = ctx.naoClassificavel ? 1 : 0`.
5. `aoConcluir` (passado ao `executarRodada`): se `acumulado.alertas > 0` → `notificarRodadaPulse(admin, org, alertas, acao, naoClassificavel === 1)`. Uma vez por rodada (garantido por `concluir_rodada`, Task 1/2).
6. Disparador (`index.ts`, ramo assinado sem `MsgOrg`): tier do body como hoje (`:42`); orgs = conexões ML cuja org tem `'pulse'` em `organizations.modulos_habilitados` (uma query com join `organizations!inner(modulos_habilitados)` ou duas queries); job `pulse-completo` (ciclo `cicloDiaBrt`) ou `pulse-quente` (ciclo `cicloHoraUtc`); `params: { tier }`. Log `pulse: disparo tier=X orgs=N (fora por módulo: M)`.
7. Ramo manual (JWT) inalterado.

- [ ] **Step 1: Testes que falham**
  - `backoff.test.ts`: `elegivelPorBackoff` — falhas 0/2 → true; falhas 3 em quente → false; falhas 3 em completo com tentativa há 1 dia → false, há 3 dias → true, `null` → true.
  - `passo.test.ts` (`DepsPulse` falso):
    1. completo, cursor null → chama `sincronizarRadar`, não chama `processarLote`, `proximo:'produtos|'`.
    2. quente, cursor null → não chama `sincronizarRadar`, já processa o primeiro lote.
    3. conexão null → lança `SemAcessoRodada` (Review Focus 3).
    4. 45 produtos elegíveis, completo, cursor `'produtos|'` → `processarLote` com 20, `baseline:true`, `proximo:'produtos|<id do 20º>'`; acumulado soma o `ResultadoLote`.
    5. lote em que todos estão em backoff → `processarLote` não é chamado e o cursor avança para o último id lido (Review Focus 4).
    6. nenhum produto restante → `proximo:null`.
    7. quente → `processarLote(..., 'quente', baseline:false)` e `limite` 40.
    8. `naoClassificavel` do contexto vai para o acumulado como 1/0.
  - Teste do contrato do caminho manual: `processarColetaOrg` segue exportada com a mesma assinatura (compilação via `pnpm check:functions`).
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar (extração mecânica primeiro, sem mudar regra; depois tentativa/backoff; depois `passo.ts`; depois roteamento). **Step 4:** `pnpm test -- supabase/functions/pulse-coletar` (inclui os testes antigos `alertas-severidade` e `dedupe-preco-caiu`) → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(pulse): fan-out por org em lotes, só orgs com módulo, backoff por produto (ADR-0173)`.

---

### Task 6: Reconciliar em rodada por org (perguntas_claims → vendas → liberacoes)

**Files:**
- Create: `supabase/functions/reconciliar-faturamento/passo.ts`
- Modify: `supabase/functions/reconciliar-faturamento/index.ts` (todo o `Deno.serve`; os blocos de `:87-167`, `:175-233` viram funções de deps)
- Test: `supabase/functions/reconciliar-faturamento/__tests__/passo.test.ts`

**Interfaces:**
- Consumes: Task 2; `carregarLiquidoMPDoPedido` (já existe).
- Produces:

```ts
export const JANELA_HORAS = 72;
export const LOTE_PEDIDOS = 25;  // medir e ajustar (Task 8)
export interface DepsReconciliar {
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Token + liveness (registrarSyncOk / registrarFalhaAuth + notificação 'integracao' se !jaAlertado),
   *  exatamente como index.ts:65-78. Auth permanente → SemAcessoRodada. */
  tokenComLiveness(cx: ConexaoCanal): Promise<string>;
  token(cx: ConexaoCanal): Promise<string>;            // sem liveness (etapas seguintes)
  perguntasEClaims(token: string): Promise<void>;       // corpo de index.ts:91-167 para UMA org
  pedidos72h(token: string, janela: { desde: string; ate: string }): Promise<{ id: number }[]>;
  processarPedidos(token: string, lote: { id: number }[]): Promise<number>; // :206-229 com MP por pedido
  liberacoes(token: string): Promise<number>;           // carregarLiquidoMP 120d + reconciliarLiberacoes (:181-205); null do MP → loga e devolve 0
}
export function passoReconciliar(deps: DepsReconciliar, janela: { desde: string; ate: string }): Passo;
```

Regras (cursor `perguntas_claims|` → `vendas|<ultimoId>` → `liberacoes|` → fim):
1. Cursor null: `conexao()` null ou `userId` null → `proximo:null` (hoje `:63` pula a conexão sem dono). Senão `tokenComLiveness` → `perguntasEClaims` → `proximo:'vendas|'`.
2. `vendas`: `token`, `pedidos72h`, ordenar por id, `> pos`, fatiar `LOTE_PEDIDOS`; vazio → `proximo:'liberacoes|'`; senão `acumulado.reconciliados += processarPedidos(...)`, `proximo:'vendas|<ultimo>'`.
3. `liberacoes`: `acumulado.liberacoesCorrigidas += liberacoes(token)`; `proximo:null`.
4. `processarPedidos` usa `carregarLiquidoMPDoPedido` por pedido (em vez do mapa de 120 dias) e mantém `tratarPedidoCancelado` (`:220-225`) — idempotente.
5. Disparador: conexões ML com `criado_por` não nulo, `job:'reconciliar'`, `ciclo: cicloHoraUtc(new Date())`, `params: { desde, ate }` — a janela de 72 h é calculada UMA vez no disparador e todas as etapas da rodada usam a mesma (`passoReconciliar(deps, msg.params)` e `pedidos72h(token, params)`). `ORCAMENTO_MS`, `restante()` e `pulou` saem (o limite agora é o lote).

- [ ] **Step 1: Testes que falham** (`DepsReconciliar` falso): (1) cursor null com conexão ok chama `tokenComLiveness` e `perguntasEClaims`, `proximo:'vendas|'`; (2) `userId` null → `proximo:null` sem chamar token; (3) 60 pedidos → 25/25/10, depois `'liberacoes|'`; (4) `liberacoes` → `proximo:null` e soma no acumulado; (5) `tokenComLiveness` lança `SemAcessoRodada` → propaga; (6) etapas seguintes chamam `token`, nunca `tokenComLiveness` (liveness 1x por rodada).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test -- supabase/functions/reconciliar-faturamento` + testes existentes de `_shared/faturamento` → PASS; `pnpm lint:functions && pnpm check:functions`.
- [ ] **Step 5: Commit** — `feat(reconciliar): fan-out por org em etapas (ADR-0173)`.

---

### Task 7: Documentação

**Files:**
- Modify: `docs/reference/edge-functions.md` (linhas das 3 funções na tabela de modos `~:90-110`; seção do backfill `~:1290-1310` — "Correção de raiz pendente" vira resolvida; nota de que `materializar-metricas` está sem schedule em produção, `:157`)
- Modify: `docs/TASKS.md`, `docs/project-status.md`, `obsidian-vault/01-Arquitetura/Edge Functions.md`, `obsidian-vault/05-Bugs/Incidentes.md`, `obsidian-vault/04-Decisões/Índice de ADRs.md` (ADR-0173)
- Modify: `docs/reference/modelo-de-dados.md` (tabela `worker_rodadas`, colunas novas de `pulse_produtos`)
- Modify: `src/lib/database.types.ts` só se o front passar a ler `worker_rodadas` (não passa nesta entrega → não mexer)

- [ ] **Step 1:** Seguir a skill `docs-update-checklist`. **Step 2:** `pnpm docs:links` → sem link quebrado. **Step 3:** Commit — `docs: ADR-0173 fan-out por org nos workers agendados`.

---

### Task 8: Validação local, revisão, deploy e validação em produção

- [ ] **Step 1: Portão local** — `pnpm preflight` (portão oficial de pré-push). Expected: verde.
- [ ] **Step 2: Medição de lote (antes do deploy, sem produção):** não há como medir CPU local. Os tamanhos `LOTE_*` partem de: Pulse completo 20 (a Avil, 232 produtos, rodava ~1,8 s em 1 requisição; 20 produtos ≈ 1/12 disso), backfill 20 pedidos, reconciliar 25. A medição real é o Step 7.
- [ ] **Step 3: Revisão pré-merge** — Grok 4.7 xhigh via Cursor revisa o diff inteiro da branch (regra do projeto).
- [ ] **Step 4: Push + CI verde** (`frontend`, `backend-lint`).
- [ ] **Step 5: Deploy em ordem** — `supabase db push` (confirmar a migration aplicada) → `supabase functions deploy backfill-faturamento pulse-coletar reconciliar-faturamento --no-verify-jwt` + qualquer outra função que importe `_shared/faturamento/mensagens-io.ts` (`sync-mensagem`, `responder-mensagem`: o arquivo mudou, redeployar por regra do projeto) → conferir versões ativas. Depois merge fast-forward na `main`.
- [ ] **Step 6: Recuperação do buraco de dados (pedir OK do Diego antes)** — publicar UMA mensagem para o disparador do backfill com `{"desde":"2026-09-10T00:00:00Z","ate":"<agora>"}` (ciclo `manual-...`, não colide com o diário). Só GET no ML; escreve no nosso banco pelo fluxo normal.
- [ ] **Step 7: Validação em produção (3 dias, só leitura)** — por `logs` da Management API e SQL read-only:
  1. 0 eventos `CPU Time exceeded` / shutdown `CPUTime` para as 3 funções;
  2. `cpu_time_used` dos shutdowns por mensagem < 1.500 ms (se passar, reduzir o `LOTE_*` correspondente);
  3. `select job, org_id, estado, ciclo, ultimo_ok_em, erro from worker_rodadas` → toda (job, org) com `ok` no ciclo esperado;
  4. `pulse_produtos` da DSA sem snapshot parado > 2 dias fora dos produtos em backoff;
  5. `notificacoes` categoria `pulse`: no máximo 1 por rodada por org;
  6. backfill: `ml_vendas` com vendas de 10–27/09 presentes após o Step 6; mensagens novas em `ml_mensagens`.
