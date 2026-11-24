# Cancelamento tardio: fila própria armada pelo banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo pedido que o ML passa a dizer `cancelled` e ainda tem baixa de estoque aberta é levado a `tratarPedidoCancelado`, não importa quem gravou a venda nem quando.

**Architecture:**
- Sete colunas `cancelamento_*` em `ml_vendas`, preenchidas por trigger `before update of raw` que só faz atribuição.
- Três RPCs: `reivindicar_cancelamentos` (lote fixo por ciclo), `cancelamento_baixas` (o que o ledger diz), `registrar_cancelamentos_tratados` (desfecho por geração).
- Drenagem dentro do `reconciliar-faturamento`, na execução em que a etapa `pendencias` acha a fila comum vazia. Sem valor novo de cursor. Liga por `DRENAR_CANCELAMENTOS`.
- A fila não regrava a venda. Decide pelo ledger e passa ao tratamento os itens do ledger.

**Tech Stack:** Postgres/Supabase (migration, trigger, RPC), Deno edge function, vitest.

**Spec:** `docs/decisions/0211-obrigacao-de-cancelamento-com-fila-propria.md` revisão 2 (ler inteiro antes de começar; ler também ADR-0121).

**Classificação:** CRÍTICA (migration + caminho de estoque).
- Revisão independente obrigatória antes do merge: Codex Sol na versão mais recente (`codex debug models`), `model_reasoning_effort=high`, `-s read-only`, `< /dev/null`, contexto limpo, recebendo só o diff, os arquivos tocados e o ADR-0211. Ou subagente Opus high, se o autor for Codex.
- Implementador: Sonnet ou superior. Nunca rebaixar.

**Histórico de revisão:** a revisão 1 (`771ce88d`) recebeu REVISE do Codex gpt-6.2-sol (high) com 5 pontos. A tabela "Pontos da revisão" abaixo diz onde cada um é resolvido e testado.

## Global Constraints

- Trabalhar em worktree próprio, nunca na `main`. Copiar `.env.local` e `.env.test`.
- Migration **só** via `supabase migration new ml_vendas_cancelamento_fila` + `supabase db push`. Validar com `npm run db:check`. Antes de criar: `git fetch` e conferir que o timestamp gerado é mais novo que a última migration aplicada.
- Arquivos que **não podem aparecer no diff**:
  - `supabase/functions/backfill-faturamento/index.ts` e `passo.ts`
  - tudo em `supabase/functions/_shared/estoque/`
  - `supabase/functions/_shared/faturamento/pendencias.ts` e `io.ts`
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
| `supabase/tests/ml_vendas_cancelamento_fila.sql` | criar | teste SQL do trigger, das RPCs e das permissões |
| `supabase/functions/reconciliar-faturamento/cancelamentos.ts` | criar | drenagem: decisão pelo ledger, guardas do ML, lista fechada, IO |
| `supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts` | criar | testes do arquivo acima |
| `supabase/functions/reconciliar-faturamento/passo.ts` | alterar | chamar a drenagem no fim da etapa `pendencias`; `parcial` |
| `supabase/functions/reconciliar-faturamento/__tests__/passo.test.ts` | alterar | testes da chamada |
| `supabase/functions/reconciliar-faturamento/index.ts` | alterar | fiar a dep `drenarCancelamentos` |
| `supabase/functions/backfill-faturamento/__tests__/passo.test.ts` e `manual.test.ts` | alterar | só testes de caracterização |
| `supabase/functions/_shared/faturamento/__tests__/io.test.ts` | alterar | só teste: `upsertVenda` não envia colunas `cancelamento_*` |
| docs (`0211`, `0121`, `README.md`, `TASKS.md`, `project-status.md`) | alterar | status, ponteiro, índice, pendências |

## Pontos da revisão (REVISE de 24/11)

| # | Ponto | Onde é resolvido | Testes |
|---|---|---|---|
| 1 | Leitura antiga apaga obrigação ou autoriza estorno | A fila não regrava a venda; ML-`paid` nunca conclui; guardas de id, vendedor, status e `last_updated`; geração em toda confirmação; desarme só com registro não mais antigo | S5, S6, S9, S10, F3, F4, F5, F6 |
| 2 | `reposto`/`sem-baixa` escondem saldo baixado | Decisão pelo ledger antes e depois; itens vêm do ledger; ramo de aviso só com baixa aberta; V0/V4 com a mesma função | S11, F1, F7, F8, F9, F10, F11 |
| 3 | Etapa nova provoca `refazerBaixaAdiada` pela fila comum | `registrarPendenciaKit` neutralizado na fila; nada escreve em `worker_pendencias` | F12, F13, F14 |
| 4 | Teto por execução; rollback interrompe o reconciliar; CPU sem medição | Lote fixado por ciclo na RPC; sem cursor novo; drenagem nunca lança; chave por variável; medição em duas fases | S7, S8, P1–P5, F15, Task 6 |
| 5 | Trigger pode bloquear a gravação manual | Trigger só atribui em `new`: não há segunda escrita para falhar. Sem tabela nova, sem grant novo de tabela | S1–S4, S12, S13, B3, I1 |

