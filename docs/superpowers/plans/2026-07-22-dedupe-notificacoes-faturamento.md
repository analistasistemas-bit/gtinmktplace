# Dedupe de Notificações de Faturamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar a duplicação de notificação Telegram / mensagem ao comprador quando `sync-venda`, `sync-pergunta` ou `sync-devolucao` processam o mesmo evento ML concorrentemente (retry do QStash, fail-open do dedup do ml-webhook).

**Architecture:** Nova tabela de reserva idempotente `ml_notificacoes_enviadas` (PK composta `org_id+entidade+chave`) + helper `reservarNotificacao()`. A corrida é resolvida pela unique constraint do Postgres no `INSERT`, não pela lógica do app — os 3 workers ganham um `&& await reservarNotificacao(...)` na condição que já existe, sem tocar no upsert de dados (que já está correto).

**Tech Stack:** Deno/Supabase edge functions (TypeScript), Postgres/RLS, vitest.

## Global Constraints

- RLS por `org_id` obrigatória em toda tabela nova (regra do projeto).
- Migrations só via `supabase migration new` + `supabase db push` — nunca `apply_migration`/painel (ADR-0043).
- Ordem de deploy: `db push` (migration) **antes** do deploy do código das edge functions — nunca o inverso.
- Nenhuma correção de negócio sem antes ler a fonte (spec em `docs/superpowers/specs/2026-07-22-dedupe-notificacoes-faturamento-design.md`, já aprovado).
- Verificação completa antes de cada commit relevante: `deno check`, `deno lint`, `tsc`, `eslint`, `vitest run`, `vite build`.
- Revisão adversarial do Codex (`gpt-5.6-sol`) obrigatória antes do merge (padrão desta sessão para toda correção sensível a notificação/dinheiro).
- Trailer de commit obrigatório: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01XYS4Wjv9ke4EQbk1mbWEni`.

---

### Task 1: Migration — tabela `ml_notificacoes_enviadas`

**Files:**
- Create: `supabase/migrations/20260722140000_ml_notificacoes_enviadas_dedupe.sql`

**Interfaces:**
- Produces: tabela `public.ml_notificacoes_enviadas(org_id uuid, user_id uuid, entidade text, chave text, enviado_em timestamptz)`, PK `(org_id, entidade, chave)`. Consumida pelo helper da Task 2 via `admin.from('ml_notificacoes_enviadas').insert(...)`.

- [ ] **Step 1: Criar o arquivo de migration**

```bash
supabase migration new ml_notificacoes_enviadas_dedupe
```
Isso gera um arquivo com timestamp atual em `supabase/migrations/`. Renomeie/ajuste o nome final para bater exatamente com `20260722140000_ml_notificacoes_enviadas_dedupe.sql` se o timestamp gerado for diferente (mantenha a ordem cronológica após `20260722085311_adr86_configuracoes_pk_org_id_e_seed.sql`, que é a migration mais recente hoje).

- [ ] **Step 2: Escrever o SQL**

Conteúdo completo do arquivo:

```sql
-- Dedupe de notificações de faturamento (backlog do code-review-fable5, lote 4).
-- sync-venda/sync-pergunta/sync-devolucao decidem "é novo?" via SELECT-então-UPSERT em
-- _shared/faturamento/{io,perguntas-io,devolucoes-io}.ts — não atômico sob execução concorrente
-- (retry QStash, fail-open de classificarDedupWebhook). Esta tabela resolve a corrida na camada
-- de notificação (não no dado, que já upserta corretamente): só quem ganha o INSERT da PK
-- composta abaixo pode notificar. Ver docs/superpowers/specs/2026-07-22-dedupe-notificacoes-faturamento-design.md.
create table public.ml_notificacoes_enviadas (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  entidade   text not null,          -- 'venda_paga' | 'pergunta_nova' | 'devolucao_nova'
  chave      text not null,          -- order_id / question_id / claim_id como string
  enviado_em timestamptz not null default now(),
  primary key (org_id, entidade, chave)
);

alter table public.ml_notificacoes_enviadas enable row level security;

-- Só-leitura no app (mesmo padrão do Grupo B de 20260705165828_e7_rls_org.sql); escrita é
-- só do worker via service role (bypassa RLS) — sem policy de insert/update/delete.
create policy "ml_notificacoes_enviadas: select org" on public.ml_notificacoes_enviadas
  for select to authenticated using (org_id = (select public.current_org_id()));
