# Cancelamento tardio: fila própria armada pelo banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo pedido que o ML passa a dizer `cancelled` é levado a `tratarPedidoCancelado`, não importa quem gravou a venda nem quando.

**Architecture:**
- Tabela nova `ml_cancelamentos_pendentes`, armada por trigger `after update of raw` em `ml_vendas`.
- Etapa nova `cancelamentos` no `reconciliar-faturamento` (fan-out), entre `pendencias` e `perguntas`: um lote de 20 por org por hora.
- RPC nova `registrar_cancelamentos_tratados` grava o desfecho do lote.
- `backfill-faturamento`, `cancelamento.ts`, `kit.ts`, `pendencias.ts` e `worker_pendencias` **não mudam**.

**Tech Stack:** Postgres/Supabase (migration, trigger, RLS, RPC), Deno edge function, vitest.

**Spec:** `docs/decisions/0211-obrigacao-de-cancelamento-com-fila-propria.md` (ler inteiro antes de começar; ler também ADR-0121).

**Classificação:** CRÍTICA (migration + caminho de estoque).
- Revisão independente obrigatória antes do merge: Codex Sol na versão mais recente (`codex debug models`), `model_reasoning_effort=high`, `-s read-only`, `< /dev/null`, contexto limpo, recebendo só o diff, os arquivos tocados e o ADR-0211. Ou subagente Opus high, se o autor for Codex.
- Implementador: Sonnet ou superior. Nunca rebaixar.
- O revisor reprovou duas tentativas anteriores por 8 motivos (ADR-0211, Alternativas rejeitadas). Cada um tem teste próprio aqui (tabela "Teste por risco").

## Global Constraints

- Trabalhar em worktree próprio, nunca na `main`. Copiar `.env.local` e `.env.test`.
- Migration **só** via `supabase migration new ml_cancelamentos_pendentes` + `supabase db push`. Validar com `npm run db:check`. Antes de criar: `git fetch` e conferir que o timestamp gerado é mais novo que a última migration aplicada.
- Arquivos que **não podem aparecer no diff**:
  - `supabase/functions/backfill-faturamento/index.ts` e `passo.ts`
  - `supabase/functions/_shared/estoque/cancelamento.ts` e `cancelamento-deps.ts`
  - `supabase/functions/reconciliar-faturamento/kit.ts`
  - `supabase/functions/_shared/faturamento/pendencias.ts` e `io.ts`
