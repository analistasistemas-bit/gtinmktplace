# Reajuste de preço em massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reajustar (±% / ±R$) o preço de N anúncios do ML a partir da tela Publicados, durável no banco, com trava financeira, serialização atômica com os outros escritores de preço, recuperação de envio incerto e Reverter — 3º tipo do motor de operações em massa.

**Architecture:** Preview calculado no servidor e gravado como operação `rascunho`; `confirmar` publica a execução no QStash; handler `reajustar` no laço comum (`_shared/operacoes/laco.ts`) com claim próprio (`reajuste_reivindicar`, RPC com lock de família + advisory lock por MLB). Escrita só-preço no ML (Legacy `{variations:[{id,price}]}`, plano/UP `{price}`), confirmação por GET, persistência atômica no banco (`reajuste_persistir`). Publicação/UPDATE, adesão a promoção e entrada em PxV passam a reservar via RPCs que recusam MLB/família com reajuste ativo.

**Tech Stack:** Supabase Postgres (RPCs plpgsql security definer), Edge Functions Deno, QStash, React + TanStack Query, vitest + Testing Library, testes SQL em Postgres local (Docker) ou receita de produção em transação desfeita.

**Spec:** `docs/superpowers/specs/2026-10-04-reajuste-preco-em-massa-design.md` (aprovada pelo GPT-6 Astra como representante do Diego) · **ADR:** `docs/decisions/0178-reajuste-de-preco-em-massa.md`. Leia os contratos **C1–C5** da spec antes de qualquer task.

## Global Constraints

- Roteamento (CLAUDE.md): **opus** em migration, RPC, handler, trava/margem, fiação de edge, C2 nos fluxos de publicação/PxV/promoção, e no preview (calcula margem). **sonnet** só em UI sem cálculo e docs. Revisão de diff por task: **Grok 4.7 xhigh** via `cursor-agent` (nunca revisor Claude).
- Migrations só `supabase migration new` + `supabase db push` (ADR-0043); `db push` só na Task 12, depois do merge aprovado. Antes de DROP CONSTRAINT/REPLACE FUNCTION, ler o nome/definição real no banco.
- `pnpm test` exige `.env.test`; dev exige `.env.local` (já copiados no worktree). Rodar teste focado com `pnpm exec vitest run <path>` (o `pnpm test -- <path>` ignora o filtro). **Duas árvores de teste:** `src/**/__tests__` e `tests/` — rodar ambas antes de declarar pronto.
- Git: `/usr/bin/git` com comandos simples; commit `-F <arquivo>` em `/Users/diego/.claude/jobs/628d3bf1/tmp/` (nome único); mensagem termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push nas tasks.
- Toda query service role filtra `org_id`. Permissão de criar rascunho: membro; `confirmar` e Reverter: `ctx.isAdmin || ctx.support?.scope === 'full'` (servidor).
- Valores monetários: centavos inteiros, half-up, calculados por **uma** função pura (`_shared/operacoes/reajuste/alvo.ts`) importada também pelo front (o front já importa de `supabase/functions/_shared/`, ex.: `src/lib/custos.ts`).
- **Origem ausente → ⚪** (já é o comportamento de `cadastro.ts:56`; não alterar). Nunca default nacional.
- Não-regressão: arquivos de teste existentes de `_shared/operacoes/__tests__/` não podem ser editados; suítes de promoção e de pausar/reativar intactas.
- Nada de escrita direta no ML fora do fluxo do app (testes usam mocks; campo só pelo app, Task 12).
- Teto: 500 MLBs únicos por operação (servidor rejeita, sem truncar); 100 itens por mensagem QStash.

## Review Focus

1. **Corrida reajuste × publicação/UPDATE** (mesma família em segundos) → uma das duas recusa com mensagem clara; nunca as duas escrevem. → teste concorrente SQL na Task 2.
2. **PUT aplicado com resposta perdida + consulta de promoção falhando** → o item termina `aplicado` (conferência sem elegibilidade). → Task 6.
3. **Legacy com variação cujo preço não mudou no ML** (todas devem ter o alvo) → não conta como confirmado. → Task 4 e 6.
4. **Rascunho expirado ou confirmação para semáforo diferente do gravado** → recusa no `confirmar`. → Task 7.
5. **Reverter com edição local concorrente** → `reajuste_reivindicar` recusa antes do PUT; `reajuste_persistir` devolve `conflito`. → Tasks 2 e 6.

---

### Task 1: Migration de schema (opus)

**Files:**
- Create: `supabase/migrations/<ts>_reajuste_preco_schema.sql` (via `supabase migration new reajuste_preco_schema`)
- Modify: `supabase/tests/operacoes_massa.sql` (bloco novo no fim, antes do `rollback`)
- Modify: `src/lib/database.types.ts` (novas colunas/valores)

**Interfaces — Produces:**
- `operacoes_massa.acao` ∈ {aderir, sair, pausar, reajustar, reativar}; `status` ∈ {rascunho, executando, concluida}; `expira_em timestamptz null`.
- `operacoes_massa_itens.status` ∈ {rascunho, pendente, enviando, conferindo, aplicado, ja_estava, mudou, bloqueado, erro, saida_solicitada}; colunas `preco_anterior numeric`, `etapa text` (`escrita_pedida`|`ml_confirmado`|null), `confirmado_sem_dado boolean not null default false`, `incluido boolean not null default true`, `avaliacao jsonb`, `estado_anterior jsonb`, `variacoes_ml jsonb`, `familia_ids uuid[]` (famílias do MLB, gravadas no preview — usadas pelo lock).
- Índice `operacoes_massa_itens_status_unico` recriado: `(org_id, ml_item_id) where promocao_id is null and status in ('pendente','enviando','conferindo')`.