## Teste por risco (os 8 bloqueios das tentativas anteriores)

| # | Risco | Teste |
|---|---|---|
| 1 | Transição perdida se o tratamento falha | S2, S2b (arma na mesma escrita). F2: tratamento devolve `erro` → registro com `concluir=false`; ciclo seguinte reivindica de novo sem depender de janela |
| 2 | `erro` classificado como ok | F1: tabela de **todos** os membros de `ResultadoCancelamento` com `satisfies Record<ResultadoCancelamento, …>` (desfecho novo quebra o build) |
| 3 | Venda inédita cancelada na fila | S1: `insert` já `cancelled` não arma. F9: sem baixa aberta, nenhuma chamada ao estoque (não grava tombstone) |
| 4 | `descartado_em` tira da fila | S13: não há coluna de descarte. S8: obrigação com 30 tentativas continua reivindicável |
| 5 | Obrigação lida como baixa adiada | F12–F14 (kit). F16 estrutural: `cancelamentos.ts` não contém `refazerBaixaAdiada`, `worker_pendencias`, `desfechoKit`, `upsertVenda`. S2: `worker_pendencias` sem linha |
| 6 | `throw` no lote tira retentativa de venda `paid` | B1 (backfill agendado): lote com 1 `cancelled` gravado e 1 `paid` com falha → não lança, `registrarFalhas` recebe o `paid`, cursor avança |
| 7 | Falha fora da fila contada como enfileirada | B2: `pedidosComFalha` igual ao tamanho da lista passada a `registrarFalhas`. Diff do backfill vazio (Task 7) |
| 8 | Corridas do aviso | Diff de `_shared/estoque/` vazio (Task 7). `cancelamento.test.ts` verde sem alteração |

---

## Task 1 — Migration e teste SQL

**Files:** `supabase/tests/ml_vendas_cancelamento_fila.sql` (criar), `supabase/migrations/<ts>_ml_vendas_cancelamento_fila.sql` (criar)

- [ ] **1.1 RED: escrever o teste SQL.** Formato de `supabase/tests/cupom_vendedor.sql` (`begin; … rollback;`, asserções em `do $$ … raise exception`). Fixtures: duas orgs, um usuário em cada, no padrão de `adr195_confirmacoes_ml.sql`. As escritas de fixture em `ml_vendas` e as chamadas de RPC rodam sob `set local role service_role` (o papel real das edges).

| Caso | Passos | Esperado |
|---|---|---|
| S1 | `insert` com `raw.status='cancelled'` | `cancelamento_geracao` nula |
| S2 | venda `paid`; `update` de `status` e `raw` para `cancelled` | geração preenchida, `armado_em` preenchido, `tentativas=0`, `concluido_em` nulo; 0 linhas em `worker_pendencias` |
| S2b | venda `paid`; `insert … on conflict (user_id, order_id) do update set status = excluded.status, raw = excluded.raw` (forma do `upsertVenda`) | armada |
| S3 | venda `paid`; `update` só da coluna `status` para `cancelled` (como `marcarConversaCancelada`) | não arma. Depois `raw` para `cancelled` → arma |
| S4 | venda armada; `update` de `raw` ainda `cancelled` (com `last_updated` novo) | geração e `armado_em` não mudam |
| S5 | venda armada; `raw` volta a `paid` com `last_updated` **mais novo** | `concluido_em` preenchido, desfecho `desarmado` |
| S6 | venda armada; `raw` vira `paid` com `last_updated` **mais antigo**, ausente ou ilegível (`'x'`) | continua pendente; o `update` não falha |
| S7 | 25 vendas armadas há mais de 5 min; `reivindicar_cancelamentos(org, 'L1', 20, '5 minutes')` duas vezes | as duas chamadas devolvem os **mesmos** 20; 5 ficam sem lote |
| S7b | concluir 3 das 20 e chamar de novo com `'L1'` | devolve as 17 restantes; nenhuma nova entra (o teto conta as concluídas) |
| S7c | chamar com `'L2'` | devolve 20: as 5 nunca tentadas primeiro, depois as menos recentemente tentadas |
| S7d | venda armada há 1 minuto | não é reivindicada |
| S8 | obrigação com `cancelamento_tentativas=30` | reivindicável |
| S9 | `registrar_cancelamentos_tratados` com a geração lida e `concluir=true` | `concluido_em` e desfecho gravados, `tentativas=1`; devolve 1 |
| S10 | rearme entre leitura e confirmação: ler geração G1, `raw` → `paid` (novo) → `cancelled`; registrar com G1, uma vez `concluir=true` e outra `false` | devolve 0 nas duas; a geração nova segue pendente com `tentativas=0` |
| S11 | `cancelamento_baixas`: pedido com (a) baixa sem estorno, (b) baixa com `estorno_venda` quantidade > 0, (c) baixa com `estorno_sku_nao_encontrado` quantidade 0, (d) só `cancelamento_sem_baixa`, (e) baixa de kit com `codigo` diferente do sufixo da referência | (a) aberta; (b) `estornada=true`; (c) aberta; (d) nenhuma linha; (e) `codigo_ref` = sufixo da referência |
| S12 | catálogo: corpo da função do trigger (`pg_get_functiondef`) | não contém `insert`, `update`, `delete` nem `perform`; `prosecdef=false` |
| S13 | catálogo e permissões | sem coluna de descarte; as 3 RPCs com `prosecdef=true`, `search_path=""`, dono `postgres`; `has_function_privilege`: `service_role` sim, `anon` e `authenticated` não; sob `set local role authenticated` com claims da org B, `select` das colunas novas da org A devolve 0 linhas; sob `service_role`, as 3 RPCs executam |
| S14 | logo após a migration | nenhuma linha de `ml_vendas` com geração preenchida, havendo cancelados |

