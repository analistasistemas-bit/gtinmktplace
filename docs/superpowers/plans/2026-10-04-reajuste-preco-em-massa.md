# Reajuste de preço em massa — Implementation Plan (v2, pós-revisão Codex)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reajustar (±% / ±R$) o preço de N anúncios do ML a partir da tela Publicados, durável no banco, com trava financeira, serialização atômica com os outros escritores de preço, recuperação de envio incerto e Reverter — 3º tipo do motor de operações em massa.

**Architecture:** Preview no servidor gravado como operação `rascunho`; `confirmar` (RPC transacional) publica a execução no QStash; handler `reajustar` no laço comum com claim único (`reajuste_reivindicar`: lock do produto `codigo_pai` + famílias + MLB). Escrita só-preço no ML, confirmação por GET, persistência atômica (`reajuste_persistir`). Publicação/UPDATE, adesão a promoção e entrada em PxV reservam com o mesmo lock de produto/MLB e recusam com reajuste ativo.

**Tech Stack:** Supabase Postgres (plpgsql security definer), Edge Functions Deno, QStash, React + TanStack Query, vitest, testes SQL em Postgres local (Docker).

**Spec:** `docs/superpowers/specs/2026-10-04-reajuste-preco-em-massa-design.md` (aprovada pelo GPT-6 Astra) · **ADR:** `docs/decisions/0178-reajuste-de-preco-em-massa.md`. Ler os contratos **C1–C5** antes de qualquer task.

## Global Constraints

- Roteamento: **opus** em todas as tasks de código (escrita em marketplace, financeiro, RPC/locks, preview com margem); **sonnet** só na Task 11 (docs). Revisão por task: **Grok 4.7 xhigh** via `cursor-agent`.
- Migrations só `supabase migration new` + `supabase db push` (ADR-0043); `db push` só na Task 12. Antes de DROP CONSTRAINT/REPLACE FUNCTION, ler definição real (`pg_get_constraintdef`, `pg_get_functiondef`).
- Testes: focado `pnpm exec vitest run <path>`; **duas árvores** (`src/**/__tests__` e `tests/`). SQL: Postgres local via `docker exec -i supabase_db_<ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1`; o teste **concorrente exige Docker** (se não subir: reportar BLOCKED, não pular).
- Git: `/usr/bin/git` simples; commit `-F` com arquivo em `/Users/diego/.claude/jobs/628d3bf1/tmp/` (nome único); `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push.
- Service role sempre com `org_id`. Rascunho: qualquer membro; `confirmar` e Reverter: admin ou suporte `full` (servidor).
- Dinheiro em centavos, half-up, uma função pura (`_shared/operacoes/reajuste/alvo.ts`), importada pelo front (o front já importa de `supabase/functions/_shared/`).
- Origem ausente → ⚪ (comportamento atual de `cadastro.ts:56`; não alterar).
- Não-regressão: testes existentes de `_shared/operacoes/__tests__/` não editados; promoções e pausar/reativar intactos; publicação idêntica quando não há reajuste.
- **Identidade de serialização = `(org_id, codigo_pai)`** (produto), resolvida do MLB dentro das RPCs. Ordem de locks: produto (`codigo_pai`) → MLB. Chaves: `hashtextextended('rp:'||org||':'||codigo_pai, 0)` e `hashtextextended('rm:'||org||':'||ml_item, 0)`.
- Nada de escrita direta no ML fora do app (testes com mocks).
- Teto 500 MLBs/operação (servidor rejeita); 100 itens/mensagem QStash.

## Review Focus

1. Corrida reajuste × publicação de **família criada depois do preview** (mesmo `codigo_pai`) → uma recusa. → Task 2 (concorrência).
2. PUT aplicado + `invalid_grant`/401 depois → item continua recuperável (`conferindo`), operação não conclui. → Tasks 6/7.
3. Persistência com conflito na **segunda** cor → nenhuma cor alterada. → Task 2.
4. Tarifa do ML muda entre preview e execução → `mudou`. → Tasks 5/6.
5. Confirmou → editou preço → precisa confirmar de novo. → Tasks 7/10.

---

### Task 1: Migration de schema (opus)

**Files:** Create `supabase/migrations/<ts>_reajuste_preco_schema.sql` (`supabase migration new reajuste_preco_schema`); Modify `supabase/tests/operacoes_massa.sql`, `src/lib/database.types.ts`, `supabase/functions/_shared/operacoes/tipos.ts`, `src/lib/operacoes.ts`, `src/components/operacoes/lista-operacoes.tsx` (só tipos/rótulos).

**Produces:**
- `operacoes_massa.acao` + `'reajustar'`; CHECK coerência: `reajustar` com `promocao_*` nulos; `status` + `'rascunho'`; coluna `expira_em timestamptz`.
- `operacoes_massa_itens.status` + `'rascunho'`, `'conferindo'`; colunas `preco_anterior numeric`, `etapa text check (etapa in ('escrita_pedida','ml_confirmado'))`, `confirmado_sem_dado boolean not null default false`, `incluido boolean not null default true`, `avaliacao jsonb`, `estado_anterior jsonb`, `variacoes_ml jsonb`, `variacao_ids uuid[]`, `codigo_pai text`.
- Índice `operacoes_massa_itens_status_unico` recriado com `status in ('pendente','enviando','conferindo')`.
- Backend `tipos.ts`: `StatusItem` + `'rascunho' | 'conferindo'`; `CamposItem` + `etapa: 'escrita_pedida'|'ml_confirmado'|null`, `preco_anterior`, `incluido`. Front `StatusItemOperacao` + mesmos; `ROTULO_STATUS` (`rascunho:'Rascunho'`, `conferindo:'Conferindo no ML'`); `TONE_STATUS` (`rascunho:'neutral'`, `conferindo:'info'`); `NAO_TERMINAL` da lista inclui `'conferindo'`.

- [ ] **Step 1 (vermelho)** — bloco novo em `supabase/tests/operacoes_massa.sql` (antes do rollback):
```sql
-- ADR-0178 (reajuste de preço em massa): schema.
reset role;
do $$
declare v_org uuid := '91000000-0000-0000-0000-000000000001';
        v_r uuid := '91000000-0000-0000-0000-000000000401';
        v_r2 uuid := '91000000-0000-0000-0000-000000000402';
begin
  insert into public.operacoes_massa (id, org_id, acao, status, expira_em) values
    (v_r, v_org, 'reajustar', 'rascunho', now() + interval '30 minutes'),
    (v_r2, v_org, 'reajustar', 'executando', null);
  begin
    insert into public.operacoes_massa (org_id, acao, promocao_id, promocao_tipo) values (v_org, 'reajustar', 'P', 'DEAL');
    raise exception 'CHECK: reajustar com promoção aceito';
  exception when check_violation then null; end;
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, preco_anterior, codigo_pai)
    values (v_r, v_org, 'MLBR1', 'rascunho', 10.10, 10.00, 'PAI1');
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, codigo_pai) values (v_r2, v_org, 'MLBR1', 'conferindo', 'PAI1');
  begin
    insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status)
      values ('91000000-0000-0000-0000-000000000301', v_org, 'MLBR1', 'pendente');
    raise exception 'ÍNDICE: conferindo não reservou o MLB';
  exception when unique_violation then null; end;
  begin
    update public.operacoes_massa_itens set etapa = 'x' where operacao_id = v_r and ml_item_id = 'MLBR1';
    raise exception 'CHECK: etapa inválida aceita';
  exception when check_violation then null; end;