- [ ] **Step 1: Teste SQL (vermelho)** — acrescentar a `supabase/tests/operacoes_massa.sql`:

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

  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status, preco, preco_anterior, etapa)
    values (v_r, v_org, 'MLBR1', 'rascunho', 10.10, 10.00, null);
  -- rascunho não reserva: o mesmo MLB pode estar pendente noutra operação
  insert into public.operacoes_massa_itens (operacao_id, org_id, ml_item_id, status) values (v_r2, v_org, 'MLBR1', 'conferindo');
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
(`...0301` é a operação `pausar` criada pelo bloco anterior do arquivo; conferir o id real no arquivo.)

- [ ] **Step 2:** rodar contra Postgres local: `docker exec -i supabase_db_<ref> psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/operacoes_massa.sql` → falha (`reajustar` não aceito). Sem Docker: receita da memória `reference_teste_sql_sem_docker` (transação desfeita em produção, `TESTE_OK`, prova de vermelho sem a migration).

- [ ] **Step 3: Migration** (conferir antes os nomes reais: `select conname from pg_constraint where conrelid in ('public.operacoes_massa'::regclass,'public.operacoes_massa_itens'::regclass)`):

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
  add column familia_ids uuid[];

drop index public.operacoes_massa_itens_status_unico;
create unique index operacoes_massa_itens_status_unico on public.operacoes_massa_itens (org_id, ml_item_id)
  where promocao_id is null and status in ('pendente','enviando','conferindo');