- [ ] **1.2 Prova de vermelho:** `python3 scripts/teste-sql-desfeito.py supabase/tests/ml_vendas_cancelamento_fila.sql` (sem migration) tem de falhar.

- [ ] **1.3 GREEN: criar a migration** com `supabase migration new ml_vendas_cancelamento_fila`:

```sql
-- ADR-0211: obrigação de tratar cancelamento, armada na própria linha da venda.
alter table public.ml_vendas
  add column cancelamento_geracao      uuid,
  add column cancelamento_armado_em    timestamptz,
  add column cancelamento_lote         text,
  add column cancelamento_tentativas   integer not null default 0,
  add column cancelamento_tentado_em   timestamptz,
  add column cancelamento_desfecho     text,
  add column cancelamento_concluido_em timestamptz;
create index ml_vendas_cancelamento_fila_idx on public.ml_vendas (org_id, cancelamento_lote)
  where cancelamento_geracao is not null;

-- Só atribui em NEW: não escreve em outra tabela, então não cria falha nova no upsert de ninguém.
create function public.ml_vendas_cancelamento_fila()
returns trigger language plpgsql set search_path = '' as $$
declare v_mais_velho boolean;
begin
  if coalesce(new.raw->>'status', '') = 'cancelled' then
    new.cancelamento_geracao      := pg_catalog.gen_random_uuid();
    new.cancelamento_armado_em    := clock_timestamp();
    new.cancelamento_lote         := null;
    new.cancelamento_tentativas   := 0;
    new.cancelamento_tentado_em   := null;
    new.cancelamento_desfecho     := null;
    new.cancelamento_concluido_em := null;
    return new;
  end if;
  if new.cancelamento_geracao is null or new.cancelamento_concluido_em is not null then
    return new;
  end if;
  -- Saiu de cancelled: só desarma se o registro novo não for mais antigo. Na dúvida, mantém.
  begin
    v_mais_velho := coalesce(
      (new.raw->>'last_updated')::timestamptz < (old.raw->>'last_updated')::timestamptz, true);
  exception when others then
    v_mais_velho := true;
  end;
  if not v_mais_velho then
    new.cancelamento_concluido_em := clock_timestamp();
    new.cancelamento_desfecho     := 'desarmado';
  end if;
  return new;
end;
$$;
revoke all on function public.ml_vendas_cancelamento_fila() from public, anon, authenticated;

-- `of raw`: marcarConversaCancelada grava só a coluna status. Só update: venda inédita não arma.
create trigger ml_vendas_cancelamento_fila
  before update of raw on public.ml_vendas
  for each row
  when ((coalesce(new.raw->>'status', '') = 'cancelled')
        is distinct from (coalesce(old.raw->>'status', old.status, '') = 'cancelled'))
  execute function public.ml_vendas_cancelamento_fila();

-- Lote fixo por ciclo: repetir a chamada com o mesmo p_lote devolve os mesmos pedidos, nunca outros.
create function public.reivindicar_cancelamentos(p_org uuid, p_lote text, p_limite integer, p_carencia interval)
returns table (id uuid, order_id bigint, geracao uuid, raw_atualizado text)
language plpgsql security definer set search_path = '' as $$
declare v_ja integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cancelamentos|' || p_org::text, 0));
  select count(*) into v_ja from public.ml_vendas v
   where v.org_id = p_org and v.cancelamento_geracao is not null and v.cancelamento_lote = p_lote;
  update public.ml_vendas v set cancelamento_lote = p_lote
   where v.id in (
     select c.id from public.ml_vendas c
      where c.org_id = p_org and c.cancelamento_geracao is not null and c.cancelamento_concluido_em is null
        and c.cancelamento_lote is distinct from p_lote
        and c.cancelamento_armado_em <= clock_timestamp() - p_carencia
      order by c.cancelamento_tentado_em asc nulls first, c.order_id
      limit greatest(p_limite - v_ja, 0));
  return query
    select v.id, v.order_id, v.cancelamento_geracao, v.raw->>'last_updated'
      from public.ml_vendas v
     where v.org_id = p_org and v.cancelamento_geracao is not null and v.cancelamento_lote = p_lote
       and v.cancelamento_concluido_em is null;
end;
$$;

-- O que o ledger diz de cada pedido. Estorno efetivo = estorno_venda com quantidade > 0
-- (tombstone e estorno_sku_nao_encontrado têm quantidade 0 e não devolvem saldo).
-- codigo_ref = sufixo da referência (em venda de kit difere de `codigo`, que é o componente).
create function public.cancelamento_baixas(p_org uuid, p_orders text[])
returns table (order_id text, codigo_ref text, quantidade integer, estornada boolean)
language sql stable security definer set search_path = '' as $$
  select o.id, split_part(m.referencia_externa, ':', 3), -m.quantidade,
         exists (select 1 from public.estoque_movimentos e
                  where e.org_id = m.org_id and e.referencia_externa = 'estorno:' || m.referencia_externa
                    and e.motivo = 'estorno_venda' and e.quantidade > 0)
    from unnest(p_orders) as o(id)
    join public.estoque_movimentos m
      on m.org_id = p_org and m.motivo = 'venda' and m.quantidade < 0
     and m.referencia_externa like 'mercado\_livre:' || o.id || ':%';
$$;

-- Desfecho por geração: linha rearmada (geração nova) não é concluída nem ganha tentativa.
create function public.registrar_cancelamentos_tratados(p_org uuid, p_itens jsonb)
returns integer language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_vendas v
       set cancelamento_tentativas   = v.cancelamento_tentativas + 1,
           cancelamento_tentado_em   = clock_timestamp(),
           cancelamento_desfecho     = x.desfecho,
           cancelamento_concluido_em = case when x.concluir then clock_timestamp() end
      from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
           as x(id uuid, geracao uuid, concluir boolean, desfecho text)
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

O SQL acima é desenho: não foi executado. A Task 1.4 é a prova.

- [ ] **1.4 Rodar verde:** `python3 scripts/teste-sql-desfeito.py supabase/tests/ml_vendas_cancelamento_fila.sql supabase/migrations/<ts>_ml_vendas_cancelamento_fila.sql` → `TESTE_OK`. Rodar longe do minuto :40 (`renovar-tokens-ml`).
- [ ] **1.5** `npm run db:check`. Commit: `feat(estoque): obrigação de cancelamento armada na venda (ADR-0211)`.

## Task 2 — `cancelamentos.ts`: a drenagem

**Files:** `supabase/functions/reconciliar-faturamento/cancelamentos.ts` (criar), `__tests__/cancelamentos.test.ts` (criar)

Contrato (o corpo é do implementador; os testes abaixo fixam o comportamento):

```ts
// ADR-0211: drenagem da obrigação de cancelamento. Não regrava a venda, não toca a fila comum nem a de kit.
export const LOTE_CANCELAMENTOS = 20;
export const CARENCIA = '5 minutes';