end; $$;
```
- [ ] **Step 2:** rodar → falha.
- [ ] **Step 3: migration**
```sql
-- ADR-0178 — reajuste de preço em massa: rascunho, conferindo, colunas do item.
alter table public.operacoes_massa drop constraint operacoes_massa_acao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_check
  check (acao in ('aderir','sair','pausar','reativar','reajustar'));
alter table public.operacoes_massa drop constraint operacoes_massa_acao_promocao_check;
alter table public.operacoes_massa add constraint operacoes_massa_acao_promocao_check check (
  (acao in ('aderir','sair') and promocao_id is not null and promocao_tipo is not null)
  or (acao in ('pausar','reativar','reajustar') and promocao_id is null and promocao_tipo is null));
alter table public.operacoes_massa drop constraint operacoes_massa_status_check;
alter table public.operacoes_massa add constraint operacoes_massa_status_check
  check (status in ('rascunho','executando','concluida'));
alter table public.operacoes_massa add column expira_em timestamptz;

alter table public.operacoes_massa_itens drop constraint operacoes_massa_itens_status_check;
alter table public.operacoes_massa_itens add constraint operacoes_massa_itens_status_check check (status in
  ('rascunho','pendente','enviando','conferindo','aplicado','ja_estava','mudou','bloqueado','erro','saida_solicitada'));
alter table public.operacoes_massa_itens
  add column preco_anterior numeric,
  add column etapa text check (etapa in ('escrita_pedida','ml_confirmado')),
  add column confirmado_sem_dado boolean not null default false,
  add column incluido boolean not null default true,
  add column avaliacao jsonb,
  add column estado_anterior jsonb,
  add column variacoes_ml jsonb,
  add column variacao_ids uuid[],
  add column codigo_pai text;

drop index public.operacoes_massa_itens_status_unico;
create unique index operacoes_massa_itens_status_unico on public.operacoes_massa_itens (org_id, ml_item_id)
  where promocao_id is null and status in ('pendente','enviando','conferindo');
create index operacoes_massa_itens_reajuste_ativo on public.operacoes_massa_itens (org_id, codigo_pai)
  where status in ('pendente','enviando','conferindo') and codigo_pai is not null;