```

- [ ] **Step 4:** teste SQL verde + `npm run db:check` (só a migration nova pendente).
- [ ] **Step 5:** `src/lib/database.types.ts`: novas colunas (Row/Insert/Update) — `preco_anterior: number | null`, `etapa: string | null`, `confirmado_sem_dado: boolean`, `incluido: boolean`, `avaliacao: Json | null`, `estado_anterior: Json | null`, `variacoes_ml: Json | null`, `familia_ids: string[] | null`; `operacoes_massa.expira_em: string | null`. `pnpm exec tsc -b` → 0 erros. Ajustar `src/lib/operacoes.ts` `StatusItemOperacao` (+ `'rascunho' | 'conferindo'`) e `ROTULO_STATUS` (`rascunho: 'Rascunho'`, `conferindo: 'Conferindo no ML'`) e o `TONE_STATUS` da lista (`rascunho: 'neutral'`, `conferindo: 'info'`) para compilar.
- [ ] **Step 6:** commit `feat(operacoes): schema do reajuste de preço em massa`.

---

### Task 2: RPCs de reserva e persistência (opus)

**Files:**
- Create: `supabase/migrations/<ts>_reajuste_preco_rpcs.sql`
- Create: `supabase/tests/reajuste_preco.sql` (funcional) e `supabase/tests/reajuste_preco_concorrencia.sh` (duas sessões, modelo `worker_rodadas_concorrencia.sh`)

**Interfaces — Produces (todas `security definer`, `set search_path = ''`, `revoke ... from public, anon, authenticated; grant execute ... to service_role`):**
- `public.reajuste_reivindicar(p_org uuid, p_operacao uuid, p_ml_item text) returns text` — `'ok'` | `'ocupado'` (outro worker/sem linha elegível) | motivo legível (recusa; o chamador grava o item `bloqueado` ou `mudou`).
- `public.familia_reservar_publicacao(p_org uuid, p_familia_ids uuid[], p_operacao text) returns table(id uuid, lote_id uuid, user_id uuid, codigo_pai text, motivo text)` — devolve as famílias reservadas (motivo null) e as recusadas por reajuste (motivo preenchido); `p_operacao` ∈ {CREATE, UPDATE} replica os filtros atuais de `publicar-familias`.
- `public.familia_reservar_migracao_pxv(p_org uuid, p_codigo_pai text) returns text` — `'ok'` | motivo.
- `public.operacoes_massa_reivindicar` (REPLACE, mesma assinatura e retorno boolean): para operação `aderir` toma o advisory lock do MLB e não reivindica se houver reajuste ativo no MLB (grava o item `mudou` com mensagem `'Reajuste de preço em andamento neste anúncio'`).
- `public.reajuste_persistir(p_org uuid, p_operacao uuid, p_ml_item text, p_preco_confirmado numeric, p_restaurar jsonb) returns text` — `'ok'` | `'conflito'` | `'ja_aplicado'`.

Regras comuns:
- **Lock do MLB:** `perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_ml_item, 0));`
- **Famílias do MLB** = `operacoes_massa_itens.familia_ids` do item (gravadas no preview) — `select ... from public.familias where id = any(v_familias) and org_id = p_org for update`.
- **Reajuste ativo num MLB/família:** existe item `operacoes_massa_itens` com `org_id = p_org`, operação `reajustar` (join `operacoes_massa`), `status in ('pendente','enviando','conferindo')` e (`ml_item_id = X` | `familia_ids && array[família]`).

Lógica:
- `reajuste_reivindicar`: lock do MLB → carrega o item (`for update`); elegível para claim se `status='pendente'` **ou** (`status='conferindo'` e `proxima_conferencia <= now()`) **ou** (`status='enviando'` e `atualizado_em < now() - interval '2 minutes'`); senão `'ocupado'`. Trava as famílias (`for update`). Se `etapa is null` (envio novo): recusa `'Família em publicação/atualização — tente depois'` se alguma família `status='publicando'`; recusa `'Migração para preço por variação em curso'` se `anuncios_externos.migracao_pxv_status in ('solicitada','em_andamento')` para o `codigo_pai` de alguma família; recusa `'Anúncio participando de operação de promoção em andamento'` se existir item de operação `aderir`/`sair` do MLB em `pendente/enviando/saida_solicitada`. Se a operação tem `origem_id` (Reverter) e `etapa is null`: compara as variações atuais com o que a origem gravou (para cada `variacao_id` do `estado_anterior` da origem: `preco_publicacao = origem.preco` e `preco_editado_pelo_operador = true`) → diferente: `'Não revertível: o preço mudou depois do reajuste'`. Retomadas (`etapa` preenchida) **não** passam por essas recusas (C3). Ao final: `update ... set status='enviando', atualizado_em=now()` (preserva `etapa`) e `'ok'`.
- `familia_reservar_publicacao`: trava `familias where id = any(p_familia_ids) and org_id = p_org and operacao = p_operacao and status in ('pronto','erro') and (ml_item_id is null) = (p_operacao = 'CREATE') for update`; para cada uma: reajuste ativo (por `familia_ids && array[id]`) → devolve com `motivo` sem alterar; senão `update set status='publicando', erro_mensagem=null` e devolve com `motivo null`.
- `familia_reservar_migracao_pxv`: trava `familias where codigo_pai = p_codigo_pai and org_id = p_org for update`; reajuste ativo em alguma → motivo `'Há reajuste de preço em massa em andamento neste produto'`; senão `update public.anuncios_externos set migracao_pxv_status='solicitada', ... where org_id=p_org and codigo_pai=p_codigo_pai and particao=0 and migracao_pxv_status is null` (copiar exatamente os campos que `migrar-preco-por-variacao/index.ts:~115-127` grava hoje) e `'ok'`; nenhuma linha atualizada → `'Migração já solicitada'`.
- `operacoes_massa_reivindicar` (replace): ler `acao` da operação; se `aderir`: advisory lock do MLB + se reajuste ativo no MLB → `update set status='mudou', mensagem=..., atualizado_em=now()` e `return false`; demais ações: comportamento idêntico ao atual.
- `reajuste_persistir`: lock do MLB; item `for update`; se `status='aplicado'` → `'ja_aplicado'`; `p_restaurar` = `[{variacao_id, esperado:{preco_publicacao, preco_editado_pelo_operador}, novo:{preco_publicacao, preco_editado_pelo_operador}}]`; para cada variação: `select ... from variacoes where id = variacao_id and org_id = p_org for update` e compara com `esperado` (numeric igual e boolean igual) — qualquer diferença → `update item set status='erro', etapa=null, mensagem='Conflito: o preço desta cor foi alterado por outro fluxo durante o reajuste — ML ficou com o preço novo; o próximo UPDATE publicará o valor do banco', atualizado_em=now()` e `'conflito'`; senão `update variacoes set preco_publicacao = novo.preco_publicacao, preco_editado_pelo_operador = novo.preco_editado_pelo_operador, preco_publicado_ml = p_preco_confirmado` e `update item set status='aplicado', etapa=null, mensagem=null, atualizado_em=now()`; `'ok'`. Tudo numa transação (a função).
  (Conferir se `variacoes` tem `org_id`; se não, escopar por `familia_id in (select id from familias where org_id = p_org)`.)

- [ ] **Step 1: testes funcionais (vermelho)** em `supabase/tests/reajuste_preco.sql` (begin/rollback, fixtures: org, família Legacy `ml_item_id='MLBX'` com 2 variações, operação `reajustar` executando com item `pendente` `familia_ids={fam}`): (a) reivindicar → `'ok'` e item `enviando`; de novo → `'ocupado'`; (b) família `publicando` + item novo → motivo; (c) item `conferindo` com `proxima_conferencia` futura → `'ocupado'`; vencida → `'ok'` e `etapa` preservada; (d) `familia_reservar_publicacao` com reajuste ativo → linha com motivo e família continua `pronto`; sem reajuste → `publicando`; (e) `familia_reservar_migracao_pxv` com reajuste ativo → motivo; (f) persistir com esperado igual → `'ok'`, variações gravadas, item `aplicado`; chamar de novo → `'ja_aplicado'`; com esperado diferente → `'conflito'` e variações intocadas; (g) aderir: operação `aderir` com item do mesmo MLB e reajuste ativo → `operacoes_massa_reivindicar` false e item `mudou`; sem reajuste → true (regressão do comportamento atual: `pausar` e `sair` inalterados); (h) Reverter com variação editada depois → motivo "Não revertível".
- [ ] **Step 2: teste concorrente (vermelho)** `reajuste_preco_concorrencia.sh`: fixtures via psql; variantes, cada uma com sessão A segurando a transação 3 s e B medida: (1) A = `reajuste_reivindicar` (begin; select; pg_sleep(3); commit) × B = `familia_reservar_publicacao` da mesma família → B espera ≥1 s e devolve motivo; (2) A = `familia_reservar_publicacao` (família vira publicando) × B = `reajuste_reivindicar` → B espera e devolve motivo de publicação; (3) A = `reajuste_reivindicar` × B = `operacoes_massa_reivindicar` de `aderir` do mesmo MLB → B espera e devolve false; (4) A = `reajuste_reivindicar` × B = `familia_reservar_migracao_pxv` → motivo; (5) duas sessões `reajuste_reivindicar` no mesmo item `conferindo` vencido → exatamente uma `'ok'`, a outra `'ocupado'`. Cleanup no `trap`.
- [ ] **Step 3:** escrever a migration com as 5 funções.
- [ ] **Step 4:** os dois testes verdes no Postgres local (Docker). Sem Docker: o funcional pela receita de produção (`TESTE_OK`); o concorrente **exige** Docker — se não subir, registrar no relatório como pendente e avisar o controlador (não pular em silêncio).
- [ ] **Step 5:** `database.types.ts` — `Functions` com as 4 novas assinaturas (args/returns). `tsc -b`.
- [ ] **Step 6:** commit `feat(operacoes): RPCs de reserva e persistência do reajuste`.

---

### Task 3: Núcleo puro — alvo, elegibilidade, decisão por etapa, avaliação (opus)

**Files:**
- Create: `supabase/functions/_shared/operacoes/reajuste/alvo.ts`, `elegibilidade.ts`, `decidir.ts`, `avaliacao.ts`, `tipos.ts` + `__tests__/` de cada.

**Interfaces — Produces:**
```ts
// tipos.ts
export type TipoAjuste = 'pct' | 'reais';
export interface Ajuste { tipo: TipoAjuste; sentido: '+' | '-'; valor: number }
export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';
export interface CorAvaliada { variation_id: string | null; sku: string | null; custo: number | null; piso: number | null;
  origem: 'nacional' | 'importado' | null; aliquota_pct: number | null; comissao_pct: number | null; comissao_fixa: number | null;
  frete: number | null; liquido: number | null; semaforo: Semaforo; motivo: string | null }