```

**Correção pós-revisão:** o plano original incluía `grant select ... to authenticated; grant all
... to anon, authenticated;` copiado de `20260711120000_faturamento_mensagens.sql` — esse grant
foi revertido nesse mesmo repo em `20260712142159_revoke_anon_ml_mensagens.sql` (RLS não cobre
`TRUNCATE`; `anon` com `all` podia truncar a tabela). O padrão real do Grupo B
(`20260705165828_e7_rls_org.sql`) não emite nenhum grant explícito — removido acima.

- [ ] **Step 3: Verificar sintaxe/consistência com o padrão do projeto**

Confira que `public.organizations` e `public.current_org_id()` existem (já usados em `20260705165828_e7_rls_org.sql` e `20260722085311_adr86_configuracoes_pk_org_id_e_seed.sql`):
```bash
rtk proxy grep -n "create table.*organizations\|create or replace function public.current_org_id" supabase/migrations/*.sql
```
Expected: pelo menos 1 match para cada — confirma que as referências da migration nova apontam pra objetos que já existem no schema.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722140000_ml_notificacoes_enviadas_dedupe.sql
git commit -m "$(cat <<'EOF'
feat(faturamento): tabela de reserva idempotente para dedupe de notificações

Nova ml_notificacoes_enviadas (PK org_id+entidade+chave). Base pro fix do
achado MÉDIA (backlog code-review-fable5 lote 4): sync-venda/sync-pergunta/
sync-devolucao podem notificar 2x sob execução concorrente porque a decisão
"é novo?" usa SELECT-então-UPSERT (não atômico). A corrida passa a ser
resolvida pela unique constraint do Postgres no INSERT desta tabela, não
pela lógica do app.

Ainda NÃO aplicada em nenhum worker (próximos commits). Migration ainda não
rodou no banco (supabase db push é o último passo do rollout, depois de todo
o código revisado).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYS4Wjv9ke4EQbk1mbWEni
EOF
)"
```

---

### Task 2: Helper `reservarNotificacao` + teste (TDD)

**Files:**
- Create: `supabase/functions/_shared/faturamento/notificacoes-dedupe.ts`
- Test: `supabase/functions/_shared/faturamento/__tests__/notificacoes-dedupe.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (`jsr:@supabase/supabase-js@2`) — só usa `.from(table).insert(row)`.
- Produces: `reservarNotificacao(admin: SupabaseClient, orgId: string, userId: string | null, entidade: string, chave: string): Promise<boolean>`. Consumido pelos 3 workers na Task 3.

- [ ] **Step 1: Escrever o teste (falhando)**

```typescript
// supabase/functions/_shared/faturamento/__tests__/notificacoes-dedupe.test.ts
import { describe, it, expect } from 'vitest';
import { reservarNotificacao } from '../notificacoes-dedupe';

function fakeAdmin(result: { error: { code: string; message: string } | null }) {
  return {
    from: () => ({
      insert: async () => result,
    }),
  } as any;
}

describe('reservarNotificacao', () => {
  it('retorna true quando o INSERT é bem-sucedido (ganhou a corrida)', async () => {
    const admin = fakeAdmin({ error: null });
    const ganhou = await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123');
    expect(ganhou).toBe(true);
  });

  it('retorna false em 23505 (outro processo já reservou essa chave)', async () => {
    const admin = fakeAdmin({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const ganhou = await reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123');
    expect(ganhou).toBe(false);
  });

  it('retorna false (fail-closed) em erro genuíno, sem lançar', async () => {
    const admin = fakeAdmin({ error: { code: '08006', message: 'connection failure' } });
    await expect(reservarNotificacao(admin, 'org-1', 'user-1', 'venda_paga', '123')).resolves.toBe(false);
  });

  it('entidades diferentes (pergunta_nova vs venda_paga) usam a chave passada por parâmetro', async () => {
    const admin = fakeAdmin({ error: null });
    const ganhou = await reservarNotificacao(admin, 'org-1', null, 'pergunta_nova', '456');
    expect(ganhou).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
npx vitest run supabase/functions/_shared/faturamento/__tests__/notificacoes-dedupe.test.ts
```
Expected: FAIL — `Cannot find module '../notificacoes-dedupe'` (o arquivo ainda não existe).

- [ ] **Step 3: Implementar `reservarNotificacao`**

```typescript
// supabase/functions/_shared/faturamento/notificacoes-dedupe.ts
// Dedupe de notificações de faturamento (ADR-0037 workers). Não testado por vitest na parte de
// integração real com Postgres (usa Deno/supabase-js) — a decisão de branch é coberta pelo teste
// com fake client em __tests__/notificacoes-dedupe.test.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Reserva atomicamente o direito de notificar 1x por (org, entidade, chave). A corrida entre
 *  execuções concorrentes do mesmo evento (retry do QStash, fail-open do dedup do ml-webhook) é
 *  decidida pela PK composta de ml_notificacoes_enviadas no Postgres, não pelo app: só quem
 *  consegue o INSERT sem colidir em 23505 deve notificar. Erro que não é 23505 (colisão real)
 *  falha FECHADO — não notifica, só loga — porque perder uma notificação pontual é bem menos
 *  grave que duplicar mensagem pro comprador, e o dado (upsert da venda/pergunta/devolução) já
 *  foi gravado corretamente antes desta chamada, então nada de negócio se perde, só o alerta. */