```
- [ ] **Step 4:** SQL verde; `npm run db:check`.
- [ ] **Step 5:** tipos (database.types + backend/front unions acima); `pnpm exec tsc -b` 0 erros; `pnpm exec vitest run supabase/functions/_shared/operacoes src/lib src/components/operacoes` verde.
- [ ] **Step 6:** commit `feat(operacoes): schema do reajuste de preço em massa`.

---

### Task 2: RPCs de reserva, confirmação e persistência (opus)

**Files:** Create `supabase/migrations/<ts>_reajuste_preco_rpcs.sql`, `supabase/tests/reajuste_preco.sql`, `supabase/tests/reajuste_preco_concorrencia.sh`; Modify `src/lib/database.types.ts` (Functions).

**Produces** (todas `language plpgsql security definer set search_path = ''`; `revoke execute ... from public, anon, authenticated; grant execute ... to service_role`):
- `public.reajuste_codigo_pai(p_org uuid, p_ml_item text) returns text` — resolve o produto do MLB: `familias.codigo_pai where ml_item_id = p_ml_item` → senão `anuncios_externos.codigo_pai where item_externo_id = p_ml_item` → senão `anuncios_externos.codigo_pai` via `anuncios_externos_itens.item_externo_id = p_ml_item` (join `anuncio_externo_id`); null se não achar. Tudo com `org_id = p_org`.
- `public.reajuste_ativo_produto(p_org uuid, p_codigo_pai text) returns text` — `ml_item_id` de algum item de operação `reajustar` com `codigo_pai = p_codigo_pai` e `status in ('pendente','enviando','conferindo')`, ou null.
- `public.reajuste_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text) returns text` — `'ok' | 'ocupado' | <motivo>`.
- `public.reajuste_confirmar(p_org uuid, p_operacao uuid, p_confirmacoes jsonb) returns text` — `'ok' | 'ja_confirmada' | 'expirado' | 'nenhum' | 'confirmacao_faltando:<ml>' | 'ocupado:<ml>'`.
- `public.reajuste_persistir(p_org uuid, p_operacao uuid, p_ml_item text, p_preco_confirmado numeric, p_restaurar jsonb) returns text` — `'ok' | 'ja_aplicado' | 'conflito'`.
- `public.familia_reservar_publicacao(p_org uuid, p_familia_ids uuid[], p_operacao text) returns table(id uuid, lote_id uuid, user_id uuid, codigo_pai text, motivo text)`.
- `public.familia_reservar_migracao_pxv(p_org uuid, p_codigo_pai text, p_campos jsonb) returns text` — `'ok' | <motivo>`.
- `public.operacoes_massa_reivindicar` — REPLACE (mesma assinatura/retorno boolean).

Lógica (testar cada item):
- **Locks:** helper interno `perform pg_advisory_xact_lock(hashtextextended('rp:'||p_org||':'||codigo_pai,0))` para produto; `('rm:'||p_org||':'||ml_item)` para MLB. Ordem sempre produto → MLB. Famílias: `perform 1 from public.familias where org_id = p_org and codigo_pai = v_pai for update`.
- **`reajuste_reivindicar`:** `v_pai := reajuste_codigo_pai(p_org, p_ml_item)` (null → grava o item `bloqueado` 'Anúncio não encontrado nesta organização' se claimável e devolve o motivo); lock produto + famílias + MLB; `select * into v_it from operacoes_massa_itens where org_id=p_org and operacao_id=p_operacao and ml_item_id=p_ml_item for update`; claimável se `status='pendente'` ou (`status='conferindo'` e `proxima_conferencia <= now()`) ou (`status='enviando'` e `atualizado_em < now()-interval '2 minutes'`), senão `'ocupado'` (sem alterar). Se `v_it.etapa is null`: recusas — família do produto `status='publicando'` → `'Família em publicação/atualização — tente depois'`; `anuncios_externos.migracao_pxv_status in ('solicitada','em_andamento')` (canal `mercado_livre`) do produto → `'Migração para preço por variação em curso'`; item de operação `aderir`/`sair` do MLB em `pendente`/`enviando`/`saida_solicitada` → `'Anúncio em operação de promoção em andamento'`; Reverter (`origem_id`): para cada entrada de `v_it.estado_anterior` (`EntradaRestauracao[]`), a variação atual deve bater com `esperado` → senão `'Não revertível: o preço mudou depois do reajuste'`. **Recusa é gravada aqui, sob os locks** (o item claimável vira `mudou` se o motivo começa com 'Não revertível', senão `bloqueado`, com `mensagem` = motivo) e devolve o motivo; o wrapper do deps **não grava nada**. Claim: `update ... set status='enviando', codigo_pai = v_pai, atualizado_em=now()` (preserva `etapa`); `'ok'`.
- **`reajuste_variacoes_do_mlb(p_org uuid, p_codigo_pai text, p_ml_item text, p_ml_variation_ids text[]) returns table(ml_variation_id text, variacao_id uuid)`** — casamento das cores do MLB com o banco **por `ml_variation_id`** (fonte: variações vivas do ML lidas no preview), entre **todas** as famílias do produto: para cada id, a linha de `variacoes` com esse `ml_variation_id` cuja família tem o maior `publicado_em` (desempate `criado_em desc`, `id`). Plano (sem variações, `p_ml_variation_ids` vazio): a variação da família canônica do MLB (`familias.ml_item_id = p_ml_item` por `publicado_em desc`), exigindo exatamente 1 variação publicada; UP: `anuncios_externos_itens.variacao_id` do `item_externo_id = p_ml_item` (fallback `variacoes(familia_id, codigo = sku)`). Id sem casamento → linha com `variacao_id null` (o preview marca o MLB `fora` 'Não foi possível casar todas as variações do anúncio com o cadastro').
- **`reajuste_confirmar`:** `select * into v_op from operacoes_massa where org_id=p_org and id=p_operacao and acao='reajustar' for update`; `status='executando'` → `'ja_confirmada'`; `status<>'rascunho'` → `'nenhum'`; `expira_em < now()` → `'expirado'`. **Fase 1 (só leitura, nada escrito):** monta em memória a decisão de cada item `status='rascunho'` (`p_confirmacoes` = `[{ml_item_id, incluir, risco, sem_dado}]`; item ausente = mantém `incluido` do rascunho); incluído com `(avaliacao->>'tem_vermelho')::boolean` e sem `risco` → `return 'confirmacao_faltando:'||ml`; idem `tem_sem_dado`/`sem_dado`; nenhum incluído → `return 'nenhum'`. **Fase 2 (escrita):** percorre os itens **em ordem de `ml_item_id`** (evita deadlock entre rascunhos sobrepostos); incluídos → `incluido, confirmado_risco, confirmado_sem_dado, status='pendente'`; desmarcados → `status='bloqueado', mensagem='Desmarcado no preview'`; colisão de índice → `raise exception using errcode='P0001', message='ocupado:'||ml` **sem captura** (a transação inteira, inclusive a fase 2, é desfeita; a edge mapeia para 409). `update operacoes_massa set status='executando', expira_em=null`; `'ok'`.
- **`reajuste_persistir`:** lock produto (via `codigo_pai` do item) + MLB; item `for update`; `status='aplicado'` → `'ja_aplicado'`. `p_restaurar` = array de `{variacao_id, esperado:{preco_publicacao, preco_editado_pelo_operador}, novo:{preco_publicacao, preco_editado_pelo_operador}}`. **Completude:** o conjunto de `variacao_id` de `p_restaurar` tem de ser **igual** a `item.variacao_ids` (sem duplicatas, não vazio) — senão conflito. **Fase 1 (só leitura):** para cada entrada, `select preco_publicacao, preco_editado_pelo_operador into ... from variacoes where org_id=p_org and id=variacao_id for update`; `not found` ou `preco_publicacao is distinct from esperado` ou `editado is distinct from esperado` → marca conflito. Se conflito: `update item set status='erro', etapa=null, mensagem='Conflito: o preço de uma cor foi alterado por outro fluxo durante o reajuste — ML ficou com o preço novo; o próximo UPDATE publicará o valor do banco'` e `return 'conflito'` (**nenhuma variação alterada**). **Fase 2:** atualiza todas (`preco_publicacao=novo.preco_publicacao, preco_editado_pelo_operador=novo..., preco_publicado_ml=p_preco_confirmado`) e o item `status='aplicado', etapa=null, mensagem=null`; `'ok'`.
- **`familia_reservar_publicacao`:** para os `codigo_pai` distintos das famílias pedidas (ordem alfabética), lock produto; famílias do pedido `for update` com os filtros atuais (`operacao=p_operacao`, `status in ('pronto','erro')`, `ml_item_id is null` se CREATE / `not null` se UPDATE); para cada uma: `reajuste_ativo_produto(p_org, codigo_pai)` não nulo → devolve com `motivo = 'Há reajuste de preço em massa em andamento no anúncio '||ml` (sem alterar); senão `update status='publicando', erro_mensagem=null` e devolve com `motivo null`.
- **`familia_reservar_migracao_pxv`:** lock produto + famílias; reajuste ativo → motivo; senão `update public.anuncios_externos set` **todos** os campos de `p_campos` (exatamente os que `migrar-preco-por-variacao/index.ts:~115-127` grava hoje: `migracao_pxv_status='solicitada'`, `migracao_pxv_snapshot`, `ml_item_id_anterior`, etc. — ler o código e mapear chave a chave) `where org_id=p_org and canal='mercado_livre' and codigo_pai=p_codigo_pai and particao=0 and migracao_pxv_status is null` (mesmo filtro de canal de hoje — raízes de outro canal intocadas); 0 linhas → `'Migração já solicitada'`; `'ok'`.
- **`operacoes_massa_reivindicar` (replace):** lê `acao`; se `aderir`: lock MLB; item claimável pelo predicado atual? não → `return false` (sem alterar); claimável e `exists` item `reajustar` do MLB em `pendente/enviando/conferindo` → `update status='mudou', mensagem='Reajuste de preço em andamento neste anúncio'` e `return false`; senão claim como hoje. Demais ações: corpo atual, idêntico.

- [ ] **Step 1 — funcionais (vermelho)** `supabase/tests/reajuste_preco.sql` (begin…rollback; fixtures: org; família Legacy F1 `codigo_pai='PAI1'`, `ml_item_id='MLBX'`, 2 variações; operação `reajustar` executando com item `pendente` `codigo_pai='PAI1'`):
  (a) reivindicar `'ok'`→`enviando`; de novo `'ocupado'`. (b) F1 `publicando` → motivo, item intacto. (c) **família F2 nova do mesmo `codigo_pai`** em `publicando` → motivo. (d) `conferindo` futuro → `'ocupado'`; vencido → `'ok'` com `etapa` preservada; com `etapa` e F1 `publicando` → `'ok'` (retomada não recusa). (e) `familia_reservar_publicacao` de F2 (mesmo produto) com reajuste ativo → motivo, F2 continua `pronto`; sem reajuste → `publicando`. (f) PxV com reajuste ativo → motivo; sem → `'ok'` e campos gravados. (g) persistir ok → variações e item; de novo `'ja_aplicado'`; **conflito na segunda variação** → `'conflito'` e a **primeira variação inalterada**; variação inexistente no `p_restaurar` → `'conflito'`. (h) aderir: item `aderir` `pendente` + reajuste ativo → false e `mudou`; item `aderir` `enviando` recente + reajuste ativo → false e **status continua `enviando`**; sem reajuste → true; `pausar`/`sair` idênticos ao atual. (i) Reverter com variação editada → motivo. (j) `reajuste_confirmar`: falta `risco` num 🔴 incluído (sendo o **segundo** item) → `confirmacao_faltando:` e **nenhum item alterado**; `'nenhum'` idem sem alterações; expirado → `'expirado'`; ok → itens `pendente`/`bloqueado` e operação `executando`; repetir → `'ja_confirmada'`; colisão de índice → erro `P0001` `ocupado:<ml>` e **nada alterado** (operação continua `rascunho`). (k) persistir com `p_restaurar` **omitindo a segunda cor** → `'conflito'`, nada alterado; vazio → `'conflito'`; duplicata → `'conflito'`. (l) `reajuste_variacoes_do_mlb`: produto com 2 famílias (antiga com A/B, nova de reposição parcial só com A, ambas com `ml_variation_id`) → A da nova e B da antiga; id desconhecido → `variacao_id null`; plano → a variação única; UP → `variacao_id` do item. (m) PxV: produto com raiz ML e raiz de outro canal na partição 0 → só a ML recebe os campos. (n) item `enviando` recente de outro worker + família `publicando` → `'ocupado'` e status continua `enviando` (recusa só em item claimável).
- [ ] **Step 2 — concorrência (vermelho)** `reajuste_preco_concorrencia.sh` (modelo `worker_rodadas_concorrencia.sh`; cada variante com fixture própria; A segura 3 s; verificar resultado de B, tempo de espera ≥1 s **e estado final**):
  1. A `reajuste_reivindicar` × B `familia_reservar_publicacao` (F1) → B motivo; F1 `pronto`.
  2. A `familia_reservar_publicacao` (F1 vira publicando; **sem item de reajuste ainda pendente — o item é inserido em `pendente` só depois do commit de A**) × B `reajuste_reivindicar` → B motivo de publicação; item `pendente`.
  3. A `reajuste_reivindicar` × B `familia_reservar_publicacao` de **F2 recém-criada do mesmo produto** → B motivo.
  4. A `reajuste_reivindicar` × B `operacoes_massa_reivindicar` (aderir do MLB, pendente) → B false, item aderir `mudou`.
  5. A `operacoes_massa_reivindicar` (aderir claim → enviando) × B `reajuste_reivindicar` → B motivo de promoção.
  6. A `reajuste_reivindicar` × B `familia_reservar_migracao_pxv` → B motivo; A `familia_reservar_migracao_pxv` × B `reajuste_reivindicar` → B motivo PxV.
  7. Duas sessões `reajuste_reivindicar` no mesmo item `conferindo` vencido → uma `'ok'`, outra `'ocupado'`; idem `enviando` parado.
  8. Duas sessões `reajuste_confirmar` da mesma operação → uma `'ok'`, outra `'ja_confirmada'`.
  9. Dois rascunhos **diferentes** com os mesmos MLBs X/Y, confirmados ao mesmo tempo → sem deadlock (nenhum `40P01`): um `'ok'`, o outro `P0001 ocupado:`; estados finais coerentes.
  10. A `familia_reservar_publicacao` (segura 3 s) × B `reajuste_reivindicar` (recusa por publicação, grava `bloqueado`) × depois C `reajuste_reivindicar` de outro worker no mesmo item → C `'ocupado'`/não sobrescreve.
- [ ] **Step 3:** migration. **Step 4:** ambos verdes no Docker. **Step 5:** `database.types.ts` Functions; `tsc -b`. **Step 6:** commit `feat(operacoes): RPCs de reserva, confirmação e persistência do reajuste`.

---

### Task 3: Núcleo puro (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/{tipos,alvo,elegibilidade,decidir,avaliacao}.ts` + `__tests__/` de cada.