export interface Avaliacao { cores: CorAvaliada[]; pior: Semaforo; tem_vermelho: boolean; tem_sem_dado: boolean }
export interface VivoItem { preco: number | null; variacoes: { id: string; preco: number }[] | null; status: string; sub_status: string[];
  catalog_listing: boolean; tem_relacoes: boolean }
// alvo.ts
export const centavos: (reais: number) => number;           // half-up
export const reais: (centavos: number) => number;
export function calcularAlvo(base: number, a: Ajuste): number | null; // null = inválido (≤ 0)
export function semAlteracao(base: number, alvo: number): boolean;     // iguais em centavos
// elegibilidade.ts
export interface FatosElegibilidade { vivo: VivoItem; ehKit: boolean; temAtacado: boolean; participaPromocao: boolean | null; // null = leitura falhou
  familiaPublicando: boolean; migracaoPxv: boolean }
export function motivoInelegivel(f: FatosElegibilidade): string | null;
// decidir.ts
export type Etapa = 'escrita_pedida' | 'ml_confirmado' | null;
export type Vivo = { kind: 'ok'; preco: number; todasIguais: boolean; composicao: string[] | null } | { kind: 'falhou' };
export type DecisaoReajuste =
  | { tipo: 'persistir' } | { tipo: 'escrever' } | { tipo: 'voltar_pendente' }
  | { tipo: 'fim'; status: 'mudou' | 'erro' | 'conferindo'; mensagem: string };
export function decidirReajuste(etapa: Etapa, alvo: number, anterior: number, vivo: Vivo, composicaoEsperada: string[] | null): DecisaoReajuste;
// avaliacao.ts
export function mudouAvaliacao(antes: Avaliacao, agora: Avaliacao): boolean; // compara custo/origem/aliquota/piso/comissao/fixa/frete por cor (centavos/igualdade), composição de cores
export function resumir(cores: CorAvaliada[]): Avaliacao;
```

Regras (testar cada linha):
- `calcularAlvo`: pct → `round_half_up(base × (100 ± valor)/100)` em centavos (`Math.round` sobre centavos inteiros com correção de float: usar `Math.round((centavos(base) * (100 ± valor)) / 100)` com `valor` em até 2 casas → multiplicar por 100 e trabalhar em inteiros: `Math.round(centavos(base) * (10000 ± valor*100) / 10000)`); reais → `centavos(base) ± centavos(valor)`; resultado ≤ 0 → `null`. Casos: 100,00 +1% = 101,00; 19,99 +10% = 21,99 (21,989 → 21,99); 10,05 −5% = 9,55 (9,5475 → 9,55); 0,50 −R$1 → null; 33,33 +0% → 33,33 (sem alteração).
- `motivoInelegivel` (ordem; primeira que bater): `vivo.status` ∉ {active, paused} ou `sub_status` com moderação (`forbidden`,`waiting_for_patch`,`poor_quality_thumbnail`,`poor_quality_picture`) → `'Anúncio moderado, encerrado ou inativo'`; `ehKit` → `'Kit Virtual não entra no reajuste'`; `catalog_listing || tem_relacoes` → `'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste'`; `temAtacado` → `'Anúncio com preço de atacado fica fora do reajuste'`; `participaPromocao === true` → `'Participando de promoção'`; `participaPromocao === null` → `'Não foi possível conferir promoções — tente de novo'`; `familiaPublicando` → `'Família em publicação/atualização'`; `migracaoPxv` → `'Migração para preço por variação em curso'`.
- `decidirReajuste` (spec "Execução por item"):
  - `etapa='ml_confirmado'` → `persistir`.
  - `etapa='escrita_pedida'`: vivo falhou → `fim conferindo 'Aguardando confirmação do ML'`; composição ≠ esperada → `fim erro 'Variações do anúncio mudaram durante o reajuste'`; `todasIguais && preco===alvo` → `persistir`; `todasIguais && preco===anterior` → `voltar_pendente`; senão `fim erro 'Preço alterado por terceiros durante o reajuste'`.
  - `etapa=null`: vivo falhou → `fim erro 'Não foi possível ler o anúncio'`; composição ≠ esperada → `fim mudou 'Variações do anúncio mudaram — refaça o preview'`; `!todasIguais || preco !== anterior` → `fim mudou 'O preço mudou desde o preview'`; senão `escrever`.
  - comparar preços em centavos.
- `mudouAvaliacao`: mesma quantidade/ordem de cores (por `variation_id ?? sku`) e, por cor, iguais: `custo`, `piso`, `origem`, `aliquota_pct`, `comissao_pct`, `comissao_fixa`, `frete` (numéricos comparados em centavos/2 casas) → senão `true`.
- `resumir`: `pior` = maior de {indisponivel:0? não: ordem de gravidade} — **vermelho > indisponivel > amarelo > verde** para o resumo de bloqueio, mas `tem_vermelho` e `tem_sem_dado` independentes (C5/D12: um não esconde o outro).

- [ ] Steps TDD por arquivo (teste vermelho → implementação → verde), `pnpm exec vitest run supabase/functions/_shared/operacoes/reajuste`; commit `feat(operacoes): núcleo puro do reajuste de preço`.

---

### Task 4: Cliente ML do reajuste (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/ml.ts` + `__tests__/ml.test.ts`.