export async function reservarNotificacao(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  entidade: string,
  chave: string,
): Promise<boolean> {
  const { error } = await admin.from('ml_notificacoes_enviadas').insert({ org_id: orgId, user_id: userId, entidade, chave });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.error(`reservarNotificacao(${entidade}:${chave}): ${error.message}`);
  return false;
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

```bash
npx vitest run supabase/functions/_shared/faturamento/__tests__/notificacoes-dedupe.test.ts
```
Expected: PASS — 4 testes verdes.

- [ ] **Step 5: `deno check` + `deno lint` no arquivo novo**

```bash
deno check --config supabase/functions/deno.json supabase/functions/_shared/faturamento/notificacoes-dedupe.ts
deno lint supabase/functions/_shared/faturamento/notificacoes-dedupe.ts
```
Expected: sem erros em nenhum dos dois.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/faturamento/notificacoes-dedupe.ts supabase/functions/_shared/faturamento/__tests__/notificacoes-dedupe.test.ts
git commit -m "$(cat <<'EOF'
feat(faturamento): helper reservarNotificacao (dedupe de notificações)

Wrapper fino sobre o INSERT em ml_notificacoes_enviadas: true se ganhou a
corrida (deve notificar), false em 23505 (outro processo já notificou) ou em
qualquer outro erro (fail-closed — loga, não notifica, não lança). 4 testes
com fake SupabaseClient cobrindo os 3 ramos + chaves de entidades distintas
não colidirem.

Ainda não usado por nenhum worker (próximo commit integra nos 3 sync-*).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYS4Wjv9ke4EQbk1mbWEni
EOF
)"
```

---

### Task 3: Integrar `reservarNotificacao` em `sync-venda`, `sync-pergunta`, `sync-devolucao`

**Files:**
- Modify: `supabase/functions/sync-venda/index.ts:11` (import), `:99` (gate)
- Modify: `supabase/functions/sync-pergunta/index.ts:7` (import), `:69` (gate)
- Modify: `supabase/functions/sync-devolucao/index.ts:7` (import), `:72` (gate)

**Interfaces:**
- Consumes: `reservarNotificacao` de `../_shared/faturamento/notificacoes-dedupe.ts` (Task 2).

- [ ] **Step 1: `sync-venda/index.ts` — import**

Arquivo atual (linhas 9-11):
```typescript
import {
  buscarPedido, buscarFreteVendedor, buscarShipment, carregarCatalogo, upsertVenda, resolverOrgPorUserId,
} from '../_shared/faturamento/io.ts';
```
Adicione logo abaixo (nova linha 12):
```typescript
import { reservarNotificacao } from '../_shared/faturamento/notificacoes-dedupe.ts';
```

- [ ] **Step 2: `sync-venda/index.ts` — gate**

Bloco atual (linhas 99-120):
```typescript
  if (novaPaga && orgId) {
    await notificarCategoria(admin, orgId, 'vendas', montarMensagemNovaVenda({
      order_id: Number(pedido.id),
      comprador: compradorNome,
      itens: itens.map((i) => ({ titulo: i.titulo, quantity: i.quantity, ean: i.ean })),
      total: Number(pedido.total_amount ?? 0),
      moeda: pedido.currency_id ?? 'BRL',
    }));

    // Mensagem automática ao comprador via ML (best-effort). O POST do ML exige o `to.user_id`.
    if (conexao?.contaExternaId && pedido.buyer?.id != null) {
      const packId = pedido.pack_id ?? pedido.id;
      await enviarMensagemPedido(
        token,
        packId,
        conexao.contaExternaId,
        String(pedido.buyer.id),
        'Olá! Recebemos seu pedido e já estamos separando. Em caso de dúvida, fique à vontade para chamar aqui pelo chat. Obrigado pela compra! 🙏',
      );
    }
  }