**Produces:**
```ts
// tipos.ts
export type TipoAjuste = 'pct' | 'reais';
export interface Ajuste { tipo: TipoAjuste; sentido: '+' | '-'; valor: number }
export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface CorAvaliada { variation_id: string | null; sku: string | null; custo: number | null; piso: number | null;
  origem: 'nacional' | 'importado' | null; aliquota_pct: number | null; comissao_pct: number | null; comissao_fixa: number | null;
  frete: number | null; liquido: number | null; semaforo: Semaforo; motivo: string | null }
export interface Avaliacao { cores: CorAvaliada[]; pior: Semaforo; tem_vermelho: boolean; tem_sem_dado: boolean }
export interface EstadoVariacao { preco_publicacao: number | null; preco_editado_pelo_operador: boolean }
export interface EntradaRestauracao { variacao_id: string; esperado: EstadoVariacao; novo: EstadoVariacao } // tipo ÚNICO usado no preview, executor e RPC
export type Etapa = 'escrita_pedida' | 'ml_confirmado' | null;
export interface VivoItem { preco: number | null; variacoes: { id: string; preco: number }[] | null; status: string;
  sub_status: string[]; catalog_listing: boolean; tem_relacoes: boolean }
// alvo.ts
export function centavos(v: number): number;   // half-up DECIMAL exato: via string `Math.abs(v).toFixed(6)` → inteiro*100 + 2 primeiras decimais + (3ª decimal ≥ 5 ? 1 : 0), com sinal. Casos: 10.075→1008, 1.005→101, 2.675→268, 19.999→2000
export function reais(c: number): number;      // c / 100
export function calcularAlvo(base: number, a: Ajuste): number | null; // ≤ 0 → null
export function semAlteracao(base: number, alvo: number): boolean;
// elegibilidade.ts
export interface FatosElegibilidade { vivo: VivoItem; ehKit: boolean; temAtacado: boolean;
  promocaoBanco: boolean;            // ml_promocao_itens pending/started
  promocaoML: boolean | null;        // leitura fresca (null = inconclusiva)
  familiaPublicando: boolean; migracaoPxv: boolean }
export function motivoInelegivel(f: FatosElegibilidade): string | null;
// decidir.ts
export type Vivo = { kind: 'ok'; preco: number; todasIguais: boolean; composicao: string[] | null } | { kind: 'falhou' };
export type DecisaoReajuste = { tipo: 'persistir' } | { tipo: 'escrever' } | { tipo: 'voltar_pendente' }
  | { tipo: 'fim'; status: 'mudou' | 'erro' | 'conferindo'; mensagem: string };
export function decidirReajuste(etapa: Etapa, alvo: number, anterior: number, vivo: Vivo, composicaoEsperada: string[] | null): DecisaoReajuste;
// avaliacao.ts
export function resumir(cores: CorAvaliada[]): Avaliacao;
export function mudouAvaliacao(antes: Avaliacao, agora: Avaliacao): boolean;
```
Regras/casos (um teste por linha):
- `calcularAlvo` só em inteiros: `c = centavos(base)`; `bp = centavos(valor)` (pontos-base do %, 2 casas); pct: `q = c * (10000 + s*bp)` (inteiro) e `cent = Math.floor((2*q + 10000) / 20000)` (half-up exato para q ≥ 0); reais: `c + s*centavos(valor)`; `≤ 0 → null`; retorna `reais(cent)`. Casos: 100,00 +1% → 101,00; 19,99 +10% → 21,99; 10,05 −5% → 9,55; 0,50 −R$1 → null; 33,33 +0% → 33,33 e `semAlteracao` true; 49,90 +R$0,10 → 50,00; 10,075 (base) → centavos 1008.
- `motivoInelegivel` (ordem): `vivo.status` ∉ {active, paused} ou `sub_status` ∩ {forbidden, waiting_for_patch, poor_quality_thumbnail, poor_quality_picture} → `'Anúncio moderado, encerrado ou inativo'`; `ehKit` → `'Kit Virtual não entra no reajuste'`; `catalog_listing || tem_relacoes` → `'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste'`; `temAtacado` → `'Anúncio com preço de atacado fica fora do reajuste'`; `promocaoBanco || promocaoML === true` → `'Participando de promoção'`; `promocaoML === null` → `'Não foi possível conferir promoções — tente de novo'`; `familiaPublicando` → `'Família em publicação/atualização'`; `migracaoPxv` → `'Migração para preço por variação em curso'`.
- `decidirReajuste` (centavos): `ml_confirmado` → persistir. `escrita_pedida`: falhou → `fim conferindo 'Aguardando confirmação do ML'`; composição ≠ esperada → `fim erro 'Variações do anúncio mudaram durante o reajuste'`; todasIguais e =alvo → persistir; todasIguais e =anterior → voltar_pendente; senão `fim erro 'Preço alterado por terceiros durante o reajuste'`. `null`: falhou → `fim erro 'Não foi possível ler o anúncio'`; composição ≠ → `fim mudou 'Variações do anúncio mudaram — refaça o preview'`; `!todasIguais || ≠ anterior` → `fim mudou 'O preço mudou desde o preview'`; senão escrever.
- `resumir`: `tem_vermelho` = alguma cor vermelha; `tem_sem_dado` = alguma indisponivel; `pior` por gravidade vermelho > indisponivel > amarelo > verde.
- `mudouAvaliacao`: chave por cor `variation_id ?? sku`; conjuntos de chaves diferentes → true; por cor, `custo, piso, aliquota_pct, comissao_pct, comissao_fixa, frete` comparados em centavos (null≠número), `origem` igual → senão true.
- [ ] TDD por arquivo; `pnpm exec vitest run supabase/functions/_shared/operacoes/reajuste`; commit `feat(operacoes): núcleo puro do reajuste`.