**Interfaces — Consumes:** `caminhoMultiget`, `comoEnvelopeAntigo` (`_shared/ml/multiget.ts`); `SemAcessoStatusML` (`../ml-status.ts`) como erro fatal de acesso. **Produces:**
```ts
export type ResultadoPut = { kind: 'ok' } | { kind: 'sem_escrita'; status: number; mensagem: string } | { kind: 'desconhecido'; mensagem: string };
export interface ClienteReajusteML {
  lerVivo(itemId: string): Promise<VivoItem & { variacoesComPreco: { id: string; preco: number }[] | null }>; // lança SemAcessoStatusML em 401/403 (HTTP ou envelope); Error comum nos demais
  putPreco(itemId: string, alvo: number, variacaoIds: string[] | null): Promise<ResultadoPut>;          // nunca lança (exceto SemAcessoStatusML)
  participaPromocao(itemId: string): Promise<boolean | null>;                                           // null = leitura falhou
}
export function criarClienteReajusteML(token: string, f?: typeof fetch): ClienteReajusteML;
```
Regras:
- `lerVivo`: `GET /items/bulk?ids=<id>&attributes=status_code,body.id,body.price,body.status,body.sub_status,body.variations,body.catalog_listing,body.item_relations` (usar `caminhoMultiget([id], 'id,price,status,sub_status,variations,catalog_listing,item_relations')`); envelope 401/403 → `SemAcessoStatusML`; 404 → `Error('ML não devolveu o anúncio')`; `variations` → `[{id: String(v.id), preco: v.price}]` ou `null` se vazio; `tem_relacoes` = `item_relations` não vazio.
- `putPreco`: Legacy (`variacaoIds` não nulo) body `{variations: variacaoIds.map(id => ({id: Number(id), price: alvo}))}`; plano/UP body `{price: alvo}`; `PUT /items/{id}`. Resposta 200/201 → `ok`; 401/403 → lança `SemAcessoStatusML`; 400/404/409/422 (o ML respondeu e recusou) → `sem_escrita` com `message` do corpo; 429 → `sem_escrita` (status 429, retentável pelo executor); 5xx, timeout (`AbortController` 15 s) ou `fetch` lançando → `desconhecido`.
- `participaPromocao`: `GET /seller-promotions/items/{id}?app_version=v2` → lista; alguma com `status` `pending`/`started` → `true`; para cada uma com `candidate` → `GET /seller-promotions/promotions/{promotion_id}/items?promotion_type={type}&item_id={id}&app_version=v2` (visão da campanha) → `pending`/`started` → `true`; qualquer falha (exceto 404 do item = sem promoções → `false`) → `null`. 401/403 → `null` (não fatal aqui; a elegibilidade bloqueia).
- Testes com `vi.fn()` de fetch (modelo `_shared/operacoes/__tests__/ml.test.ts`): cada branch acima, URLs e bodies exatos.
- [ ] TDD; commit `feat(operacoes): cliente ML do reajuste`.

---

### Task 5: Preview no servidor (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/preview.ts` + `__tests__/preview.test.ts`.

**Interfaces — Consumes:** Task 3 (`calcularAlvo`, `semAlteracao`, `motivoInelegivel`, `resumir`), Task 4 (`ClienteReajusteML`), `projetarItem`, `carregarCadastro`, `lerAliquotas`, `criarTarifaEm`, `buscarItensML`/`criarGetJson` (`_shared/promocoes/`). **Produces:**
```ts
export interface PedidoPreview { familias: string[]; ml_item_ids: string[]; ajuste: Ajuste; precos?: Record<string, number>; origem_id?: string | null }
export interface ItemPreview { ml_item_id: string; familia_ids: string[]; titulo: string | null; sku: string | null;
  preco_anterior: number; preco: number; avaliacao: Avaliacao; estado_anterior: EstadoVariacao[]; variacoes_ml: string[] | null;
  situacao: 'elegivel' | 'fora' | 'sem_alteracao'; motivo: string | null }
export interface EstadoVariacao { variacao_id: string; preco_publicacao: number | null; preco_editado_pelo_operador: boolean }
export interface DepsPreview {
  expandir(orgId: string, familias: string[], mlItemIds: string[]): Promise<{ ml_item_id: string; familia_ids: string[]; variacao_ids: string[]; sku: string | null; titulo: string | null; ehKit: boolean; temAtacado: boolean; familiaPublicando: boolean; migracaoPxv: boolean }[]>;
  estadoVariacoes(orgId: string, variacaoIds: string[]): Promise<EstadoVariacao[]>;
  ml: ClienteReajusteML;
  avaliar(mlItemId: string, preco: number): Promise<Avaliacao>; // projetarItem com cadastro/alíquotas carregados 1x
  origem?(orgId: string, origemId: string): Promise<{ itens: Map<string, { preco_anterior: number; preco: number; estado_anterior: EstadoVariacao[] }> } | null>;
}
export const MAX_MLBS = 500;
export async function montarPreview(orgId: string, p: PedidoPreview, deps: DepsPreview): Promise<{ ok: true; itens: ItemPreview[] } | { ok: false; erro: string }>;
```
Regras:
- Expansão deduplicada por `ml_item_id`; `> MAX_MLBS` → `{ok:false, erro:'No máximo 500 anúncios por operação (a seleção expandiu para N).'}`.
- Por MLB (em paralelo limitado a 5): `lerVivo`; `participaPromocao`; base = vivo (Legacy: exige `todasIguais`, senão `fora` "Variações com preços diferentes no ML"); `motivoInelegivel` → `fora`; alvo = `precos[ml]` (normalizado em centavos) ?? `calcularAlvo(base, ajuste)`; `null` → `fora` "Preço resultante inválido"; `semAlteracao` → `sem_alteracao`; senão `avaliar(ml, alvo)` e `estadoVariacoes`.
- Reverter (`origem_id`): ignora `ajuste`; só MLBs `aplicado` na origem; alvo = `preco_anterior` da origem; se vivo ≠ `preco` da origem → `fora` "Não revertível: o preço mudou depois do reajuste"; `estado_anterior` = o da origem (é o estado a restaurar), e o "estado esperado" para a RPC é `{preco_publicacao: origem.preco, editado: true}` por variação.
- Testes com deps falsos: expansão > 500; cada motivo fora; sem alteração; preço editado sobrescreve; Legacy com preços divergentes; reverter (aplicado / mudou depois / não aplicado).
- [ ] TDD; commit `feat(operacoes): preview do reajuste no servidor`.