/** `1` = todas as orgs; lista de ids separada por vírgula = só essas; ausente = desligada. */
export function drenagemLigada(valor: string | undefined, orgId: string): boolean;

export interface Obrigacao { id: string; orderId: string; geracao: string; rawAtualizado: string | null }
export interface Baixa { codigoRef: string; quantidade: number; estornada: boolean }
export interface Registro { id: string; geracao: string; concluir: boolean; desfecho: string }

export interface IoFila {
  contaExternaId: string | null;
  reivindicar(lote: string): Promise<Obrigacao[]>;
  baixas(orderIds: string[]): Promise<Map<string, Baixa[]>>;
  pedido(orderId: string): Promise<PedidoML>;
  envio(shippingId: number | string): Promise<{ status: string | null } | null>;
  aindaPendente(o: Obrigacao): Promise<boolean>;
  kitLigado(): Promise<boolean>;
  tratar(p: PedidoCancelado): Promise<ResultadoCancelamento>;
  registrar(itens: Registro[]): Promise<void>;
}

/** `registrarPendenciaKit` vira função vazia: a retentativa do crédito de kit fica na fila própria. */
export function depsDaFila(base: DepsCancelamento): DepsCancelamento;

/** Um lote. Só lança se `reivindicar`, `baixas` ou `registrar` lançarem; quem chama captura. */
export async function drenarCancelamentos(io: IoFila, lote: string): Promise<{ concluidos: number; pendentes: number }>;
```

Regra de `drenarCancelamentos`, por obrigação:

1. `baixas` do pedido. Nenhuma aberta → registro `sem-baixa-aberta`, `concluir=true`. Fim.
2. `pedido` e `envio`. Qualquer falha de leitura ou guarda reprovada → registro `ml: <motivo>`, `concluir=false`. Guardas: `String(pedido.id) === orderId`; `ehVendaDaConta(pedido, contaExternaId)`; `pedido.status === 'cancelled'`; `Date.parse(pedido.last_updated) >= Date.parse(rawAtualizado)` (qualquer um ausente ou ilegível reprova). O tipo `PedidoML` não declara `last_updated`: ler com um tipo local em `cancelamentos.ts`, sem alterar `_shared/faturamento/venda.ts`. O campo existe em todas as 10.542 vendas gravadas (`raw`, conferido em 24/11).
3. Estado misto (alguma baixa estornada e alguma aberta) e o envio não é pré-despacho → registro `parcial-sem-pre-despacho`, `concluir=false`, sem chamar `tratar`. Pré-despacho se decide com `entraNoCreditoKit({ …, kitLigado: true })`, que é o predicado de `cancelamento.ts` (não duplicar a lista de status).
4. `aindaPendente` falso → não trata e não registra (a geração mudou; a RPC ignoraria de qualquer jeito).
5. `tratar` com `itens = baixas abertas.map((b) => ({ codigo: b.codigoRef, quantity: b.quantidade }))`, `catalogoIncompleto: false`, `kitLigado: await io.kitLigado()`.
6. Desfecho: `reposto` → reler `baixas`; nenhuma aberta conclui, senão `reposicao-incompleta`. `avisado` e `silenciado` concluem. Todo o resto, inclusive exceção, não conclui.

Paralelismo: 5 por vez, como no resto do arquivo. `kitLigado` é lido no máximo uma vez por lote, e só se alguma obrigação chegou ao passo 5.

- [ ] **2.1 RED: testes** (IO falso em memória; F12–F14 usam o `tratarPedidoCancelado` **real** com dependências falsas).

| Caso | Cenário | Esperado |
|---|---|---|
| F1 | Para cada membro de `ResultadoCancelamento` devolvido por `tratar` (tabela `satisfies Record<ResultadoCancelamento, 'conclui' \| 'fica' \| 'confere-ledger'>`) | `avisado`/`silenciado` concluem; `reposto` confere o ledger; os demais ficam |
| F2 | `tratar` devolve `erro` | registro `concluir=false`; em novo ciclo a obrigação é tratada de novo |
| F3 | Ordem A com `sync-venda`: ML devolve `paid` | registro `ml: status paid`, `concluir=false`; `tratar` não chamado; o IO não tem como gravar venda |
| F4 | Ordem B: ML devolve `cancelled` com `last_updated` mais antigo que `rawAtualizado` | `concluir=false`; `tratar` não chamado |
| F5 | Geração mudou entre a reivindicação e o tratamento (`aindaPendente` falso) | `tratar` não chamado; nenhum registro para o pedido |
| F6 | Resposta com `id` de outro pedido; resposta de outro vendedor; `last_updated` ausente | cada uma: `concluir=false`, `tratar` não chamado |
| F7 | Falha parcial: 2 SKUs, `tratar` devolve `reposto`, ledger depois mostra 1 aberta | `reposicao-incompleta`, `concluir=false` |
| F8 | SKU alterado: o vínculo do item mudou depois da venda | os itens passados a `tratar` têm o `codigoRef` do ledger, não um código resolvido de novo |
| F9 | Sem baixa aberta (nunca baixou, ou já estornada pelo webhook) | conclui `sem-baixa-aberta`; nenhuma chamada a `pedido`, `envio` ou `tratar` |
| F10 | Dois ramos em sequência: ciclo 1 envio `ready_to_ship` → `reposto` e ledger limpo → conclui. Rearma. Ciclo 2 envio `cancelled` | ciclo 2 conclui `sem-baixa-aberta` sem chamar `tratar` (nenhum aviso de entrada manual depois do estorno) |
| F11 | Estado misto com envio `shipped` | `parcial-sem-pre-despacho`; `tratar` não chamado. Com envio `handling` → `tratar` chamado só com as abertas |
| F12 | Kit, fiação real, ciclo 1: `tratarPedidoCancelado` real com `depsDaFila(base)`, crédito de participante falha | resultado `pendente`; `base.registrarPendenciaKit` (espião) **não** chamado; registro `concluir=false` |
| F13 | Kit, ciclo 2: ML passa a devolver `paid` | registro `ml: status paid`; `tratar` não chamado; espião de `registrarPendenciaKit` segue em 0 |
| F14 | Baixa adiada legítima preexistente (linha `obrigatoria` simulada na fila comum) | a drenagem não lê nem altera essa linha (o IO da fila não tem acesso a ela) |
| F15 | Contagem: lote de 20 com 12 sem baixa aberta e 8 com | exatamente 8 leituras de pedido e no máximo 8 de envio; `baixas` chamado no máximo 1 + (nº de `reposto`); `kitLigado` no máximo 1 vez; `registrar` 1 vez |
| F16 | Estrutural: texto de `cancelamentos.ts` | não contém `refazerBaixaAdiada`, `worker_pendencias`, `desfechoKit`, `upsertVenda`, `lerPendenciasKit` |
| F17 | `drenagemLigada` | `undefined` e `''` → falso; `'1'` → verdadeiro; lista → só para os ids listados |
| F18 | Item do ledger sem `ml_item_id` no caminho de kit: `classificarItensKit` e `gravarIdentidades` reais com `incerto=false` | o item volta em `certos` com o mesmo código |

- [ ] **2.2 Rodar e ver falhar:** `pnpm vitest run supabase/functions/reconciliar-faturamento/__tests__/cancelamentos.test.ts`.
- [ ] **2.3 GREEN: implementar** `cancelamentos.ts` conforme o contrato e a regra acima.
- [ ] **2.4** Rodar verde. Commit: `feat(reconciliar): drenagem da obrigação de cancelamento (ADR-0211)`.

## Task 3 — Chamada em `passo.ts`

**Files:** `supabase/functions/reconciliar-faturamento/passo.ts`, `__tests__/passo.test.ts`

- [ ] **3.1 RED: testes.**

| Caso | O que prova |
|---|---|
| P1 | Nenhum cursor novo: o conjunto de etapas que `passoReconciliar` devolve em `proximo` é o de hoje |
| P2 | Com pendências na fila comum, o último lote devolve `pendencias|<último id>` (não mais `perguntas|` direto). A execução seguinte, com a fila comum vazia, chama `drenarCancelamentos(params.ate)` e devolve `perguntas|`. Ajustar o teste existente "25 pendências" |
| P3 | `drenarCancelamentos` lança → o passo não lança, devolve `perguntas|` e `acumulado.cancelamentosErro = 1` |
| P4 | Repetição da mesma execução (avanço do cursor falhou): a drenagem é chamada de novo com o **mesmo** `params.ate` |
| P5 | Fim da rodada: `cancelamentosPendentes > 0` ou `cancelamentosErro > 0` → `parcial` com o texto novo; os dois zerados → `parcial` igual ao de hoje |
| P6 | Na execução da drenagem, `processarPedidos` e `registrarPendencias` não são chamados |

- [ ] **3.2 Rodar e ver falhar.**
- [ ] **3.3 GREEN.** Em `DepsReconciliar`:

```ts
  /** ADR-0211: um lote da fila de cancelamento, fixado por `lote`. Devolve zeros quando desligada. */
  drenarCancelamentos(token: string, cx: ConexaoCanal, userId: string, lote: string): Promise<{ concluidos: number; pendentes: number }>;