---

### Task 4: Cliente ML do reajuste (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/ml.ts` + teste.

**Produces:**
```ts
export type ResultadoPut = { kind: 'ok' } | { kind: 'sem_escrita'; status: number; mensagem: string } | { kind: 'desconhecido'; mensagem: string };
export interface ClienteReajusteML {
  lerVivo(itemId: string): Promise<VivoItem>;                       // lança SemAcessoStatusML em 401/403 (HTTP ou envelope); Error nos demais
  putPreco(itemId: string, alvo: number, variacaoIds: string[] | null): Promise<ResultadoPut>; // lança só SemAcessoStatusML
  participaPromocaoML(itemId: string): Promise<boolean | null>;     // null = inconclusivo
}
export function criarClienteReajusteML(token: string, f?: typeof fetch): ClienteReajusteML;
```
- `lerVivo`: `caminhoMultiget([id], 'id,price,status,sub_status,variations,catalog_listing,item_relations')`; envelope 401/403 → `SemAcessoStatusML`; 404/sem body → `Error('ML não devolveu o anúncio')`; `variacoes` = `[{id: String(v.id), preco: Number(v.price)}]` ou null se vazio.
- `putPreco`: Legacy body `{variations: ids.map(id => ({id: Number(id), price: alvo}))}`; plano/UP `{price: alvo}`; timeout 15 s (`AbortController`). 200/201 → ok; 401/403 → lança; 4xx (inclui 429) com resposta → `sem_escrita` (`status`, `message` do corpo); 5xx, abort, `fetch` lançando → `desconhecido`.
- `participaPromocaoML`: `GET /seller-promotions/items/{id}?app_version=v2` — 200 com lista: alguma `pending/started` → true; para cada `candidate`: `GET /seller-promotions/promotions/{pid}/items?promotion_type={type}&item_id={id}&app_version=v2` → `results[0].status` `pending/started` → true; falha nessa leitura → null; nenhuma → false. **Qualquer não-200 na visão por item (inclui 404) → null** (inconclusivo, a elegibilidade bloqueia).
- Testes com fetch mock (URLs e bodies exatos, cada ramo).
- [ ] TDD; commit `feat(operacoes): cliente ML do reajuste`.

---

### Task 5: Preview no servidor (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/preview.ts` + teste. Modify `supabase/functions/_shared/promocoes/deps.ts`: `criarTarifaEm(cx, opts?: { fresco?: boolean })` — `fresco` ignora a **leitura** do cache (continua gravando); default inalterado (promoções intactas; teste novo cobre `fresco`).