---

### Task 6: Handler `reajustar` no laço (opus)

**Files:** Create `supabase/functions/_shared/operacoes/reajuste/executar.ts` + `__tests__/executar.test.ts`. Modify `supabase/functions/_shared/operacoes/laco.ts` **só se** necessário para aceitar `reivindicar` que devolve motivo (preferir adaptar no deps: `reivindicar` booleano + gravação do motivo).

**Interfaces — Produces:**
```ts
export interface OperacaoReajusteRow { id: string; org_id: string; origem_id: string | null }
export interface ItemReajusteRow extends ItemRow { preco_anterior: number; etapa: Etapa; avaliacao: Avaliacao; estado_anterior: EstadoVariacao[];
  variacoes_ml: string[] | null; confirmado_sem_dado: boolean }
export interface DepsReajuste extends DepsLaco {
  ml: ClienteReajusteML;
  itensReajuste(operacaoId: string, limite: number): Promise<ItemReajusteRow[]>; // pendente + conferindo vencido + enviando parado
  reivindicarReajuste(operacaoId: string, mlItemId: string): Promise<'ok' | 'ocupado' | string>;
  avaliar(mlItemId: string, preco: number): Promise<Avaliacao>;
  fatosElegibilidade(mlItemId: string, familiaIds: string[]): Promise<Omit<FatosElegibilidade, 'vivo' | 'participaPromocao'>>;
  persistir(operacaoId: string, mlItemId: string, precoConfirmado: number, restaurar: unknown): Promise<'ok' | 'conflito' | 'ja_aplicado'>;
  agendarConferenciaItem(operacaoId: string, mlItemId: string, conferencias: number): Promise<void>; // status conferindo + proxima_conferencia (5,10,20,40,60 min)
}
export function executarReajuste(op: OperacaoReajusteRow, deps: DepsReajuste, opts: { limiteMs: number; lote: number; maxItens?: number }): Promise<{ processados: number; continuou: boolean }>;
```
Fluxo por item (spec "Execução por item"; recuperação antes das travas):
1. claim `reivindicarReajuste`: `'ocupado'` → pula; motivo → `gravarItem({status: motivo começa com 'Não revertível' ? 'mudou' : 'bloqueado', mensagem: motivo})`.
2. `etapa='ml_confirmado'` → `persistir` (`'ok'|'ja_aplicado'` → pronto; `'conflito'` → já gravado pela RPC; erro de banco → `agendarConferenciaItem`).
3. `etapa='escrita_pedida'` → `lerVivo` (falha → `agendarConferenciaItem`) → `decidirReajuste` → `persistir`/`voltar_pendente` (`gravarItem({status:'pendente', etapa:null})`) / fim. **Sem elegibilidade.**
4. `etapa=null` → `lerVivo` (falha → `erro` com tentativa retentável até 3 via `conferencias`) → `participaPromocao` + `fatosElegibilidade` → `motivoInelegivel` → `bloqueado`; `decidirReajuste` → `mudou`; `avaliar(alvo)` + `mudouAvaliacao(item.avaliacao, agora)` → `mudou 'Dados financeiros mudaram desde o preview — refaça o preview'`; trava: `agora.tem_vermelho && !confirmado_risco` ou `agora.tem_sem_dado && !confirmado_sem_dado` → `mudou` (defesa; o `confirmar` já exige).
5. `gravarItem({etapa:'escrita_pedida'})` → `putPreco` → `sem_escrita` (429 → tentativa até 3 com `etapa:null` e volta `pendente`; demais → `erro` mensagem do ML, `etapa:null`) | `desconhecido` → `agendarConferenciaItem` | `ok` → `lerVivo` (falha → `agendarConferenciaItem`) → todas = alvo → `gravarItem({etapa:'ml_confirmado'})` → `persistir`; senão `erro 'Preço não aplicado pelo ML'` (`etapa:null`).
6. Fatal (`SemAcessoStatusML`): itens sem etapa → `erro 'Reconecte a conta do ML em Canais'`; itens com etapa ficam `conferindo` (não usar `encerrarRestantes` genérico do status: implementar `encerrarSemEtapa`).
- `restaurar` para `persistir`: envio normal = por variação `{variacao_id, esperado: estado_anterior[i], novo: {preco_publicacao: alvo, preco_editado_pelo_operador: true}}`; Reverter = `{esperado: {preco_publicacao: origem.preco, editado: true}, novo: estado_anterior_da_origem[i]}`.
- Testes (mocks como `executar-status.test.ts`): sucesso Legacy/plano/UP; `sem_escrita` 400 → erro; 429 ×3 → erro; `desconhecido` → conferindo; conferência alvo → aplicado **mesmo com `participaPromocao` falhando** (Review Focus 2); conferência anterior → pendente sem etapa; terceiros → erro; Legacy uma variação diferente → não confirma; persistir conflito; banco falha após ml_confirmado → conferindo; fatal com mix de itens; Reverter.
- [ ] TDD; suites antigas intactas; `pnpm lint:functions && pnpm check:functions`; commit `feat(operacoes): handler de reajuste de preço`.