- O código novo não lê nem escreve `worker_pendencias`, não chama `refazerBaixaAdiada`, `desfechoKit`, `lerPendenciasKit` nem `registrarPendenciaKit`.
- A regra de quando repor (ADR-0121 decisões 2 e 3) não muda. Nenhuma RPC de estoque é criada ou alterada.
- Nenhuma escrita no ML. Nenhum estorno do acervo por script.
- Testes rodam em foreground. `pnpm test -- <arquivo>` roda a suíte inteira; usar `pnpm vitest run <arquivo>`.
- Portão antes do push: `pnpm preflight`.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/<ts>_ml_cancelamentos_pendentes.sql` | criar | tabela, RLS, trigger, RPC |
| `supabase/tests/ml_cancelamentos_pendentes.sql` | criar | teste SQL do trigger, da RPC e das permissões |
| `supabase/functions/reconciliar-faturamento/cancelamentos.ts` | criar | lista fechada de desfecho, classificação do lote, leitura e gravação da fila |
| `supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts` | criar | testes do arquivo acima |
| `supabase/functions/reconciliar-faturamento/passo.ts` | alterar | etapa `cancelamentos`, 3 deps novas, `parcial` |
| `supabase/functions/reconciliar-faturamento/__tests__/passo.test.ts` | alterar | testes da etapa |
| `supabase/functions/reconciliar-faturamento/index.ts` | alterar | extrair `gravarETratar`, fiar as 3 deps |
| `supabase/functions/backfill-faturamento/__tests__/passo.test.ts` | alterar | só teste novo de caracterização (riscos 6 e 7) |
| `docs/decisions/0211-…md`, `0121-…md`, `README.md`, `docs/TASKS.md`, `docs/project-status.md` | alterar | status, ponteiro, índice, pendências |

## Teste por risco

| # | Risco | Teste que reproduz e prova |
|---|---|---|
| 1 | Transição perdida se o tratamento falha | SQL T2 (obrigação nasce no mesmo `update`) e T5 (falha desfaz os dois). Vitest P3: tratamento devolve `erro` → obrigação fica; rodada seguinte lê de novo com `pedidosDaJanela` vazio |
| 2 | `erro` classificado como ok | Vitest C1: tabela com **todos** os membros de `ResultadoCancelamento`, tipada com `satisfies Record<ResultadoCancelamento, boolean>` (desfecho novo quebra o build). `erro`, `pendente`, `repetir` → não concluído |
| 3 | Venda inédita cancelada na fila | SQL T1: `insert` já `cancelled` → 0 obrigações |
| 4 | `descartado_em` tira da fila | SQL T8: a tabela não tem a coluna. Vitest P4: 30 tentativas falhas → a obrigação continua sendo lida |
| 5 | Obrigação lida como baixa adiada | Vitest C3: pedido `paid` com obrigação → `ignorado`, concluído, sem baixa. Vitest C4 (estrutural): `cancelamentos.ts` não contém `refazerBaixaAdiada`, `worker_pendencias`, `pendencia_kit`, `desfechoKit`. SQL T2: `worker_pendencias` segue sem linha para o pedido. Vitest P5: a etapa não chama `processarPedidos` nem `registrarPendencias` |
| 6 | `throw` no lote tira retentativa de venda `paid` | Vitest B1 (backfill): lote com 1 `cancelled` gravado e 1 `paid` com falha → não lança, `registrarFalhas` recebe o `paid`, cursor avança |
| 7 | Falha fora da fila contada como enfileirada | Vitest B2 (backfill): `pedidosComFalha` é igual ao tamanho da lista passada a `registrarFalhas`. Verificação: `git diff origin/main --stat -- supabase/functions/backfill-faturamento/index.ts supabase/functions/backfill-faturamento/passo.ts` vazio |
| 8 | Corridas do aviso | Verificação: `git diff origin/main --stat -- supabase/functions/_shared/estoque/` vazio. Suíte `cancelamento.test.ts` verde sem alteração |

---

## Task 1 — Migration e teste SQL

**Files:** `supabase/tests/ml_cancelamentos_pendentes.sql` (criar), `supabase/migrations/<ts>_ml_cancelamentos_pendentes.sql` (criar)

- [ ] **1.1 RED: escrever o teste SQL.** Seguir o formato de `supabase/tests/cupom_vendedor.sql` (`begin; … rollback;`, asserções em `do $$ … raise exception`). Fixtures no padrão dos vizinhos que criam org e usuário (`adr195_confirmacoes_ml.sql`). Casos:

| Caso | Passos | Esperado |
|---|---|---|
| T1 | `insert` em `ml_vendas` com `status` e `raw.status` = `cancelled` | 0 linhas em `ml_cancelamentos_pendentes` |
| T2 | venda `paid`; `update` de `status` e `raw` para `cancelled` | 1 obrigação, `tentativas=0`, `tentada_em` nulo; 0 linhas em `worker_pendencias` para o pedido |
| T2b | venda `paid`; `insert … on conflict (user_id, order_id) do update set status = excluded.status, raw = excluded.raw` com `cancelled` (a forma do `upsertVenda`) | 1 obrigação |
| T3 | venda `paid`; `update` só de `status` para `cancelled` (como `marcarConversaCancelada`) | 0 obrigações. Depois `update` de `raw` para `cancelled` → 1 obrigação |
| T4 | venda com obrigação; novo `update` de `raw` ainda `cancelled` | `armada_em` não muda |
| T5 | em bloco `begin … exception`, `update` para `cancelled` seguido de `raise` | venda continua `paid` e 0 obrigações |
| T6a | RPC com `p_ok` contendo a obrigação e `p_inicio` posterior a `armada_em` | linha apagada |
| T6b | RPC com `p_ok` e `p_inicio` anterior a `armada_em` | linha fica |
| T6c | RPC com `p_pendentes = {"<order>":"erro"}` | `tentativas=1`, `tentada_em` preenchido, `ultimo_desfecho='erro'` |
| T6d | obrigação com `tentativas=3`; venda volta a `paid` e depois a `cancelled` | `tentativas=0`, `armada_em` renovado, `tentada_em` nulo |
| T7 | logo após a migration | `ml_cancelamentos_pendentes` vazia, com `ml_vendas` tendo cancelados |
| T8 | catálogo | sem coluna `descartado_em`/`obrigatoria`; RLS ligada; `anon` e `authenticated` sem `INSERT/UPDATE/DELETE`; `has_function_privilege` da RPC: `service_role` sim, `anon`/`authenticated` não; funções com `prosecdef` e `search_path=""`, dono `postgres` |

- [ ] **1.2 Prova de vermelho:** `python3 scripts/teste-sql-desfeito.py supabase/tests/ml_cancelamentos_pendentes.sql` (sem migration) tem de falhar.

- [ ] **1.3 GREEN: criar a migration** com `supabase migration new ml_cancelamentos_pendentes`. Conteúdo:

```sql
-- ADR-0211: obrigação de tratar cancelamento, armada pelo banco na mesma instrução que grava o cancelled.
create table public.ml_cancelamentos_pendentes (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  order_id        bigint not null,
  armada_em       timestamptz not null default clock_timestamp(),
  tentativas      integer not null default 0 check (tentativas >= 0),
  tentada_em      timestamptz,
  ultimo_desfecho text,
  primary key (org_id, order_id)
);
alter table public.ml_cancelamentos_pendentes enable row level security;
create policy "ml_cancelamentos_pendentes: select org" on public.ml_cancelamentos_pendentes
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.ml_cancelamentos_pendentes from anon, authenticated;
grant select on public.ml_cancelamentos_pendentes to authenticated;