**Produces:**
```ts
export interface PedidoPreview { familias: string[]; ml_item_ids: string[]; ajuste: Ajuste | null; precos?: Record<string, number>; origem_id?: string | null }
export interface AlvoExpandido { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; variacoes_ml_esperadas: string[] | null;
  sku: string | null; titulo: string | null; ehKit: boolean; temAtacado: boolean; promocaoBanco: boolean; familiaPublicando: boolean; migracaoPxv: boolean }
export interface ItemPreview { ml_item_id: string; codigo_pai: string; variacao_ids: string[]; titulo: string | null; sku: string | null;
  preco_anterior: number; preco: number; avaliacao: Avaliacao | null; restaurar: EntradaRestauracao[] | null; variacoes_ml: string[] | null;
  situacao: 'elegivel' | 'fora' | 'sem_alteracao'; motivo: string | null; incluido: boolean; aviso: string | null }
// `restaurar` é o ÚNICO formato de estado: gravado na coluna `estado_anterior` (Task 7), lido pelo executor e enviado à RPC.
export interface DepsPreview {
  expandir(familias: string[], mlItemIds: string[]): Promise<AlvoExpandido[]>;   // MLBs + produto + flags (sem variações)
  variacoesDoMlb(codigoPai: string, mlItem: string, mlVariationIds: string[]): Promise<{ ml_variation_id: string; variacao_id: string | null }[]>; // RPC reajuste_variacoes_do_mlb
  estadoVariacoes(variacaoIds: string[]): Promise<Map<string, EstadoVariacao>>;
  ml: ClienteReajusteML;
  avaliar(mlItemId: string, preco: number): Promise<Avaliacao>;
  origem(origemId: string): Promise<Map<string, { preco_anterior: number; preco: number; restaurar: EntradaRestauracao[] }> | null>; // só itens aplicado
}
export const MAX_MLBS = 500;
export async function montarPreview(p: PedidoPreview, deps: DepsPreview): Promise<{ ok: true; itens: ItemPreview[]; executaveis: number } | { ok: false; erro: string }>;
```
Regras:
- **Expansão de MLBs** (deps da Task 7): Legacy partição 0 = `familias.ml_item_id = X`; partição > 0 = `anuncios_externos.item_externo_id = X`; UP = `anuncios_externos_itens` não retirados (família selecionada → todos os SKUs). Dedup por MLB; `> 500` → `{ok:false, erro:'No máximo 500 anúncios por operação (a seleção expandiu para N).'}`.
- **Variações do MLB** (`variacao_ids`) vêm **depois** do `lerVivo`: `variacoesDoMlb(codigo_pai, ml, ids de variação vivos)` (RPC da Task 2, casamento por `ml_variation_id` entre todas as famílias do produto — cobre partições e reposição parcial). Alguma sem `variacao_id` → `fora` 'Não foi possível casar todas as variações do anúncio com o cadastro'.
- Por MLB (paralelismo 5): `lerVivo`; Legacy exige `todasIguais` (senão `fora` 'Variações com preços diferentes no ML'); `participaPromocaoML`; `motivoInelegivel` → `fora`; alvo = `precos[ml]` normalizado ?? `calcularAlvo(base, ajuste)`; null → `fora` 'Preço resultante inválido'; `semAlteracao` → `sem_alteracao`; senão `avaliar(ml, alvo)`, `estado_anterior` (das `variacao_ids`, ordem fixa), `incluido = !(tem_vermelho || tem_sem_dado)` (D7: 🔴/⚪ desmarcados), aviso `🟡` se `pior==='amarelo'`.
- **Reverter** (`origem_id`): ignora `ajuste`/`precos`; MLBs = itens `aplicado` da origem; alvo = `preco_anterior` da origem; vivo ≠ `preco` da origem → `fora` 'Não revertível: o preço mudou depois do reajuste'; **banco**: `estadoVariacoes` ≠ `{preco_publicacao: origem.preco, editado: true}` em alguma variação → `fora` 'Não revertível: o preço foi editado depois do reajuste'; `aviso` com D10 ("o preço restaurado volta a divergir do banco/ML se já divergia; cores com marca desligada voltam a ser recalculadas no re-ingest"); `restaurar` vem da origem (`esperado` = estado gravado pela origem, `novo` = estado anterior da origem).
- `executaveis` = elegíveis; 0 → a Task 7 **não grava operação** (C4).
- Testes: > 500; cada motivo `fora` (inclui `promocaoBanco` true com ML false); sem alteração; preço editado sobrescreve; Legacy divergente; partição > 0 só com suas variações; 🔴/⚪ `incluido=false`; reverter (aplicado / ML mudou / banco mudou / aviso); `criarTarifaEm` `fresco` não lê cache.
- [ ] TDD; commit `feat(operacoes): preview do reajuste`.

---

### Task 6: Handler `reajustar` e ajuste mínimo do laço (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/executar.ts` + teste; Modify `supabase/functions/_shared/operacoes/laco.ts` (uma linha: o caminho `fatal.encerrar` termina com `return finalizar(operacaoId, deps, processados)` em vez de `deps.concluir()` direto — `finalizar` conclui quando não há `enviando` nem itens a conferir; os testes de status existentes continuam verdes porque `itensAConferir` deles devolve `[]`).

**Produces:**
```ts
export interface OperacaoReajusteRow { id: string; org_id: string; origem_id: string | null }
export interface ItemReajuste { ml_item_id: string; status: StatusItem; preco: number; preco_anterior: number; etapa: Etapa;
  conferencias: number; avaliacao: Avaliacao; restaurar: EntradaRestauracao[]; variacoes_ml: string[] | null;
  confirmado_risco: boolean; confirmado_sem_dado: boolean; codigo_pai: string; variacao_ids: string[] }
export interface DepsReajuste extends DepsLaco {
  ml: ClienteReajusteML;
  lerItem(operacaoId: string, mlItemId: string): Promise<ItemReajuste>;   // re-leitura APÓS o claim (etapa atual)
  avaliarFresco(mlItemId: string, preco: number): Promise<Avaliacao>;     // tarifa fresca (C1)
  fatos(item: ItemReajuste): Promise<{ ehKit: boolean; temAtacado: boolean; promocaoBanco: boolean; familiaPublicando: boolean; migracaoPxv: boolean }>;
  persistir(operacaoId: string, mlItemId: string, precoConfirmado: number, restaurar: EntradaRestauracao[]): Promise<'ok' | 'conflito' | 'ja_aplicado'>;
  agendarConferenciaItem(operacaoId: string, mlItemId: string, conferencias: number): Promise<void>;
  encerrarSemEtapa(operacaoId: string, mensagem: string): Promise<void>; // pendente/enviando SEM etapa → erro; com etapa → conferindo (agendado)
}
export function executarReajuste(op: OperacaoReajusteRow, deps: DepsReajuste, opts: { limiteMs: number; lote: number; maxItens?: number }): Promise<{ processados: number; continuou: boolean }>;
```
- **Claim único:** `DepsReajuste.itensPendentes` (consulta pendente + conferindo vencido + enviando parado) e `DepsReajuste.reivindicar` (wrapper de `reajuste_reivindicar`: `'ok'` → true; `'ocupado'` ou motivo → false — **o wrapper não grava nada**; a recusa já foi gravada pela RPC sob os locks). O laço chama esses dois; o `processar` faz `deps.lerItem` para pegar a `etapa` atual.
- `restaurar` do item: envio normal → `variacao_ids` × `estado_anterior` (`esperado` = estado do preview, `novo` = `{preco_publicacao: preco, editado: true}`); Reverter → `restaurar` da origem (gravado no preview). Persistido no item como `estado_anterior` = `EntradaRestauracao[]` (formato único).
- **Regra de recuperação (C3):** depois do claim, **qualquer** exceção não fatal num item que tem (ou pode ter) escrita — falha em `lerItem`, em `gravarItem`, em `agendarConferenciaItem`, em `persistir`, em `lerVivo` de conferência — é relançada como `FalhaPosEscrita` (o laço relança → 500 → QStash reentrega; o item fica `enviando` e é retomado como "enviando parado"). Só falhas de um item **sem etapa e antes do PUT** podem virar `erro`. O mesmo vale dentro do caminho fatal: se `agendarConferenciaItem` falhar, relança `FalhaPosEscrita`.
- Fluxo (recuperação antes de travas): (1) `ml_confirmado` → `persistir` (erro de banco → `FalhaPosEscrita`). (2) `escrita_pedida` → `lerVivo` (falha → `agendarConferenciaItem`) → `decidirReajuste` (sem elegibilidade) → persistir / `gravarItem({status:'pendente', etapa:null})` / fim (`conferindo` via `agendarConferenciaItem`). (3) sem etapa → `lerVivo` (falha → retentável: `conferencias+1 < 3` → `gravarItem({status:'pendente', conferencias+1, mensagem})`, senão `erro`) → `participaPromocaoML` + `fatos` → `motivoInelegivel` → `bloqueado`; `decidirReajuste` → `mudou`; `avaliarFresco` + `mudouAvaliacao` → `mudou 'Dados financeiros mudaram desde o preview — refaça o preview'`; defesa C5 (`tem_vermelho && !confirmado_risco` etc.) → `mudou`. (4) `gravarPos(gravarItem({etapa:'escrita_pedida'}))` → `putPreco`: `sem_escrita` 429 → retentável (volta `pendente`, `etapa:null`, até 3) / demais → `erro` mensagem do ML (`etapa:null`); `desconhecido` → `agendarConferenciaItem`; `ok` → `lerVivo` (falha → `agendarConferenciaItem`) → todas = alvo → `gravarPos(gravarItem({etapa:'ml_confirmado'}))` → `persistir`; senão `erro 'Preço não aplicado pelo ML'` (`etapa:null`).
- Fatal (`SemAcessoStatusML`): `Fatal{ eh, mensagem: MSG_RECONECTAR, encerrar: (m) => deps.encerrarSemEtapa(op.id, m) }` — o item atual, se tinha etapa, **não** vira erro: o `processar` captura `SemAcessoStatusML` quando a etapa está preenchida e chama `agendarConferenciaItem` antes de relançar (o laço só grava `erro` no item atual quando não há etapa: implementar o processar para gravar o estado correto e relançar um `SemAcessoStatusML` marcado `{jaGravado:true}`; adaptar a linha do laço que grava o item atual no fatal para pular quando `e.jaGravado`).
- Testes **usando o `laco` real** (deps falsos): sucesso Legacy/plano/UP; 400 → erro; 429×3; desconhecido → conferindo e operação **não conclui** (agenda); conferência alvo → aplicado mesmo com `participaPromocaoML` lançando/null; conferência anterior → pendente sem etapa; terceiros → erro; Legacy com 1 variação divergente → não confirma; conflito; banco falha após `ml_confirmado` → item continua `enviando` com etapa e a chamada relança; **`agendarConferenciaItem` falha após PUT desconhecido → relança, item `enviando` com etapa (não `erro`)**; **`lerItem` falha numa retomada com etapa → relança**; **fatal com mix**: item sem etapa → erro, item com etapa → conferindo, operação não conclui; **fatal com agendamento falhando → relança**; Reverter (restaurar da origem); tarifa mudou → mudou. E: suíte `executar-status.test.ts` e demais antigas verdes.
- [ ] TDD; `pnpm lint:functions && pnpm check:functions`; commit `feat(operacoes): handler de reajuste de preço`.