---

### Task 7: Fiação na edge `operacoes-massa` (opus)

**Files:** Modify `supabase/functions/operacoes-massa/index.ts`, `supabase/functions/_shared/operacoes/deps.ts`; Create `supabase/functions/_shared/operacoes/reajuste/deps.ts`.

Contratos:
- `POST {etapa:'preview', acao:'reajustar', ...PedidoPreview}` (usuário, `requireUserOrg` write; qualquer membro): `montarPreview` → grava operação `rascunho` (`expira_em = now()+30min`, `origem_id`, `criado_por`) e itens `rascunho` (todas as colunas da Task 1; `semaforo` = `avaliacao.pior`; `incluido` default true; fora/sem alteração gravados com `status='bloqueado'`/`'ja_estava'` e `mensagem`) → `201 {operacao_id, itens}`. Antes de gravar, apaga rascunhos expirados da org.
- `POST {etapa:'confirmar', operacao_id, confirmacoes:[{ml_item_id, incluir, risco?, sem_dado?}]}` (admin/suporte full; auditoria): operação `rascunho` da org e não expirada (senão 400 "O preview expirou — gere de novo"); para cada item elegível incluído: `avaliacao.tem_vermelho → risco === true`, `tem_sem_dado → sem_dado === true` (senão 400 com `itens` recusados); grava `incluido`, `confirmado_risco`, `confirmado_sem_dado`; itens incluídos `rascunho → pendente` (colisão de índice → 409 "Algum destes anúncios já está numa operação em andamento"); operação `rascunho → executando`; publica QStash `executar` (mesmo `dedup`). Nenhum incluído → 400.
- Etapa QStash para `reajustar`: igual ao ramo `pausar/reativar` (conexão, `invalid_grant` → `encerrarComErro`), chamando `executarReajuste` com `depsReajuste`; etapa `conferir` também executa (o laço pega `conferindo` vencido); ao terminar sem pendentes mas com `conferindo` → agenda nova mensagem para a menor `proxima_conferencia` (reaproveitar `agendarOuConcluir` com os itens `conferindo`).
- `depsReajuste` (service role, tudo por `org_id`): `expandir` (Legacy: `familias` com `ml_item_id` = X, canônica por `publicado_em desc`, todas as famílias com esse `ml_item_id` em `familia_ids`; UP: `anuncios_externos` (`codigo_pai`, `status='publicado'`) → `anuncios_externos_itens` não retirados com `item_externo_id`; família = a do `codigo_pai`; `variacao_ids` via `anuncios_externos_itens.variacao_id` ou `variacoes(familia_id, codigo=sku)`; kit = `kits_virtuais` publicado; atacado = `familias.atacado` ou `variacoes.atacado` não vazio; publicando = `familias.status='publicando'`; PxV = `motivoMigracaoPxvPorItem`), `estadoVariacoes`, `avaliar` (carrega `carregarCadastro`/`lerAliquotas` uma vez por instância e `buscarItensML` em lote no preview; `projetarItem` com item sintético como `criarSemaforoExato`), `reivindicarReajuste` (RPC), `persistir` (RPC), `itensReajuste` (SQL: `status='pendente'` ∪ `conferindo` com `proxima_conferencia <= now()` ∪ `enviando` com `atualizado_em < now()-2min`), `agendarConferenciaItem`.
- Verificação: `pnpm lint:functions && pnpm check:functions`; vitest `_shared/operacoes`. Commit `feat(operacoes-massa): preview, confirmar e executar reajuste`.

---

### Task 8: C2 nos outros escritores (opus)

**Files:** Modify `supabase/functions/publicar-familias/index.ts` (claims CREATE/UPDATE → `familia_reservar_publicacao`), `supabase/functions/update-familia-ml/processar.ts` (guard ao lado do PxV, linha ~151: mesma consulta "reajuste ativo na família" → `Error(... (400))` com `status=400`), `supabase/functions/migrar-preco-por-variacao/index.ts` (escrita de `solicitada` → `familia_reservar_migracao_pxv`); testes nos `__tests__` desses módulos (seguir os existentes; se a edge não tiver teste, extrair a decisão para função pura testável).
- `publicar-familias`: chamar a RPC duas vezes (CREATE e UPDATE) com `familia_ids`; as linhas com `motivo` viram resposta ao operador: incluir na resposta JSON um array `recusadas: [{familia_id, motivo}]` e manter o status 200 se houve alguma enfileirada (comportamento atual de contagem `enfileiradas`); se todas foram recusadas → 409 com a mensagem. Conferir como o front (`useConfirmarPublicacao` ou equivalente) exibe a resposta e mostrar `recusadas` num toast (ajuste mínimo no hook do front).
- Testes: claim com reajuste ativo → família não muda de status e aparece em `recusadas`; sem reajuste → comportamento idêntico ao de hoje (snapshot do que era enfileirado).
- Commit `feat(publicacao): reserva atômica contra reajuste em andamento`.