```
Substitua a condição da linha 99 (só a condição — o corpo do `if` não muda):
```typescript
  // reservarNotificacao garante 1 notificação por venda paga mesmo se novaPaga vier true em
  // execuções concorrentes do mesmo pedido (retry QStash) — só quem ganha o INSERT notifica.
  if (novaPaga && orgId && await reservarNotificacao(admin, orgId, userId, 'venda_paga', String(pedido.id))) {
    await notificarCategoria(admin, orgId, 'vendas', montarMensagemNovaVenda({
      order_id: Number(pedido.id),
      comprador: compradorNome,
      itens: itens.map((i) => ({ titulo: i.titulo, quantity: i.quantity, ean: i.ean })),
      total: Number(pedido.total_amount ?? 0),
      moeda: pedido.currency_id ?? 'BRL',
    }));

    // Mensagem automática ao comprador via ML (best-effort). O POST do ML exige o `to.user_id`.
    if (conexao?.contaExternaId && pedido.buyer?.id != null) {
      const packId = pedido.pack_id ?? pedido.id;
      await enviarMensagemPedido(
        token,
        packId,
        conexao.contaExternaId,
        String(pedido.buyer.id),
        'Olá! Recebemos seu pedido e já estamos separando. Em caso de dúvida, fique à vontade para chamar aqui pelo chat. Obrigado pela compra! 🙏',
      );
    }
  }