---

### Task 7: Fiação na edge `operacoes-massa` (opus)

**Files:** Modify `supabase/functions/operacoes-massa/index.ts`; Create `supabase/functions/_shared/operacoes/reajuste/deps.ts`.

- `POST {etapa:'preview', acao:'reajustar', familias, ml_item_ids, ajuste, precos?, origem_id?}` (membro; `requireUserOrg` write): Reverter exige admin/suporte full e origem `reajustar` da org; apaga rascunhos expirados da org; `montarPreview`; `executaveis === 0` → `200 {operacao_id: null, itens}` **sem gravar**; senão grava operação `rascunho` (`expira_em = now()+30 min`, `origem_id`, `criado_por`) e itens (`status`: elegível → `rascunho`; fora → `bloqueado`; sem alteração → `ja_estava`; demais colunas da Task 1; `estado_anterior` = `EntradaRestauracao[]`; `semaforo = avaliacao.pior`) → `201 {operacao_id, itens, expira_em}`.
- `POST {etapa:'confirmar', operacao_id, confirmacoes}` (admin/suporte full; auditoria): `reajuste_confirmar` → `'ok'`/`'ja_confirmada'` → publica QStash `executar` com `deduplicationId: dedup('executar_'+op+'_0')` (repetir é seguro: dedup) → `200`; `'expirado'` → 400 "O preview expirou — gere de novo"; `confirmacao_faltando:<ml>` → 400 com `itens:[{ml_item_id, motivo:'Confirme o risco deste anúncio'}]`; `'nenhum'` → 400; erro `P0001` `ocupado:<ml>` → 409. Falha ao publicar → **não** chamar `encerrarComErro` (sem escrita ainda, mas a operação já está `executando`): responder 500 "Tente confirmar de novo" — o retry recebe `ja_confirmada` e republica (dedup).
- QStash `reajustar` (executar/conferir): extrair para `_shared/operacoes/reajuste/etapa.ts` a função `etapaReajuste(op, deps: { conexao(): Promise<Cx | null>; encerrarSemEtapa; agendarOuConcluir; executar })` (testável): `invalid_grant` → `encerrarSemEtapa(MSG_RECONECTAR)` + `agendarOuConcluir` dos itens `conferindo` — **nunca** `encerrarComErro`; sem conexão → idem com `MSG_SEM_CONEXAO`; demais erros relançam (500); senão `executarReajuste`. **Testes** dessa função: `invalid_grant` com 1 item sem etapa e 1 com etapa → o primeiro `erro`, o segundo `conferindo`, operação não concluída e conferência agendada; sem conexão idem; erro transitório relança. O `index.ts` só delega.
- `depsReajuste` (service role, `org_id` sempre): `itensPendentes` (pendente ∪ conferindo vencido ∪ enviando parado), `reivindicar` (RPC + gravação do motivo), `lerItem`, `itensAConferir` (conferindo com `proxima_conferencia`), `agendarConferenciaItem` (5/10/20/40/60 min), `persistir` (RPC), `encerrarSemEtapa`, `avaliarFresco` (`carregarCadastro`/`lerAliquotas` uma vez; `buscarItensML`; `projetarItem` com item sintético como `criarSemaforoExato`; `criarTarifaEm(cx, {fresco:true})`; mapeia `LinhaItem.projecao` → `CorAvaliada` e `resumir`), `fatos`, `expandir`/`estadoVariacoes`/`origem` do preview (regras da Task 5).
- `pnpm lint:functions && pnpm check:functions`; vitest `_shared/operacoes`. Commit `feat(operacoes-massa): preview, confirmar e executar reajuste`.

---

### Task 8: Barreiras nos outros escritores (opus)