---

### Task 9: Front — lib e hooks (opus — calcula preço/semáforo)

**Files:** Create `src/lib/reajuste.ts` (+ teste), Modify `src/hooks/useOperacoes.ts` (+ teste), `src/lib/operacoes.ts` (título/inversa/revertíveis para `reajustar`).
- `src/lib/reajuste.ts` re-exporta `calcularAlvo`, `semAlteracao`, `centavos`, `reais` de `../../supabase/functions/_shared/operacoes/reajuste/alvo.ts` (mesma função do servidor) e define `formatarAjuste(a)`, `precisaConfirmar(item)` (`{risco: tem_vermelho, semDado: tem_sem_dado}`).
- `src/lib/operacoes.ts`: `AcaoOperacao` inclui `'reajustar'`; `tituloOperacao` → `"Reajustar preço de N anúncios"` (ou `"Reverter reajuste de N anúncios"` com `origem_id`); `itensRevertiveis('reajustar', …)` = só `aplicado`; `ehAcaoStatus` inalterado.
- Hooks: `usePreviewReajuste()` (mutation `{etapa:'preview', ...}` → `{operacao_id, itens}`), `useConfirmarReajuste()` (mutation `{etapa:'confirmar', ...}`; invalida `QK_OPERACOES`); `useOperacoes` conclusão de `reajustar` também invalida `QK.statusPublicados` e as queries de Publicados (preço publicado).
- Testes: título, revertíveis, paridade (o front usa o mesmo `calcularAlvo` — teste importando dos dois caminhos e comparando 20 casos).
- Commit `feat(front): lib e hooks do reajuste de preço`.

---

### Task 10: Front — diálogo, preview e Publicados (opus no preview, sonnet aceitável no diálogo — manter opus por simplicidade)

**Files:** Create `src/components/operacoes/dialog-reajuste.tsx`, `src/components/operacoes/preview-reajuste.tsx` (+ testes); Modify `src/components/operacoes/barra-selecao-publicados.tsx` (prop `onReajustar`, botão `Reajustar preço (N)` com N = ativos+pausados selecionáveis), `src/pages/Publicados.tsx` (estado e abertura), `src/components/operacoes/lista-operacoes.tsx` (título + Reverter de `reajustar` → gera preview com `origem_id` e abre `PreviewReajuste`).
- Diálogo: Aumentar/Diminuir, %/R$, valor (input numérico, vírgula aceita), botão "Ver preview" → `usePreviewReajuste` com `familias` (UP: `familiaId` das linhas selecionadas) e `ml_item_ids` (Legacy/plano) — o servidor expande.
- Preview: tabela por MLB (UP: uma linha por SKU) — título/SKU, atual → novo (input editável: ao editar, chama de novo `usePreviewReajuste` com `precos` e substitui o rascunho), líquido/markup da pior cor, semáforo, expandir cores; seções "Fora do lote" (motivo) e "Sem alteração"; checkbox incluir por item; checkboxes de confirmação separados "Confirmo os itens com prejuízo (🔴)" e "Confirmo os itens sem cálculo (⚪)" (só aparecem se houver); avisos: fixação do preço (D1), 🟡; contador de expiração (30 min); botão "Reajustar N anúncios" (admin/suporte full) ou "Só administradores executam."; erros 400/409 com recusas por item.
- Testes: cálculo exibido = `calcularAlvo`; 🔴 e ⚪ exigem confirmações separadas; editar preço chama preview com `precos`; membro não executa; expiração.
- Commit `feat(front): reajuste de preço na tela Publicados`.

---

### Task 11: Docs (sonnet)

`docs-update-checklist`: TASKS.md, `docs/reference/edge-functions.md` (operacoes-massa preview/confirmar/reajustar; publicar-familias recusadas; migrar-preco-por-variacao), `docs/reference/modelo-de-dados.md` (colunas/status/RPCs), glossário (rascunho, conferindo, reajuste), obsidian (Promoções/Operações, Changelog, Sprint). ADR-0178 → "Aceito" com a seção Implementação. `pnpm docs:links`. Commit.

---

### Task 12: Portão, revisão final, merge, deploy e validação (controlador)

1. `pnpm preflight` (estático + as duas árvores) verde; testes SQL e o concorrente verdes (Docker).
2. Revisão final Grok 4.7 xhigh (rodada única) do branch inteiro + correções → teste + CI.
3. CI verde → merge fast-forward `push origin <sha>:main`.
4. `supabase db push` (2 migrations) → conferir constraints/funções; deploy **na ordem**: `operacoes-massa`, `publicar-familias`, `update-familia-ml`, `migrar-preco-por-variacao` (e qualquer outra edge que importe arquivos alterados de `_shared` — listar com grep) → conferir versões ativas.
5. Validação de campo na DSA pelo app (Playwright isolado, magic link da conta admin DSA, logout global no fim): registrar org/`org_id`/MLBs/preço anterior e alvo; 2–3 MLBs elegíveis (Legacy com variações, plano, UP se houver); +1% → `/operacoes` concluída → GET no ML e SQL no banco (`preco_publicacao`, `editado`, `preco_publicado_ml`) → Reverter → GET + SQL restaurados; prints 1440/360 (diálogo, preview, operações). Promoções/Avil intocadas.
6. Docs "em produção", limpeza (branch/worktree), relatório com rulings.