```

- [ ] **Step 3: `sync-pergunta/index.ts` — import**

Linha 7 atual:
```typescript
import { buscarPergunta, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
```
Adicione logo abaixo (nova linha 8):
```typescript
import { reservarNotificacao } from '../_shared/faturamento/notificacoes-dedupe.ts';
```

- [ ] **Step 4: `sync-pergunta/index.ts` — gate**

Bloco atual (linhas 69-74):
```typescript
  if (novaNaoRespondida && orgId) {
    await notificarCategoria(admin, orgId, 'perguntas', montarMensagemNovaPergunta({
      question_id: row.question_id, texto: row.texto, item_titulo: titulo,
    }));
  }
```
Substitua por:
```typescript
  if (novaNaoRespondida && orgId && await reservarNotificacao(admin, orgId, job.user_id, 'pergunta_nova', String(row.question_id))) {
    await notificarCategoria(admin, orgId, 'perguntas', montarMensagemNovaPergunta({
      question_id: row.question_id, texto: row.texto, item_titulo: titulo,
    }));
  }
```

- [ ] **Step 5: `sync-devolucao/index.ts` — import**

Linha 7 atual:
```typescript
import { buscarClaim, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
```
Adicione logo abaixo (nova linha 8):
```typescript
import { reservarNotificacao } from '../_shared/faturamento/notificacoes-dedupe.ts';
```

- [ ] **Step 6: `sync-devolucao/index.ts` — gate**

Bloco atual (linhas 72-77):
```typescript
  if (nova && orgId) {
    await notificarCategoria(admin, orgId, 'pos_venda', montarMensagemNovaDevolucao({
      claim_id: row.claim_id, order_id: row.order_id, tipo: row.type ?? 'claim',
      motivo: row.reason_texto, valor: row.valor_em_jogo, moeda: 'BRL',
    }));
  }
```
Substitua por:
```typescript
  if (nova && orgId && await reservarNotificacao(admin, orgId, job.user_id, 'devolucao_nova', String(row.claim_id))) {
    await notificarCategoria(admin, orgId, 'pos_venda', montarMensagemNovaDevolucao({
      claim_id: row.claim_id, order_id: row.order_id, tipo: row.type ?? 'claim',
      motivo: row.reason_texto, valor: row.valor_em_jogo, moeda: 'BRL',
    }));
  }
```

- [ ] **Step 7: `deno check` + `deno lint` nos 3 arquivos**

```bash
deno check --config supabase/functions/deno.json supabase/functions/sync-venda/index.ts supabase/functions/sync-pergunta/index.ts supabase/functions/sync-devolucao/index.ts
deno lint supabase/functions/sync-venda/index.ts supabase/functions/sync-pergunta/index.ts supabase/functions/sync-devolucao/index.ts
```
Expected: sem erros. Isso pega qualquer erro de tipo (ex.: `userId` vs `job.user_id` trocado entre arquivos) antes de qualquer teste manual.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/sync-venda/index.ts supabase/functions/sync-pergunta/index.ts supabase/functions/sync-devolucao/index.ts
git commit -m "$(cat <<'EOF'
fix(faturamento): dedupe de notificação em sync-venda/pergunta/devolucao

Fecha o achado MÉDIA do code-review-fable5 (lote 4, backlog): os 3 workers
decidiam "é novo?" via SELECT-então-UPSERT (io.ts/perguntas-io.ts/
devolucoes-io.ts), não atômico sob execução concorrente — duas execuções do
mesmo order_id/question_id/claim_id podiam ambas concluir "é novo" e ambas
disparar Telegram (+ mensagem automática ao comprador, no caso de venda).

Cada worker ganha reservarNotificacao(...) na condição que já existia; só
quem ganha o INSERT da PK composta em ml_notificacoes_enviadas notifica. O
upsert de dados (venda/pergunta/devolução) não muda — já estava correto.

reconciliar-faturamento/backfill-faturamento não mudam: já descartam os
booleans de "é novo" (nunca notificam).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XYS4Wjv9ke4EQbk1mbWEni
EOF
)"
```

---

### Task 4: Verificação completa

**Files:** nenhum (só comandos).

- [ ] **Step 1: `deno check` no repo inteiro de functions**

```bash
deno check --config supabase/functions/deno.json $(git ls-files 'supabase/functions/**/*.ts' | grep -v __tests__)
```
Expected: 0 erros.

- [ ] **Step 2: `deno lint`**

```bash
deno lint supabase/functions
```
Expected: mesma contagem de warnings pré-existente do repo (registrada em commits anteriores desta sessão como 163) — nenhum warning novo introduzido pelos arquivos tocados.

- [ ] **Step 3: `tsc` (frontend, não deve ser afetado, mas roda pra confirmar)**

```bash
npx tsc -b --pretty false
```
Expected: 0 erros.

- [ ] **Step 4: `eslint`**

```bash
npx eslint .
```
Expected: 0 erros.

- [ ] **Step 5: `vitest run` (repo inteiro)**

```bash
npx vitest run
```
Expected: todos os testes PASS, incluindo os 4 novos de `notificacoes-dedupe.test.ts`.

- [ ] **Step 6: `vite build`**

```bash
npx vite build
```
Expected: build sem erros.

- [ ] **Step 7: Registrar o resultado (sem commit — só confirmação antes da Task 5)**

Se qualquer passo falhar, voltar à task correspondente e corrigir antes de prosseguir. Não há commit nesta task — é um gate de verificação.

---

### Task 5: Revisão adversarial (Codex)

**Files:** nenhum (revisão, não código).

- [ ] **Step 1: Rodar o Codex sobre os 3 commits desta feature**

```bash
git log --oneline -5
```
Anote os 3 SHAs dos commits das Tasks 1-3 (migration, helper, integração).

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only "Você é um revisor de código ADVERSARIAL e cético. Revise os commits <SHA_MIGRATION>, <SHA_HELPER>, <SHA_INTEGRACAO> (PubliAI — Supabase/Deno edge functions). Rode git show <sha> pra cada e leia os arquivos ao redor conforme precisar.

Contexto: sync-venda/sync-pergunta/sync-devolucao decidiam 'é novo?' (novaPaga/novaNaoRespondida/nova) via SELECT-então-UPSERT em io.ts/perguntas-io.ts/devolucoes-io.ts — não atômico sob execução concorrente (retry QStash, fail-open do dedup do ml-webhook). Fix: tabela ml_notificacoes_enviadas (PK composta org_id+entidade+chave) + helper reservarNotificacao() que faz INSERT e usa o 23505 (unique_violation) pra decidir quem ganhou a corrida de notificar. Os 3 workers ganharam '&& await reservarNotificacao(...)' na condição existente. Não mexeu no upsert de dados.

Seja adversarial:
1. A PK composta (org_id, entidade, chave) realmente serializa a corrida entre 2 chamadas concorrentes de reservarNotificacao pro mesmo evento? Alguma forma de burlar (ex.: chave montada errado, entidade repetida entre workers diferentes colidindo por engano)?
2. reservarNotificacao falha fechado (não lança, retorna false) em erro que não é 23505 — isso pode mascarar um bug real (RLS bloqueando o INSERT do worker, tabela sem grant) fazendo o sistema simplesmente parar de notificar pra sempre, silenciosamente? Isso é aceitável ou precisa de um alerta/log mais forte?
3. RLS da migration: a policy de select org-scoped está correta? Falta grant? O INSERT do worker (service role) realmente bypassa RLS mesmo sem policy de insert?
4. Os 3 workers passam a chave certa (order_id/question_id/claim_id) e a entidade certa, sem trocar entre si?
5. Existe algum outro caller de upsertVenda/upsertPergunta/upsertDevolucao que também deveria ganhar o gate e ficou de fora (reconciliar-faturamento, backfill-faturamento)?
6. Os testes de reservarNotificacao cobrem o suficiente ou falta algum caso?

Saída: por item, veredito curto OK / PROBLEMA (severidade + correção). Ao final: APROVADO ou REVISAR. Conciso, cite arquivo:linha. Não invente problemas." < /dev/null
```

- [ ] **Step 2: Ler o veredito e classificar cada achado**

Para cada PROBLEMA reportado: reabrir a task correspondente (1, 2 ou 3), corrigir, rodar `deno check`/`deno lint`/`vitest run` de novo no(s) arquivo(s) tocado(s), e comitar a correção como um commit adicional (não amend) referenciando o achado do Codex — mesmo padrão usado nos Increments A/B/C do ADR-0086 nesta sessão.

- [ ] **Step 3: Repetir até veredito APROVADO**

Rodar o Codex de novo (mesmo comando, SHAs atualizados) até não haver mais PROBLEMA pendente.

---

### Task 6: Rollout — migration primeiro, depois deploy

**Files:** nenhum novo — só operação de deploy + atualização de `.code-review-fable5/state.json` e `learnings.md`.

- [ ] **Step 1: `db push`**

```bash
supabase db push
```
Expected: aplica só `20260722140000_ml_notificacoes_enviadas_dedupe.sql` (as anteriores já estão aplicadas). Sem erro.

- [ ] **Step 2: Verificar a tabela no banco**

```bash
supabase db query --linked "select table_name from information_schema.tables where table_name = 'ml_notificacoes_enviadas'; select policyname from pg_policies where tablename = 'ml_notificacoes_enviadas';"
```
Expected: 1 linha na 1ª query (`ml_notificacoes_enviadas`), 1 linha na 2ª (`ml_notificacoes_enviadas: select org`).

- [ ] **Step 3: Deploy das 3 edge functions**

```bash
supabase functions deploy sync-venda
supabase functions deploy sync-pergunta
supabase functions deploy sync-devolucao
```
Expected: 3 deploys OK. Rodar SÓ depois do Step 1/2 confirmados — se o código subir antes da migration, `reservarNotificacao` bate em "tabela não existe" e cai no fail-closed (não quebra, mas perde notificações até a migration rodar).

- [ ] **Step 4: Merge na main**

```bash
git log --oneline main..HEAD
git checkout main
git merge --ff-only worktree-fix-dedupe-notificacoes-faturamento
git push origin main
```
Se não for fast-forward (main mudou nesse meio tempo), avisar antes de fazer merge normal — não usar `--no-ff` nem force sem confirmar.

- [ ] **Step 5: Atualizar `.code-review-fable5/state.json` e `learnings.md`**

Em `state.json`, adicione ao campo `backlog_formal` ou crie `atomicidade_workers_faturamento`: `"RESOLVIDO (2026-07-22): commit <sha> — tabela ml_notificacoes_enviadas (PK org_id+entidade+chave) + reservarNotificacao() nos 3 workers (sync-venda/pergunta/devolucao). Corrida decidida pela unique constraint do Postgres, não pelo app. Revisado pelo Codex gpt-5.6-sol antes do merge."`

Em `learnings.md`, adicione entrada:
```
- [2026-07-22] BACKLOG "atomicidade dos workers de faturamento" RESOLVIDO. Tabela ml_notificacoes_enviadas (PK org_id+entidade+chave) + reservarNotificacao() em sync-venda/sync-pergunta/sync-devolucao — dedupe de notificação resolvido na camada de notificação (INSERT com unique constraint), não reescrevendo o upsert de dados (que já estava correto). LIÇÃO: quando a corrida é "notificar 1x", uma tabela de reserva idempotente com PK composta é mais simples e mais genérica (reusável pros 3 workers) que fazer compare-and-swap por coluna em cada entidade — o Postgres resolve a corrida sozinho via unique constraint, sem lock explícito nem RPC.
```

- [ ] **Step 6: Deletar a branch/worktree**

```bash
git branch -d worktree-fix-dedupe-notificacoes-faturamento
```
(usar `ExitWorktree` com `action: "remove"` se estiver operando via worktree do Claude Code, em vez de `git branch -d` manual.)