**Files:** Modify `supabase/functions/ingest-lote/index.ts` (herança da marca), `supabase/functions/publicar-familias/index.ts` (claims CREATE/UPDATE → `familia_reservar_publicacao`), `supabase/functions/update-familia-ml/processar.ts` (guard ao lado do PxV ~151: `reajuste_ativo_produto(org, codigo_pai)` não nulo → `Error('Há reajuste de preço em massa em andamento neste produto (400)')` com `status=400`), `supabase/functions/migrar-preco-por-variacao/index.ts` (escrita de `solicitada` → `familia_reservar_migracao_pxv` com **todos** os campos atuais em `p_campos`; a porta que hoje devolve boolean passa a devolver o motivo textual, exibido ao operador); o hook do front que dispara a publicação exibe `recusadas` (toast).
- `publicar-familias`: duas chamadas RPC (CREATE, UPDATE); `recusadas: [{familia_id, motivo}]` na resposta; todas recusadas → 409 com a mensagem; resto idêntico (o que segue para fila/split recebe as mesmas colunas `id, lote_id, user_id, codigo_pai`).
- **Durabilidade no re-ingest (D1):** `supabase/functions/ingest-lote/index.ts` (~150, 167–174, 324–338) copia o preço das variações existentes no UPDATE mas não a marca: passar a ler e herdar `preco_editado_pelo_operador` pelo mesmo casamento e gravá-la no INSERT das variações herdadas; `process-familia` (~456–462) já respeita a marca. Teste: variação reajustada (marca true, preço X) → novo lote com essa cor + cor nova → após ingest+process, a cor reajustada mantém X e a marca; a nova é calculada normalmente.
- Testes (seguir os `__tests__` desses módulos; se a lógica estiver no `index.ts`, extrair a decisão para função pura testável): recusa com reajuste ativo; comportamento idêntico sem reajuste; PxV grava os mesmos campos de antes (snapshot) e devolve motivo textual; herança da marca no re-ingest.
- Commit `feat(publicacao): barreiras atômicas contra reajuste e herança da marca no re-ingest`.

---

### Task 9: Front — lib e hooks (opus)

**Files:** Create `src/lib/reajuste.ts` (+ teste); Modify `src/hooks/useOperacoes.ts` (+ teste), `src/lib/operacoes.ts`.
- `src/lib/reajuste.ts` re-exporta `calcularAlvo`, `semAlteracao`, `centavos`, `reais` de `../../supabase/functions/_shared/operacoes/reajuste/alvo.ts`; `formatarAjuste(a)`.
- `src/lib/operacoes.ts`: `AcaoOperacao` + `'reajustar'`; `inversa` overload `inversa(a:'reajustar'): 'reajustar'` (Reverter de reajuste é reajuste com origem); `tituloOperacao` → `'Reajustar preço de N anúncios'` / com `origem_id` `'Reverter reajuste de N anúncios'`; `itensRevertiveis('reajustar', …)` = só `aplicado`.
- `useOperacoes`: query exclui `status='rascunho'` (`.neq('status','rascunho')`) antes do limit; conclusão de `reajustar` invalida `QK.statusPublicados` e as queries de Publicados (`QK.publicados` ou equivalente).
- Hooks: `usePreviewReajuste()` (mutation `{etapa:'preview', acao:'reajustar', ...}` → `{operacao_id|null, itens, expira_em}`), `useConfirmarReajuste()` (mutation `{etapa:'confirmar', ...}`; trata 400/409 com `ErroOperacao.itens`; invalida `QK_OPERACOES`).
- Testes: título, revertíveis, inversa, filtro de rascunho, paridade (`calcularAlvo` do front = do backend em 20 casos).
- Commit `feat(front): lib e hooks do reajuste`.

---

### Task 10: Front — diálogo, preview, Publicados e Operações (opus)

**Files:** Create `src/components/operacoes/dialog-reajuste.tsx`, `src/components/operacoes/preview-reajuste.tsx` (+ testes); Modify `src/components/operacoes/barra-selecao-publicados.tsx` (prop `onReajustar`; botão `Reajustar preço (N)`; N = selecionáveis ativos+pausados), `src/pages/Publicados.tsx`, `src/components/operacoes/lista-operacoes.tsx`.
- Diálogo: Aumentar/Diminuir, %/R$, valor (aceita vírgula) → "Ver preview" (`familias` = `familiaId` das linhas UP; `ml_item_ids` = demais).
- Preview: por MLB (UP: por SKU) — título/SKU, atual → novo (input; editar chama preview de novo com `precos` → **novo rascunho, confirmações zeradas**), líquido/markup da pior cor, semáforo, expandir cores; seções "Fora do lote" (motivo) e "Sem alteração"; checkbox incluir por item (🔴/⚪ vêm desmarcados); confirmações separadas "Assumo o prejuízo nos itens 🔴 incluídos" e "Assumo os itens ⚪ sem cálculo incluídos" (só aparecem se houver incluídos dessas cores); avisos D1 (fixação) e 🟡; contador até `expira_em`; `operacao_id: null` → mensagem "Nenhum anúncio muda de preço"; botão "Reajustar N anúncios" (admin/suporte full) ou "Só administradores executam."; erros com recusas por item.
- Lista de operações: título por `tituloOperacao`; Reverter de `reajustar` disponível para itens `aplicado` **mesmo com a operação ainda executando** (itens `conferindo` não impedem) → abre o preview com `origem_id`; `conferindo` aparece como não terminal.
- Testes: cálculo exibido = `calcularAlvo`; 🔴/⚪ desmarcados; confirmar exige as duas confirmações quando aplicável; **confirmou → editou preço → confirmações zeradas**; membro não executa; nenhum muda → sem operação; Reverter com operação executando.
- Commit `feat(front): reajuste de preço na tela Publicados`.

---

### Task 11: Docs (sonnet)

`docs-update-checklist` (TASKS, edge-functions: operacoes-massa preview/confirmar/reajustar, publicar-familias `recusadas`, migrar-preco-por-variacao; modelo-de-dados: colunas/status/RPCs; glossário: rascunho, conferindo, reajuste; obsidian). ADR-0178 → "Aceito" + Implementação. `pnpm docs:links`. Commit.

---

### Task 12: Portão, revisão final, deploy e validação (controlador)

1. `pnpm preflight` verde; `supabase/tests/reajuste_preco.sql`, `operacoes_massa.sql` e `reajuste_preco_concorrencia.sh` verdes no Docker.
2. Revisão final Grok 4.7 xhigh (rodada única) → correções → testes → CI verde.
3. **Ordem de produção (barreiras antes do reajuste):** `supabase db push` (2 migrations) → conferir funções/constraints → deploy `ingest-lote`, `publicar-familias`, `update-familia-ml`, `migrar-preco-por-variacao` (e qualquer edge que importe `_shared/promocoes/deps.ts` alterado — `grep -rl "promocoes/deps" supabase/functions` — e redeploy delas) → deploy `operacoes-massa` → conferir versões → merge fast-forward na main (front via Render).
4. Validação de campo na DSA pelo app (Playwright isolado; magic link admin DSA; logout global no fim): registrar org/`org_id`/MLBs/preço anterior e alvo; 2–3 MLBs elegíveis (Legacy com variações, plano, UP se houver); +1% → `/operacoes` → GET no ML + SQL (`preco_publicacao`, `preco_editado_pelo_operador`, `preco_publicado_ml`) → Reverter → GET + SQL restaurados; prints 1440/360 (diálogo, preview, operações, Publicados). Avil e promoções intocadas.
5. Docs "em produção", limpeza, relatório com rulings.