create function public.ml_vendas_armar_cancelamento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ml_cancelamentos_pendentes as p (org_id, order_id)
  values (new.org_id, new.order_id)
  on conflict (org_id, order_id) do update
    set armada_em = clock_timestamp(), tentativas = 0, tentada_em = null, ultimo_desfecho = null;
  return null;
end;
$$;
revoke all on function public.ml_vendas_armar_cancelamento() from public, anon, authenticated;

-- `of raw`: marcarConversaCancelada grava só a coluna status e não arma. Só update: venda inédita não arma.
create trigger ml_vendas_armar_cancelamento
  after update of raw on public.ml_vendas
  for each row
  when (new.raw->>'status' = 'cancelled'
        and coalesce(old.raw->>'status', old.status) is distinct from 'cancelled')
  execute function public.ml_vendas_armar_cancelamento();

-- Desfecho de um lote. Só apaga obrigação armada antes do início da tentativa (rearme durante o lote fica).
create function public.registrar_cancelamentos_tratados(p_org uuid, p_ok bigint[], p_inicio timestamptz, p_pendentes jsonb)
returns void language sql security definer set search_path = '' as $$
  delete from public.ml_cancelamentos_pendentes
   where org_id = p_org and order_id = any(coalesce(p_ok, '{}')) and armada_em < p_inicio;
  update public.ml_cancelamentos_pendentes c
     set tentativas = c.tentativas + 1, tentada_em = clock_timestamp(), ultimo_desfecho = x.value
    from jsonb_each_text(coalesce(p_pendentes, '{}'::jsonb)) x
   where c.org_id = p_org and c.order_id = x.key::bigint;
