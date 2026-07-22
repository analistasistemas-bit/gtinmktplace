# Dedupe de notificações de faturamento (vendas/perguntas/devoluções)

## Contexto

Achado do `code-review-fable5` (lote 4, backlog MÉDIA pré-existente, registrado em
`.code-review-fable5/learnings.md` e `state.json`): os workers `sync-venda`, `sync-pergunta` e
`sync-devolucao` (ADR-0037) usam o padrão SELECT-então-UPSERT em
`_shared/faturamento/{io,perguntas-io,devolucoes-io}.ts` para decidir "isso é novo?" (`novaPaga`,
`novaNaoRespondida`, `nova`). Essa leitura e a escrita subsequente não são atômicas: duas execuções
concorrentes do mesmo `order_id`/`question_id`/`claim_id` — retry do QStash (at-least-once), ou o
fail-open de `classificarDedupWebhook` (ml-webhook enfileira de novo em erro que não é `23505`) —
podem ambas ler o mesmo estado antigo, ambas concluir "é novo" e ambas disparar a notificação
Telegram (e, no caso de venda, a mensagem automática ao comprador via ML). `messages`
(`mensagens-io.ts`) já não tem esse problema porque usa `upsert(..., { ignoreDuplicates: true })`
para detectar inserção real.

Importante: o **dado em si já está correto** — o `upsert` com `onConflict` grava a linha certa
independente da corrida. O bug é só na decisão de notificar.

## Decisão

Em vez de reescrever a lógica de upsert de cada entidade (que teria formatos de "novo" diferentes —
venda é uma transição de status, pergunta/devolução são inserção pura), a corrida é resolvida numa
camada separada: uma tabela de reserva idempotente. Antes de notificar, cada worker tenta "reservar"
a chave do evento; só quem ganha a corrida do `INSERT` notifica. Isso desacopla a correção do dado
(que já está OK) da correção do "notificar 1x", e é o mesmo código nos 3 workers.

## Schema

Nova migration (`supabase migration new`):

```sql
create table ml_notificacoes_enviadas (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  entidade   text not null,          -- 'venda_paga' | 'pergunta_nova' | 'devolucao_nova'
  chave      text not null,          -- order_id / question_id / claim_id como string
  enviado_em timestamptz not null default now(),
  primary key (org_id, entidade, chave)
);

alter table ml_notificacoes_enviadas enable row level security;

create policy "ml_notificacoes_enviadas: select org" on ml_notificacoes_enviadas
  for select using (org_id = current_org_id());
```

A PK composta `(org_id, entidade, chave)` é o único ponto de verdade da corrida. Sem policy de
insert/update/delete para usuário — as únicas escritoras são as edge functions via
`SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS), mesmo padrão das outras tabelas `ml_*`.

Sem coluna de retenção/TTL: volume é 1 linha por evento de faturamento notificado (hoje ~147
vendas publicadas no total, entre as 2 orgs) — não há necessidade de limpeza.

## Helper (`_shared/faturamento/notificacoes-dedupe.ts`)

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Reserva atomicamente o direito de notificar 1x por (org, entidade, chave). A corrida é
 *  decidida pelo Postgres via PK composta, não pelo app: só quem consegue o INSERT sem colidir
 *  em 23505 deve notificar. Erro que não é 23505 (colisão real) falha FECHADO — não notifica,
 *  só loga — porque perder uma notificação pontual é bem menos grave que duplicar mensagem pro
 *  comprador, e o dado (upsert da venda/pergunta/devolução) já foi gravado corretamente antes
 *  desta chamada, então nada de negócio se perde, só o alerta. */
export async function reservarNotificacao(
  admin: SupabaseClient, orgId: string, userId: string | null, entidade: string, chave: string,
): Promise<boolean> {
  const { error } = await admin.from('ml_notificacoes_enviadas').insert({ org_id: orgId, user_id: userId, entidade, chave });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.error(`reservarNotificacao(${entidade}:${chave}): ${error.message}`);
  return false;
}
```

## Integração nos 3 workers

Cada worker já tem um `if (<flag> && orgId)` que dispara a(s) notificação(ões). Ganha um `&&
await reservarNotificacao(...)` extra na condição — nenhuma outra mudança de fluxo.

**`sync-venda/index.ts`** (gate cobre Telegram + mensagem automática ao comprador, ambas devem
sair juntas ou nenhuma):
```ts
if (novaPaga && orgId && await reservarNotificacao(admin, orgId, userId, 'venda_paga', String(pedido.id))) {
  await notificarCategoria(admin, orgId, 'vendas', montarMensagemNovaVenda({ ... }));
  if (conexao?.contaExternaId && pedido.buyer?.id != null) {
    await enviarMensagemPedido(token, packId, conexao.contaExternaId, String(pedido.buyer.id), '...');
  }
}
```