```

Na etapa `pendencias`:

```ts
      if (ids.length === 0) {
        // ADR-0211: a drenagem roda sozinha nesta execução e nunca segura as etapas seguintes.
        let acc = acumulado;
        try {
          const d = await deps.drenarCancelamentos(token, cx, userId, params.ate);
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

- [ ] **3.4** Rodar verde (arquivo de teste inteiro). Commit: `feat(reconciliar): drena cancelamentos no fim das pendências (ADR-0211)`.

## Task 4 — Fiação em `index.ts`

**Files:** `supabase/functions/reconciliar-faturamento/index.ts`

- [ ] **4.1** Em `depsReal`, a dep nova. Nenhuma linha existente de `processarPedidos` muda.

```ts
    async drenarCancelamentos(token, cx, userId, lote) {
      if (!drenagemLigada(Deno.env.get('DRENAR_CANCELAMENTOS'), orgId)) return { concluidos: 0, pendentes: 0 };
      const deps = depsDaFila(depsCancelamento);
      return await drenarCancelamentos({
        contaExternaId: cx.contaExternaId,
        reivindicar: (l) => /* rpc reivindicar_cancelamentos(orgId, l, LOTE_CANCELAMENTOS, CARENCIA); erro lança */,
        baixas: (ids) => /* rpc cancelamento_baixas(orgId, ids) agrupado por order_id; erro lança */,
        pedido: (id) => buscarPedido(token, id),
        envio: (id) => buscarShipment(token, id),
        aindaPendente: (o) => /* select id de ml_vendas por id + geracao + concluido_em nulo; erro lança */,
        kitLigado: async () => (await catalogoDe(userId, orgId)).kitLigado,
        tratar: (p) => tratarPedidoCancelado(admin, deps, { ...p, orgId, userId, canal: 'mercado_livre' }),
        registrar: (itens) => /* rpc registrar_cancelamentos_tratados(orgId, itens); erro lança */,
      }, lote);
    },
```

- [ ] **4.2** `buscarShipment` devolve `null` em erro de rede. `null` com `pedido.shipping.id` presente é "não deu para ler": passa `shipmentStatus: null` e `temEnvio: true`, e `tratarPedidoCancelado` cai no ramo de aviso, como na `main`.
- [ ] **4.3 Verificar:** `pnpm vitest run supabase/functions/reconciliar-faturamento` verde; typecheck do `pnpm preflight:static` sem erro.
- [ ] **4.4** Commit: `feat(reconciliar): fiação da drenagem de cancelamentos (ADR-0211)`.

## Task 5 — Caracterização do que não muda

**Files:** só testes.

- [ ] **5.1** B1 e B2 em `backfill-faturamento/__tests__/passo.test.ts` (ver "Teste por risco" 6 e 7).
- [ ] **5.2** B3 em `backfill-faturamento/__tests__/manual.test.ts`: `processarConexao` com um pedido `cancelled` cujo `upsertVenda` funciona e um `paid` cujo `upsertVenda` falha → `sincronizados=1`, `pedidosComFalha=1`, não lança. Registra o comportamento de hoje do botão Sincronizar.
- [ ] **5.3** I1 em `_shared/faturamento/__tests__/io.test.ts`: a linha que `upsertVenda` envia ao banco não tem nenhuma chave começando por `cancelamento_`. Trava para ninguém regravar a fila pelo upsert.
- [ ] **5.4** Os quatro passam **sem alterar código de produção**. Commit: `test: travas de regressão do ADR-0211`.

## Task 6 — Medição de custo (portão do ADR-0173)

- [ ] **6.1 Antes do deploy, determinística:** F15 é o teto de requisições. Por obrigação com baixa aberta: 1 leitura de pedido, até 1 de envio, o tratamento. Sem baixa aberta: zero chamadas externas. É um subconjunto estrito do que `processarPedidos` já faz por pedido na etapa `pendencias` (frete, envio, MP, `upsertVenda`, tratamento), com lote de 20 contra 20.
- [ ] **6.2 Depois do deploy, em canário:** ligar `DRENAR_CANCELAMENTOS` só para duas orgs, uma delas com `kit_variacao` ligado. Observar 24 ciclos:
  - log `[rodada] lote` da execução com cursor `pendencias|…` que segue para `perguntas|`: campo `ms`;
  - métricas da função: `CPUTime`, `WORKER_RESOURCE_LIMIT`, `IDLE_TIMEOUT`.
- [ ] **6.3 Aceite:** zero erro de limite; `ms` da execução abaixo de 60.000; CPU máxima no patamar das medições do ADR-0173 (mediana ~200 ms, máximo < 500 ms). Fora disso: desligar a variável e voltar ao desenho.
- [ ] **6.4** Só então trocar a variável para `1`. Registrar os números no ADR-0211.

Limite desta medição: o acervo não arma, então os lotes reais serão pequenos. O lote cheio de 20 com baixa aberta só é coberto por F15 e pelo argumento de subconjunto do 6.1.

## Task 7 — Portão, revisão e documentação

- [ ] **7.1** `pnpm preflight` verde.
- [ ] **7.2** Estes comandos saem vazios:
  - `git diff origin/main --stat -- supabase/functions/backfill-faturamento/index.ts supabase/functions/backfill-faturamento/passo.ts`
  - `git diff origin/main --stat -- supabase/functions/_shared/estoque/ supabase/functions/_shared/rodada/ supabase/functions/_shared/faturamento/pendencias.ts supabase/functions/_shared/faturamento/io.ts supabase/functions/reconciliar-faturamento/kit.ts`
- [ ] **7.3** Revisão independente (ver Classificação). Entregar ao revisor as tabelas "Pontos da revisão" e "Teste por risco" e pedir veredito por linha.
- [ ] **7.4** Docs: ADR-0211 → `Aceito` com os SHAs e a medição; emenda de uma linha no ADR-0121 apontando para o 0211; linha no `docs/decisions/README.md`; `docs/TASKS.md`; `docs/project-status.md`. Seguir a skill `docs-update-checklist`. O repositório é público: nenhum id de org, nome de comprador ou lista de pedidos nos docs.
- [ ] **7.5** Atualizar o Graphify (skill `graphify-update-maintenance`).

## Task 8 — Deploy

- [ ] **8.1** Rodar V0 e guardar a saída fora do repositório.
- [ ] **8.2** Push → CI verde → merge fast-forward na `main` → `supabase db push` → `npm run db:check`. O trigger começa a armar; ninguém drena.
- [ ] **8.3** Rodar V1 e V2.
- [ ] **8.4** `supabase functions deploy reconciliar-faturamento`. Conferir a versão ativa. **Só esta função.** Sem a variável, a drenagem continua desligada.
- [ ] **8.5** Canário e aceite (Task 6). Depois `DRENAR_CANCELAMENTOS=1`.
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
select proname, pg_get_userbyid(proowner) dono, prosecdef, proconfig::text, proacl::text from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('ml_vendas_cancelamento_fila', 'reivindicar_cancelamentos',
                   'cancelamento_baixas', 'registrar_cancelamentos_tratados');
```

Esperado: 2 triggers; as 3 RPCs com dono `postgres`, `prosecdef = true`, `search_path=""`, execute só para `postgres` e `service_role`; a função do trigger com `prosecdef = false`.

**V2 — sem rajada (logo após a migration).**

```sql
select count(*) from public.ml_vendas where cancelamento_geracao is not null;
```

Esperado: 0, ou só os cancelamentos dos minutos desde o `db push`.

**V3 — a fila anda (com a variável ligada; repetir depois do backfill das 06:30 UTC).**

```sql
select org_id, order_id, cancelamento_armado_em, cancelamento_lote, cancelamento_tentativas,
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

- [ ] **R1** Rodar V0 e enriquecer cada linha (uma consulta por org) com: SKU e quantidade da baixa (`estoque_movimentos.codigo`, `quantidade`), `ml_vendas.shipping_status`, data da venda, claim mais recente (`ml_devolucoes`), e o primeiro movimento manual do SKU **depois** da baixa (entrada, ajuste ou inventário, com `criado_em`).
- [ ] **R2** Classificar cada linha:

| Grupo | Critério | Ação sugerida ao operador |
|---|---|---|
| A | Houve entrada, ajuste ou inventário do SKU depois da baixa | Nada. A contagem posterior já absorveu a unidade |
| B | Sem movimento manual posterior e envio `delivered`, `shipped` ou `not_delivered` | Dar entrada manual só quando o produto voltar |
| C | Sem movimento manual posterior e envio `cancelled`, `pending`, `handling`, `ready_to_ship` ou nulo | Conferir a prateleira. Se a unidade está lá, entrada manual |

- [ ] **R3** Entregar ao Diego uma planilha por org, ordenada por SKU, com o grupo e a ação. Os 77 sem aviso vêm destacados.
- [ ] **R4** O Diego decide como cada org recebe a lista. O sistema não dispara aviso em massa.
- [ ] **R5** Depois de cada org terminar, rodar V0 só dela. Os pedidos dos grupos A e B continuam na consulta; o fechamento é a planilha conferida, não a consulta zerada.
- [ ] **R6** Caso já decidido: pedido `2000019609391838` não é estornado (a contagem de 18/11 zerou o SKU depois da baixa).

## Fora de escopo

- Qualquer mudança no aviso de `cancelamento.ts` (decisão do Diego).
- Corrigir `houveBaixaDeVenda` nos caminhos antigos (aviso "não reposto" depois de estorno; ver ADR-0211, Achado fora do escopo).
- Fechar a janela residual entre a conferência de versão e a RPC de estoque (exige mudar a RPC).
- Drenar no caminho legado do reconciliar.
- Alerta automático de obrigação parada.
- Usar o histórico do envio como prova de pré-despacho (muda a decisão 3 do ADR-0121; pede ADR próprio).
- Tela para a fila.

## Medição (preencher ao fim)

classificação · modelos (principal e subagentes) · revisões · escalonamento