$$;
revoke all on function public.registrar_cancelamentos_tratados(uuid, bigint[], timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_cancelamentos_tratados(uuid, bigint[], timestamptz, jsonb) to service_role;
```

- [ ] **1.4 Rodar verde:** `python3 scripts/teste-sql-desfeito.py supabase/tests/ml_cancelamentos_pendentes.sql supabase/migrations/<ts>_ml_cancelamentos_pendentes.sql` → `TESTE_OK`. Rodar longe do minuto :40 (`renovar-tokens-ml`).
- [ ] **1.5** `npm run db:check`. Commit: `feat(estoque): fila própria de cancelamento armada por trigger (ADR-0211)`.

## Task 2 — `cancelamentos.ts`: desfecho, classificação e IO da fila

**Files:** `supabase/functions/reconciliar-faturamento/cancelamentos.ts` (criar), `__tests__/cancelamentos.test.ts` (criar)

- [ ] **2.1 RED: testes.**

| Caso | O que prova |
|---|---|
| C1 | Tabela `{ reposto: true, avisado: true, 'sem-baixa': true, silenciado: true, ignorado: true, pendente: false, repetir: false, erro: false } satisfies Record<ResultadoCancelamento, boolean>`; `cancelamentoConcluido(k)` bate com cada valor (risco 2) |
| C2 | `classificarLote` com `tratarUm` que lança para um pedido → esse vai para `pendentes` com o texto do erro (cortado em 300 caracteres); os outros seguem |
| C3 | `tratarUm` devolve `ignorado` (pedido `paid`) → concluído; nada além de `tratarUm` é chamado (risco 5) |
| C4 | Estrutural: o texto de `cancelamentos.ts` não contém `refazerBaixaAdiada`, `worker_pendencias`, `pendencia_kit`, `desfechoKit` (risco 5) |
| C5 | `lerCancelamentosPendentes` monta: `eq('org_id')`, `lte('armada_em', agora − 5 min)`, `order('tentada_em', asc, nullsFirst)`, `order('order_id')`, `limit(20)`; erro de leitura lança |
| C6 | `registrarCancelamentos` chama a RPC com `p_ok` numérico, `p_inicio` e `p_pendentes`; erro lança |

- [ ] **2.2 Rodar e ver falhar:** `pnpm vitest run supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts`.

- [ ] **2.3 GREEN: implementar.**

```ts
// ADR-0211: fila própria da obrigação de cancelamento. Nada aqui lê ou escreve a fila comum nem a de kit.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ResultadoCancelamento } from '../_shared/estoque/cancelamento.ts';
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import { chunk } from '../_shared/faturamento/utils.ts';

export const LOTE_CANCELAMENTOS = 20;
export const CARENCIA_MS = 5 * 60_000;
const PARALELAS = 5;

// Lista fechada: desfecho novo ou desconhecido mantém a obrigação.
const CONCLUIDO: ReadonlySet<ResultadoCancelamento> = new Set(['reposto', 'avisado', 'sem-baixa', 'silenciado', 'ignorado']);
export const cancelamentoConcluido = (r: ResultadoCancelamento): boolean => CONCLUIDO.has(r);

export interface ResultadoCancelamentos { concluidos: string[]; pendentes: Record<string, string> }

export async function classificarLote(
  pedidos: PedidoML[], tratarUm: (p: PedidoML) => Promise<ResultadoCancelamento>,
): Promise<ResultadoCancelamentos> {
  const r: ResultadoCancelamentos = { concluidos: [], pendentes: {} };
  for (const lote of chunk(pedidos, PARALELAS)) {
    await Promise.all(lote.map(async (p) => {
      const id = String(p.id);
      try {
        const d = await tratarUm(p);
        if (cancelamentoConcluido(d)) r.concluidos.push(id); else r.pendentes[id] = d;
      } catch (e) {
        r.pendentes[id] = `falha: ${(e as Error)?.message ?? e}`.slice(0, 300);
      }
    }));
  }
  return r;
}

export async function lerCancelamentosPendentes(admin: SupabaseClient, orgId: string, agora: Date, limite: number): Promise<string[]> {
  const { data, error } = await admin.from('ml_cancelamentos_pendentes')
    .select('order_id').eq('org_id', orgId)
    .lte('armada_em', new Date(agora.getTime() - CARENCIA_MS).toISOString())
    .order('tentada_em', { ascending: true, nullsFirst: true }).order('order_id', { ascending: true })
    .limit(limite);
  if (error) throw new Error(`ler cancelamentos pendentes: ${error.message}`);
  return ((data ?? []) as Array<{ order_id: number | string }>).map((x) => String(x.order_id));
}

export async function registrarCancelamentos(
  admin: SupabaseClient, orgId: string, ok: string[], inicio: string, pendentes: Record<string, string>,
): Promise<void> {
  const { error } = await admin.rpc('registrar_cancelamentos_tratados', {
    p_org: orgId, p_ok: ok.map(Number), p_inicio: inicio, p_pendentes: pendentes,
  });
  if (error) throw new Error(`registrar cancelamentos: ${error.message}`);
}
```

- [ ] **2.4** Rodar verde. Commit: `feat(reconciliar): desfecho e IO da fila de cancelamento (ADR-0211)`.

## Task 3 — Etapa `cancelamentos` em `passo.ts`

**Files:** `supabase/functions/reconciliar-faturamento/passo.ts`, `__tests__/passo.test.ts`

- [ ] **3.1 RED: testes** (usar o fábrica de deps já existente no arquivo, com as 3 deps novas como `vi.fn`).

| Caso | O que prova |
|---|---|
| P1 | Fim da etapa `pendencias` (lista vazia e lote menor que 20) aponta para `cancelamentos|`, e `cancelamentos` aponta para `perguntas|`. Ajustar os testes existentes que esperavam `perguntas|` direto |
| P2 | `inicio` (`deps.agora()`) é capturado antes de `cancelamentosPendentes` e é o valor passado a `registrarCancelamentos` |
| P3 | Tratamento devolve `pendentes` → `registrarCancelamentos` recebe o id em `pendentes`, não em `ok`. Rodada seguinte, com `pedidosDaJanela` vazio, lê e processa o mesmo id (risco 1) |
| P4 | Mesmo id falhando em 30 rodadas seguidas continua sendo lido (risco 4) |
| P5 | Na etapa, `processarPedidos`, `registrarPendencias` e `pendencias` não são chamados (riscos 5 e 6) |
| P6 | Pedido que `pedidoPorId` não leu → vai para `pendentes` com `falha: leitura…`; os lidos seguem |
| P7 | Um lote só: com 25 obrigações, a etapa processa 20 e segue para `perguntas|` (sem cursor de posição) |
| P8 | Fila vazia → vai para `perguntas|` sem chamar `registrarCancelamentos` |
| P9 | `acumulado.cancelamentosPendentes > 0` → rodada termina `parcial` com o texto novo; 0 → não muda o `parcial` de hoje |

- [ ] **3.2 Rodar e ver falhar.**

- [ ] **3.3 GREEN.** Em `DepsReconciliar`:

```ts
  /** ADR-0211: obrigações de cancelamento da org prontas para tratar (fila própria, sem cursor). */
  cancelamentosPendentes(limite: number): Promise<string[]>;
  /** Grava a venda e chama tratarPedidoCancelado. Nunca lança por pedido. Não faz baixa adiada. */
  processarCancelamentos(token: string, cx: ConexaoCanal, userId: string, orgId: string, pedidos: PedidoML[]): Promise<ResultadoCancelamentos>;
  registrarCancelamentos(ok: string[], inicio: string, pendentes: Record<string, string>): Promise<void>;
```

Nos dois retornos da etapa `pendencias`, trocar `ir('perguntas')` por `ir('cancelamentos')`. Etapa nova, logo depois de `pendencias`:

```ts
    if (c.etapa === 'cancelamentos') {
      // Um lote por rodada, sem cursor: a fila ordena por última tentativa (ADR-0211).
      const inicio = deps.agora();
      const ids = await deps.cancelamentosPendentes(LOTE_CANCELAMENTOS);
      if (ids.length === 0) return { proximo: ir('perguntas'), acumulado };
      const lidos: PedidoML[] = [];
      const pendentes: Record<string, string> = {};
      for (const lote of chunk(ids, PARALELAS)) {
        const rs = await Promise.allSettled(lote.map((id) => deps.pedidoPorId(token, id)));
        rs.forEach((r, i) => {
          if (r.status === 'fulfilled') lidos.push(r.value);
          else pendentes[lote[i]] = `falha: leitura do pedido: ${(r.reason as Error)?.message ?? r.reason}`.slice(0, 300);
        });
      }
      const r = lidos.length ? await deps.processarCancelamentos(token, cx, userId, orgId, lidos) : { concluidos: [], pendentes: {} };
      Object.assign(pendentes, r.pendentes);
      await deps.registrarCancelamentos(r.concluidos, inicio, pendentes);
      let acc = somar(acumulado, 'cancelamentosTratados', r.concluidos.length);
      acc = somar(acc, 'cancelamentosPendentes', Object.keys(pendentes).length);
      return { proximo: ir('perguntas'), acumulado: acc };
    }
```

Em `fim`, acrescentar os cancelamentos ao `parcial` sem mudar o texto de hoje quando não houver nenhum:

```ts
  const canc = acumulado.cancelamentosPendentes ?? 0;
  const partes = [
    pendentes > 0 ? `${pendentes} pedido(s) pendente(s)`
      : descartados > 0 ? `${descartados} pedido(s) descartado(s) após 5 tentativas` : null,
    canc > 0 ? `${canc} cancelamento(s) aguardando tratamento` : null,
  ].filter(Boolean);
  return { proximo: null, acumulado, parcial: partes.length ? partes.join('; ') : null };
```

Atualizar o comentário do topo do arquivo com a ordem nova das etapas.

- [ ] **3.4** Rodar verde (arquivo de teste inteiro). Commit: `feat(reconciliar): etapa cancelamentos (ADR-0211)`.

## Task 4 — Fiação em `index.ts`

**Files:** `supabase/functions/reconciliar-faturamento/index.ts`

- [ ] **4.1 Extrair `gravarETratar`** de dentro de `processarPedidos` (hoje linhas ~507–534): frete, envio, MP por pedido, `upsertVenda` e `tratarPedidoCancelado`. Devolve `{ itens, mpLido, cancelamento }`. É movimento puro: `processarPedidos` passa a chamá-la e mantém, no próprio corpo, `lerPendenciasKit`, `refazerBaixaAdiada` e `desfechoKit` exatamente como estão. O carregamento de catálogo e GTIN (`catalogoDe`, `carregarGtinsDaVenda`) fica em quem chama e entra por parâmetro.
- [ ] **4.2 Fiar as 3 deps** em `depsReal`:

```ts
    cancelamentosPendentes: (limite) => lerCancelamentosPendentes(admin, orgId, new Date(), limite),
    registrarCancelamentos: (ok, inicio, pendentes) => registrarCancelamentos(admin, orgId, ok, inicio, pendentes),
    async processarCancelamentos(token, cx, userId, org, pedidos) {
      const ctx = /* catálogo + GTIN, igual a processarPedidos */;
      return await classificarLote(pedidos, async (pedido) => (await gravarETratar(ctx, token, cx, userId, org, pedido)).cancelamento);
    },
```

- [ ] **4.3 Verificar:** `pnpm vitest run supabase/functions/reconciliar-faturamento` verde; `deno check supabase/functions/reconciliar-faturamento/index.ts` (ou o typecheck do `pnpm preflight:static`) sem erro. No diff, `processarPedidos` não pode ter perdido nenhuma chamada.
- [ ] **4.4** Commit: `feat(reconciliar): fiação da fila de cancelamento (ADR-0211)`.

## Task 5 — Caracterização do backfill (riscos 6 e 7)

**Files:** `supabase/functions/backfill-faturamento/__tests__/passo.test.ts` (só teste novo)

- [ ] **5.1** B1: `processarPedidos` devolve `{ ok: ['<cancelado>'], falhas: ['<pago>'], mpFalhou: false }` → o passo não lança, `registrarFalhas` é chamado com `['<pago>']`, e `proximo` avança para o último id do lote.
- [ ] **5.2** B2: no fim da rodada, `acumulado.pedidosComFalha` é igual ao total de ids passados a `registrarFalhas`.
- [ ] **5.3** Os dois passam **sem alterar código de produção** (são trava de regressão, não RED→GREEN). Commit: `test(backfill): trava de regressão da fila comum (ADR-0211)`.

## Task 6 — Portão, revisão e documentação

- [ ] **6.1** `pnpm preflight` verde.
- [ ] **6.2** Conferir que estes comandos saem vazios:
  - `git diff origin/main --stat -- supabase/functions/backfill-faturamento/index.ts supabase/functions/backfill-faturamento/passo.ts`
  - `git diff origin/main --stat -- supabase/functions/_shared/estoque/ supabase/functions/_shared/faturamento/pendencias.ts supabase/functions/_shared/faturamento/io.ts supabase/functions/reconciliar-faturamento/kit.ts`
- [ ] **6.3** Revisão independente (ver Classificação). Entregar ao revisor a tabela "Teste por risco" e pedir veredito por linha. Achado bloqueante: corrigir e revisar de novo só o que mudou.
- [ ] **6.4** Docs: ADR-0211 → `Aceito` com os SHAs; emenda de uma linha no ADR-0121 apontando para o 0211; linha no `docs/decisions/README.md`; `docs/TASKS.md` (pendências de verificação e reparo do acervo); `docs/project-status.md`. Seguir a skill `docs-update-checklist`. O repositório é público: nenhum id de org, nome de comprador ou lista de pedidos nos docs.
- [ ] **6.5** Atualizar o Graphify (skill `graphify-update-maintenance`).

## Task 7 — Deploy (ordem obrigatória)

- [ ] **7.1 Guardar a linha de base** antes de qualquer coisa: rodar a consulta V0 (abaixo) e salvar o resultado fora do repositório.
- [ ] **7.2 Migration primeiro:** push da branch → CI verde → merge fast-forward na `main` → `supabase db push` → `npm run db:check`. O trigger começa a armar; ninguém trata ainda (seguro: a obrigação é durável).
- [ ] **7.3 Rodar V1 e V2.**
- [ ] **7.4 Função depois:** `supabase functions deploy reconciliar-faturamento`. Conferir a versão ativa. **Só esta função**: nenhum arquivo de `_shared/` mudou e o backfill não mudou.
- [ ] **7.5** Ordem inversa é proibida: a função sem a tabela faz a etapa lançar em toda rodada.
- [ ] **7.6** Deletar a branch, remover o worktree, `git pull --ff-only` no checkout principal.

## Verificação pós-deploy (somente `SELECT`)

**V0 — linha de base do acervo (antes do deploy).** Guardar a saída.

```sql
with baixa as (
  select m.org_id, split_part(m.referencia_externa, ':', 2) order_id
    from public.estoque_movimentos m
   where m.motivo = 'venda' and m.quantidade < 0 and m.referencia_externa like 'mercado_livre:%'
     and not exists (select 1 from public.estoque_movimentos e
                      where e.org_id = m.org_id and e.referencia_externa = 'estorno:' || m.referencia_externa)
   group by 1, 2)
select b.org_id, b.order_id, n.chave is not null avisado
  from baixa b
  join public.ml_vendas v on v.org_id = b.org_id and v.order_id::text = b.order_id and v.status = 'cancelled'
  left join public.ml_notificacoes_enviadas n
         on n.org_id = b.org_id and n.entidade = 'estoque_cancelado_despachado' and n.chave = b.order_id;
```

Medido em 24/11/2026: 389 pedidos, 78 com `avisado = false`.

**V1 — objetos e permissões (logo após a migration).**

```sql
select tgname, pg_get_triggerdef(oid) from pg_trigger
 where tgrelid = 'public.ml_vendas'::regclass and not tgisinternal;
select proname, pg_get_userbyid(proowner) dono, prosecdef, proconfig::text, proacl::text from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('ml_vendas_armar_cancelamento', 'registrar_cancelamentos_tratados');
select grantee, string_agg(privilege_type, ',') from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'ml_cancelamentos_pendentes' group by 1;
```

Esperado: 2 triggers em `ml_vendas`; dono `postgres`, `prosecdef = true`, `search_path=""`; `anon` ausente, `authenticated` só `SELECT`.

**V2 — sem rajada (logo após a migration).**

```sql
select count(*) from public.ml_cancelamentos_pendentes;
```

Esperado: 0, ou só os cancelamentos que aconteceram nos minutos desde o `db push`.

**V3 — a fila anda (1h e 2h depois do deploy da função; repetir depois do backfill diário das 06:30 UTC).**

```sql
select org_id, order_id, armada_em, tentativas, tentada_em, ultimo_desfecho
  from public.ml_cancelamentos_pendentes order by armada_em;
select org_id, ciclo, estado, cursor, erro, acumulado->>'cancelamentosTratados' tratados,
       acumulado->>'cancelamentosPendentes' pendentes
  from public.worker_rodadas where job = 'reconciliar';
```

Esperado: nenhuma linha com `armada_em` há mais de 2h e `tentativas = 0`; nenhuma rodada com `erro` citando `cancelamentos`; `tratados` aparecendo no acumulado.

**V4 — o problema parou.** Rodar V0 de novo e comparar com a linha de base.

- Pedido novo com `avisado = false` só é aceitável se ainda estiver em `ml_cancelamentos_pendentes`.
- Para cada pedido novo, conferir o tratamento:

```sql
select referencia_externa, motivo, quantidade, criado_em from public.estoque_movimentos
 where org_id = '<org>' and referencia_externa like '%:<order_id>:%' order by criado_em;
select entidade, chave, enviado_em from public.ml_notificacoes_enviadas
 where org_id = '<org>' and chave = '<order_id>';
```

**V5 — obrigação parada (semanal, até entrar na rotina).**

```sql
select org_id, order_id, armada_em, tentativas, ultimo_desfecho
  from public.ml_cancelamentos_pendentes where tentativas >= 3 order by tentativas desc;
```

Esperado: vazio. Linha aqui pede investigação do `ultimo_desfecho` e do log `estorno_estoque_falhou`.

**V6 — a fila comum não foi tocada.**

```sql
select obrigatoria, descartado_em is not null descartada, count(*) from public.worker_pendencias group by 1, 2;
```

Esperado: nenhuma linha com `ultimo_erro` citando cancelamento de backfill. Em 24/11/2026 a tabela estava vazia.

## Reparo do acervo (separado do deploy, sem código)

Os 389 pedidos (V0) já estão `cancelled` e **não** entram na fila nova. O reparo é do operador de cada org, com conferência física.

Regras:

- Nenhum estorno em lote. Nenhum script escreve em `estoque_movimentos`. Nenhuma chamada a `estornar_estoque` pelo agente.
- Toda correção é entrada manual pela tela de Estoque, feita pelo operador, um SKU por vez.
- O agente só lê: monta a planilha e entrega.
- A planilha fica fora do repositório (repo público).

Passos:

- [ ] **R1** Rodar V0 e enriquecer cada linha (uma consulta por org) com: SKU e quantidade da baixa (`estoque_movimentos.codigo`, `quantidade`), `ml_vendas.shipping_status`, data da venda, claim mais recente (`ml_devolucoes`), e o primeiro movimento manual do SKU **depois** da baixa (`motivo` de entrada, ajuste ou inventário, com `criado_em`).
- [ ] **R2** Classificar cada linha em um grupo:

| Grupo | Critério | Ação sugerida ao operador |
|---|---|---|
| A | Houve entrada, ajuste ou inventário do SKU depois da baixa | Nada. A contagem posterior já absorveu a unidade. Estornar criaria estoque fantasma |
| B | Sem movimento manual posterior e envio `delivered`, `shipped` ou `not_delivered` | Dar entrada manual só quando o produto voltar |
| C | Sem movimento manual posterior e envio `cancelled`, `pending`, `handling`, `ready_to_ship` ou nulo | Conferir a prateleira. Se a unidade está lá, entrada manual |

- [ ] **R3** Entregar ao Diego uma planilha por org, ordenada por SKU, com o grupo e a ação. Os 78 sem aviso vêm destacados: o operador nunca soube deles.
- [ ] **R4** O Diego decide como cada org recebe a lista. O sistema não dispara aviso em massa (lição do ADR-0121: 26 alertas históricos de uma vez).
- [ ] **R5** Depois de cada org terminar, rodar V0 só dela. Os pedidos dos grupos A e B continuam na consulta (não têm estorno por desenho); o fechamento é a planilha conferida, não a consulta zerada.
- [ ] **R6** Caso já decidido: pedido `2000019609391838` não é estornado (a contagem de 18/11 zerou o SKU depois da baixa).

Proposta em aberto, fora deste plano: usar o histórico do envio (`GET /shipments/{id}/history` sem data de impressão nem de despacho) como prova de pré-despacho para envio `cancelled`. Muda a decisão 3 do ADR-0121 e pede ADR próprio.

## Fora de escopo

- Qualquer mudança no aviso de `cancelamento.ts` (decisão do Diego; limite registrado no ADR-0211).
- Drenar a fila no caminho legado do reconciliar (sem `FANOUT_RECONCILIAR`).
- Alerta automático de obrigação parada.
- `marcarConversaCancelada` gravando `ml_vendas.status='cancelled'` antes do ML cancelar (achado anterior; o trigger é imune porque olha `raw`).
- Tela para a fila nova.

## Medição (preencher ao fim)

classificação · modelos (principal e subagentes) · revisões · escalonamento