**`sync-pergunta/index.ts`**:
```ts
if (novaNaoRespondida && orgId && await reservarNotificacao(admin, orgId, job.user_id, 'pergunta_nova', String(row.question_id))) {
  await notificarCategoria(admin, orgId, 'perguntas', montarMensagemNovaPergunta({ ... }));
}
```

**`sync-devolucao/index.ts`**:
```ts
if (nova && orgId && await reservarNotificacao(admin, orgId, job.user_id, 'devolucao_nova', String(row.claim_id))) {
  await notificarCategoria(admin, orgId, 'pos_venda', montarMensagemNovaDevolucao({ ... }));
}
```

`reconciliar-faturamento` e `backfill-faturamento` chamam `upsertVenda`/`upsertPergunta`/
`upsertDevolucao` mas já descartam os booleans de "é novo" (nunca notificam) — não precisam de
mudança.

## Por que não tocar `upsertVenda`/`upsertPergunta`/`upsertDevolucao`

A reserva funciona mesmo que o cálculo interno de `novaPaga`/`novaNaoRespondida`/`nova` continue
racy: duas chamadas concorrentes podem ambas concluir erroneamente "é novo", mas só uma consegue
o `INSERT` na tabela de reserva sem colidir em `23505` — a Postgres unique constraint garante isso
independente de quantos processos acham (redundantemente) que deveriam notificar. Reescrever o
upsert de venda para fazer compare-and-swap na própria coluna `status` foi considerado (ver
alternativas abaixo) e descartado por adicionar complexidade específica por entidade sem ganho
sobre a tabela de reserva.

## Alternativas consideradas

1. **Compare-and-swap direto nas colunas** (`UPDATE ... WHERE status IS DISTINCT FROM 'paid'`
   guardado + fallback de insert, e reuso do padrão `ignoreDuplicates` de `mensagens-io.ts` para
   pergunta/devolução). Mais "fiel ao dado", mas cada entidade tem uma lógica de transição
   diferente (venda = mudança de status; pergunta/devolução = inserção pura), sem um helper único
   reaproveitável, e o caso mais comum de venda (pedido já pago recebendo só refresh de envio)
   passaria a fazer até 3 idas ao banco. Rejeitada em favor da tabela de reserva.
2. **RPC Postgres (plpgsql) fazendo upsert + decisão numa única transação.** Atomicidade mais
   "pura" (1 round-trip), mas exige função por entidade (ou uma genérica parametrizada), mais
   superfície de migration/deploy para um achado de severidade MÉDIA. Rejeitada por
   custo/benefício.

## Comportamento em falha / rollout

- `reservarNotificacao` falha fechado em erro que não é `23505`: perde-se **no máximo** a
  notificação daquele evento pontual, nunca duplica. O dado (venda/pergunta/devolução) já foi
  gravado antes dessa chamada, então nada de negócio é perdido — só o alerta.
- Ordem de deploy obrigatória (mesmo protocolo dos Increments do ADR-0086): `supabase db push`
  (cria a tabela, sem lock em tabela existente) → verificar tabela + policy no banco → só então
  deploy das 3 edge functions. Se o código subisse antes da migration, `reservarNotificacao`
  bateria em "tabela não existe", cairia no fail-closed (não notifica, não quebra o worker) — sem
  risco, mas perderia alertas até a migration rodar. Ordem correta evita essa janela.

## Testes

`reservarNotificacao` toca `SupabaseClient` (mesmo motivo dos arquivos irmãos `io.ts`,
`perguntas-io.ts`, `devolucoes-io.ts`: "não testado por vitest" por padrão, usa Deno/supabase-js).
Mas como decide se uma mensagem real sai ou não pro comprador, ganha 1 teste com um fake mínimo
(sem lib de mock), cobrindo os 3 ramos:

```ts
function fakeAdmin(result: { error: { code: string; message: string } | null }) {
  return { from: () => ({ insert: async () => result }) } as any;
}
```
- insert sem erro → `true`
- erro `code: '23505'` → `false`
- erro genérico (ex.: `08006`) → `false`, sem lançar

Sem teste automatizado de concorrência real (exigiria infra de integração fora do escopo deste
achado MÉDIA) — a garantia de atomicidade vem da PK composta do Postgres, não de teste de app.

## Escopo excluído

- Não mexe em `mensagens-io.ts` (já correto).
- Não resolve a corrida de "confirmação de mensagem parcialmente falha" (ex.: `notificarCategoria`
  ok mas `enviarMensagemPedido` lança, retry recomputa `novaPaga=false` porque o upsert já
  comitou) — comportamento pré-existente, idêntico antes e depois desta mudança, fora do escopo
  do achado.
- Não adiciona `database.types.ts` — `adminClient()` não é tipado com `Database` (confirmado:
  nenhuma tabela `ml_*` aparece lá hoje), edge functions não precisam.
