# Vendas SKU — Fatia 2c (Ads no dossiê do SKU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar todo dia, só com GET no Mercado Livre, o gasto e as vendas atribuídas de Product Ads **por grupo de anúncios (`ad_group_id`)** e mostrar no dossiê do SKU uma aba **"Ads"** com Despesa de Ads do período, vendas atribuídas, ROAS/ACOS/CPC por Σ, Lucro após Ads (só quando o gasto é exclusivo do alvo), série diária/semanal com a atribuição em aberto hachurada, lista dos grupos e estados honestos.

**Architecture:** Mesmo desenho da Fatia 2b. Uma lib pura com `Deps` injetáveis em `supabase/functions/_shared/ads/`, um `deps.ts` com o IO real e um `index.ts` fino (assinatura QStash → fan-out por org → cadeia com posse, cursor CAS e orçamento de 90 s). Quatro tabelas org-scoped (`ml_ads_sync`, `ml_ads_grupo`, `ml_ads_grupo_item`, `ml_ads_grupo_dia`) com RLS de leitura e escrita só por RPCs `service_role`. O front lê os grupos que tocam os MLBs do dossiê, resolve o código de **todo** membro do grupo por uma RPC de leitura nova (`vendas_sku_codigos_mlbs`, mesma UNION de `vendas_sku_mlbs`) e calcula tudo na leitura (`montarAds`). Nada congelado no worker.

**Tech Stack:** Deno Edge Functions + QStash (`_shared/queue.ts`), `getValidAccessTokenConexao`, Postgres + RLS, React/TS + recharts, Vitest (TZ `America/Sao_Paulo` já fixo em `vitest.config.ts`).

**Spec:** `docs/superpowers/specs/2026-09-26-vendas-sku-design.md` (seção "Fatia 2c", revisada pelo GPT-6 Astra) · decisões vinculantes R1–R14 do controlador (`design-2c.md`, resumidas em Global Constraints) · spike `docs/spikes/053-product-ads-ml.md` · ADR-0172.

## Global Constraints

- **Só GET no ML.** Nenhum PUT/POST/DELETE para o Mercado Livre. O único POST do fluxo é o refresh OAuth que já existe dentro de `getValidAccessTokenConexao`. Token **nunca** impresso (nem em log, nem em erro, nem em script) e **nunca** renovado fora de `getValidAccessTokenConexao`. Script de validação que ler token vencido aborta sem chamar o ML.
- **Unidade de dado = `ad_group_id`** (R3). Toda soma é por grupo, deduplicada por `ad_group_id`; nunca por MLB. A métrica por MLB/cor do ML (`/ad_groups/{id}/ads` com métricas) **não** é usada como valor (R2: não fecha com o grupo e passa em +0,95 % o total).
- **Endpoints (R4, spike 053 §3):** `GET /advertising/advertisers?product_id=PADS` com header `Api-Version: 1`; todos os outros com `api-version: 2`: `…/advertisers/{adv}/product_ads/ad_groups/search?limit=100&offset=N&date_from&date_to&metrics=<MAIÚSCULAS>&metrics_summary=true&filters[status]=ACTIVE,PAUSED,IDLE,EMPTY,HOLD`, `…/product_ads/ad_groups/{id}?date_from&date_to&metrics=<MAIÚSCULAS>&aggregation_type=daily` (minúsculo) e `…/product_ads/ad_groups/{id}/ads?limit=100&offset=N&date_from&date_to&metrics=COST` (só para a lista de membros de FAMILY/CATALOG). **Proibidos** os legados `ads/search` e `product_ads/items?item_ids=`.
- **Janela (R4):** carga inicial `[hoje−90, hoje−1]` (BRT; em 27/09/2026 = 29/06–26/09, exatamente a janela aceita no spike; > 90 dias dá 400). Dia a dia: `[hoje−15, hoje−1]` (D-1 + 14 dias de releitura da atribuição), estendida para trás até `último dia ok − 14` se o worker ficou parado, sem passar de `hoje−90`. **Hoje nunca é pedido nem gravado** (o ML já devolve o dia corrente parcial).
- **Série densa e zero só com linha real:** o ML devolve zero explícito. Resposta com algum dia da janela faltando é inválida (`parseSerieGrupo` → `null` → rodada `erro`); nada é gravado pela metade. No front, zero só aparece quando existe linha com `cost: 0`; dia sem linha, fora da cobertura ou com carga `parcial` fica sem valor (`null`). Depois de 5 adiamentos no mesmo cursor, os grupos não lidos viram falha e a rodada fecha em `erro` (nunca `ok`). Os percentuais da API (`acos`, `roas`, `cpc`, `ctr`, `cvr`, `sov`, `tacos`) são descartados no parser.
- **Métricas (R8):** CPC = Σcost/Σclicks, ROAS = Σtotal_amount/Σcost, ACOS = Σcost/Σtotal_amount — sempre por Σ. "Despesa de Ads do período" = Σcost dos dias **cobertos** do período até ontem (mesmo recorte do gráfico). "Lucro após Ads" = lucro atual do período (`linhaPeriodo.m.lucro`) − despesa, **só** com alcance `sku` (ou `familia` na visão da família) e período inteiro coberto; senão "indisponível" com o motivo (gasto compartilhado com N códigos / lucro sem custo / fora da cobertura / gasto fora dos grupos listados — `custo_resumo − custo_listado > 0` em `ml_ads_sync`, provável grupo excluído; a despesa continua aparecendo). Lucro nulo → Lucro após Ads nulo, nunca "−despesa". O lucro atual fica intacto. Nada entra em ranking, ABC, Financeiro ou billing.
- **Alcance (R7):** `sku` = todo grupo em que o código aparece tem só esse código (todo membro com código resolvido); `familia` = idem com "todos os códigos na família"; `anuncio` = algum grupo compartilhado (mostra o gasto dos grupos, rotulado); `indisponivel` = nenhum MLB do alvo no mapa. Membro sem código resolvido **impede** a exclusividade.
- **Vínculo MLB → código (R6):** o mesmo UNION de `vendas_sku_mlbs` (Fatia 2a), sem `familias.ml_item_id`, rodando no front com `current_org_id()`. Vínculo grupo → MLB = só o atual, com `visto_em`, rotulado "vínculo atual" (R5). ITEM: `ad_group_external_id` é o MLB. FAMILY/CATALOG: `/ad_groups/{id}/ads`, **sempre na janela de 90 dias**; lista vazia ou menor que o vínculo gravado → `itens: null` (o vínculo gravado fica; nunca encolhe por uma leitura, para nunca gerar um falso `sku`).
- **Estados (R9):** `sem_coleta`, `sem_permissao` (403 PolicyAgent: texto "sem permissão de Publicidade ou conexão recusada"), `sem_advertiser` (404 no advertiser ou lista sem MLB), `sem_acesso` (401 / sem conexão), `sem_ads` (zero comprovado **nos anúncios do mapa atual**: o texto diz "anúncios vinculados", porque um anúncio de catálogo que nunca vendeu não está no mapa de R6), `parcial` (carga inicial em curso), `desatualizado` (último ok há > 48 h), "atribuição em aberto" por dia (dia relido < 15 dias depois dele — medido pelo `coletado_em`, não pelo relógio de hoje), hoje nunca mostrado.
- **Worker (R10):** `coletar-ads-ml`, estado próprio `ml_ads_sync`; reaproveita de `_shared/trafego/` o contrato de posse/cursor, `buscarML`, `tratarRequisicao`, `corteRetencao`, `delaySegundos`, `TIMEOUT_ML_MS`, `diaDeHoje` e `emParalelo` (`_shared/promocoes`). Não refatora a 2b: só dois acréscimos compatíveis em `_shared/trafego/fiacao.ts` (parâmetro opcional `headers` em `buscarML` e `rotulo` opcional em `Rotas`). 401 no meio da cadeia: as deps descartam o token em memória, pedem de novo a `getValidAccessTokenConexao` **uma vez** e repetem a chamada; 401 de novo → `sem_acesso`; 403 nunca repete. `deduplicationId` com prefixo **`ads:`** (o QStash deduplica por conta: reusar `trafego:` descartaria a mensagem de Ads). Lote 20, concorrência 6, orçamento 90 s, 429/5xx com `Retry-After` só se couber, adiamento no mesmo cursor, `verify_jwt = false` + `verificarAssinatura`, `erro` → HTTP 500 (ADR-0171), `obsoleta` → 200. Retenção 13 meses **depois** do fan-out; falha da limpeza só loga. Schedule diário **`17 14 * * *` UTC** (11:17 BRT, depois das 10:00 BRT de atualização do ML).
- **Tabelas (R11):** org-scoped, RLS de select por `current_org_id()`, bloco de revoke/grant idêntico a `20260927084615_vendas_sku_trafego.sql:53-66`; RPCs de escrita `security definer`, `search_path = ''`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`. Upsert de `ml_ads_grupo_dia` = "o mais recente vence" por `coletado_em` (a atribuição muda por 14 dias; **não** vale "ok não regride"). Checks de faixa ≥ 0. Nenhuma linha é apagada quando um grupo some do search — só a retenção apaga.
- **Migrations:** só `supabase migration new vendas_sku_ads` (o timestamp vem do comando; chamado `<TS>` abaixo — substituir `<TS>` pelo valor real em todo arquivo e comentário criado nas tasks seguintes). Aplicar **só no Postgres local** (`docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < arquivo.sql`). **Sem `supabase db push`, sem deploy, sem schedule, sem merge, sem push** (R14). Runbook pronto para o Diego.
- **Repo público:** fixtures com números inventados e ids fictícios (`1000001`, `2000001`, `3000001`, `4000001`, `MLB1000000001`); nenhum valor real de cliente.
- **Shell:** `/usr/bin/git` em comandos simples (sem `&&`, sem `git -C`); commit sempre com `-F <arquivo>` num caminho absoluto literal no tmp do job que executa (`$JOB_TMP` = `/Users/diego/.claude/jobs/<id>/tmp`), mensagem terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Portão local antes de cada commit de código: `pnpm preflight:static` (+ `pnpm test` do arquivo tocado).
- **Português com acentos** em código, UI, testes e docs. **TZ `America/Sao_Paulo`** nos testes (vitest já fixa).
- **Modelos:** T1 (migration/RLS) → opus, sem rebaixar. T2–T5, T7 → sonnet. T6 → sonnet + skill `frontend-design-fable5` Tier 1 com `preflight.sh`; o controlador faz a auditoria Tier 2 (≥ 8/10).

## Review Focus

1. **Alcance errado — grupo contado 2× na família, ou grupo compartilhado marcado como `sku`.** Um grupo FAMILY alcançado por dois MLBs da família entra uma vez só; o par "grupo ITEM antigo + grupo FAMILY novo" do mesmo MLB migrado soma os dois; um membro fora do mapa do dossiê ou sem código resolvido tira o grupo do `sku`; uma releitura de `/ads` que devolve menos membros (ou nenhum) não encolhe o vínculo. Testes: T5 (`dedup por ad_group_id`, `par ITEM+FAMILY`, `membro sem código`, `membro de outro código`), T3 (`releitura com menos membros… não vira sku`, `/ads paginado > 100`), T1 (`vendas_sku_codigos_mlbs`, `itens [] não apaga`).
2. **Média de percentuais.** ROAS/ACOS/CPC do período vêm de Σ/Σ, e o parser nem lê `acos`/`roas`/`cpc` da API. Testes: T2 (`parseSerieGrupo descarta percentuais`) e T5 (`ROAS 1,9 e não 5,5`).
3. **Atribuição em aberto tratada como final.** Com o worker parado há semanas, um dia lido quando tinha 12 dias continua "em aberto": a finalidade vem de `coletado_em − dia ≥ 15`, nunca de `hoje − dia`. Testes: T5 (`atribuicaoFinal` e `worker parado`).
4. **403 de política confundido com token expirado.** 403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` → `sem_permissao`, sem retry, sem renovar; 401 → `sem_acesso`; 404 no advertiser ou lista sem MLB → `sem_advertiser`; 404 de um grupo → pula o grupo e mantém os dias gravados. Testes: T2 (`classificarResposta`) e T3 (quatro casos de parada + `404 de grupo`).
5. **Gasto sumindo ou zero falso: grupo `deleted`, dia sem linha, série furada.** Grupo que saiu do search mas tem gasto gravado é relido por id; 404 mantém os dias; nada é apagado fora da retenção. Gasto fora de qualquer grupo listado (`custo_resumo > custo_listado`) tira o "Lucro após Ads". Série com dia faltando é erro, 5 adiamentos fecham em `erro`, e o front só mostra zero com linha `cost: 0`; a despesa soma só dia coberto. A T7 prova Σ gravado = `custo_listado` e que o 2º run não mexe em dia com mais de 15 dias. Testes: T1 (`grupo fora do lote intacto`, `custos no sync`), T2 (`dia faltando → null`), T3 (`releitura de grupo fora do search`, `404 de grupo`, `5º adiamento`, `série furada`), T5 (`zero só com linha real`, `despesa só soma dia coberto`, `gasto fora dos grupos listados`).

---

### Task 1: Tabelas de Ads, RPCs de escrita, retenção e mapa MLB → código

> Migration/RLS → **opus**, sem rebaixar.

**Files:**
- Create: `supabase/migrations/<TS>_vendas_sku_ads.sql` (via `supabase migration new vendas_sku_ads`)
- Create: `supabase/tests/vendas_sku_ads.sql`
- Modify: `src/lib/database.types.ts` (blocos das 4 tabelas e das 6 funções novas)

**Interfaces:**
- Consumes: `public.organizations(id)`, `public.current_org_id()`, as tabelas-fonte de `vendas_sku_mlbs` (`ml_vendas_itens`, `anuncios_externos_itens`, `anuncios_externos`).
- Produces (usados por T3/T4/T5):
  - `ml_ads_sync(org_id uuid pk, advertiser_id bigint, estado text, erro text, rodada timestamptz, posse_ate timestamptz, iniciado_em timestamptz, cursor text, ultimo_ok_em timestamptz, ultimo_erro_em timestamptz, carga_inicial_ok boolean not null default false, cobertura_desde date, custo_resumo numeric, custo_listado numeric)`
  - `ml_ads_grupo(org_id, ad_group_id bigint, tipo text, external_id text, campaign_id bigint, status text, atualizado_em timestamptz)`, PK `(org_id, ad_group_id)`
  - `ml_ads_grupo_item(org_id, ad_group_id bigint, ml_item_id text, visto_em timestamptz)`, PK `(org_id, ad_group_id, ml_item_id)`
  - `ml_ads_grupo_dia(org_id, ad_group_id bigint, dia date, cost numeric, clicks int, prints int, direct_amount numeric, indirect_amount numeric, total_amount numeric, direct_units int, units int, coletado_em timestamptz)`, PK `(org_id, ad_group_id, dia)`
  - `reservar_ads_posse(p_org uuid) returns table(rodada timestamptz, cursor text)`
  - `avancar_ads_cursor(p_org uuid, p_rodada timestamptz, p_cursor_atual text, p_cursor_novo text) returns boolean`
  - `gravar_ads_lote(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_grupos jsonb) returns boolean` — `p_grupos`: `[{ad_group_id, tipo, external_id, campaign_id, status, itens: string[] | null, dias: [{dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units}]}]`; `itens` null **ou vazio** mantém o vínculo gravado; `false` = rodada não é a dona.
  - `concluir_ads_rodada(p_org uuid, p_rodada timestamptz, p_estado text, p_erro text default null, p_carga_concluida boolean default false, p_advertiser_id bigint default null, p_cobertura_desde date default null, p_custo_resumo numeric default null, p_custo_listado numeric default null) returns boolean` — com `ok`, grava `custo_resumo`/`custo_listado` da janela da rodada.
  - `limpar_ads_retencao(p_corte date) returns void`
  - `vendas_sku_codigos_mlbs(p_mlbs text[]) returns jsonb` — `{ "MLB…": ["cod", …] }`, só da org do chamador; MLB sem código fica fora do objeto. `execute` para `authenticated`.

- [ ] **Step 1: Criar o arquivo da migration**

Run: `supabase migration new vendas_sku_ads`
Expected: cria `supabase/migrations/<TS>_vendas_sku_ads.sql` vazio. Anote o `<TS>`.

- [ ] **Step 2: Escrever o teste SQL (RED)**

Create `supabase/tests/vendas_sku_ads.sql`:

```sql
\set ON_ERROR_STOP on
begin;
insert into public.organizations (id, nome, slug) values
  ('95000000-0000-0000-0000-000000000001', 'Ads test', 'ads-test'),
  ('95000000-0000-0000-0000-000000000002', 'Outra org ads', 'outra-org-ads');
insert into auth.users (id, email, raw_user_meta_data) values
  ('95000000-0000-0000-0000-000000000101', 'ads@test.local', '{"org_id":"95000000-0000-0000-0000-000000000001"}'::jsonb),
  ('95000000-0000-0000-0000-000000000102', 'outra-ads@test.local', '{"org_id":"95000000-0000-0000-0000-000000000002"}'::jsonb);
insert into public.profiles (id, org_id, is_active) values
  ('95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', true),
  ('95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', true)
on conflict (id) do update set org_id = excluded.org_id, is_active = true;
-- Mapa MLB → código (mesmas fontes de vendas_sku_mlbs): MLB1 legado multi-cor (A, B), MLB2 filho UP (A).
insert into public.anuncios_externos (id, user_id, org_id, canal, codigo_pai, item_externo_id, variacoes_externas, ml_item_id_anterior, migracao_pxv_snapshot) values
  ('95000000-0000-0000-0000-000000000601', '95000000-0000-0000-0000-000000000101', '95000000-0000-0000-0000-000000000001', 'mercado_livre', '09500000', 'MLB1', '{"A":{},"B":{}}'::jsonb, null, null),
  ('95000000-0000-0000-0000-000000000602', '95000000-0000-0000-0000-000000000102', '95000000-0000-0000-0000-000000000002', 'mercado_livre', '09500000', 'MLB1', '{"Z":{}}'::jsonb, null, null);
insert into public.anuncios_externos_itens (anuncio_externo_id, org_id, sku, status, item_externo_id) values
  ('95000000-0000-0000-0000-000000000601', '95000000-0000-0000-0000-000000000001', 'A', 'ativo', 'MLB2');

-- Grants: escrita só service_role; leitura do mapa só authenticated.
do $$
declare f text;
begin
  foreach f in array array[
    'public.reservar_ads_posse(uuid)', 'public.avancar_ads_cursor(uuid,timestamptz,text,text)',
    'public.gravar_ads_lote(uuid,timestamptz,timestamptz,jsonb)',
    'public.concluir_ads_rodada(uuid,timestamptz,text,text,boolean,bigint,date,numeric,numeric)',
    'public.limpar_ads_retencao(date)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('public', f, 'execute') then raise exception 'RPC exposta: %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'service_role sem execute: %', f; end if;
  end loop;
  if has_function_privilege('anon', 'public.vendas_sku_codigos_mlbs(text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.vendas_sku_codigos_mlbs(text[])', 'execute')
    then raise exception 'grants de vendas_sku_codigos_mlbs errados'; end if;
end $$;

set local role service_role;
do $$
declare
  r record; rod timestamptz;
  org1 uuid := '95000000-0000-0000-0000-000000000001';
  org2 uuid := '95000000-0000-0000-0000-000000000002';
  d1 text := '{"dia":"2026-09-25","cost":1.5,"clicks":3,"prints":400,"direct_amount":20,"indirect_amount":0,"total_amount":20,"direct_units":1,"units":1}';
  d2 text := '{"dia":"2026-09-26","cost":2.25,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":10,"total_amount":10,"direct_units":0,"units":1}';
begin
  -- Posse: 1ª reserva devolve rodada; 2ª com posse viva não devolve nada; CAS do cursor.
  select * into r from public.reservar_ads_posse(org1);
  if r.rodada is null or r.cursor is not null then raise exception 'reserva inicial errada: %', r; end if;
  if exists (select 1 from public.reservar_ads_posse(org1)) then raise exception 'abriu 2ª cadeia com posse viva'; end if;
  rod := r.rodada;
  if not public.avancar_ads_cursor(org1, rod, null, '3000001') then raise exception 'CAS null→3000001 falhou'; end if;
  if public.avancar_ads_cursor(org1, rod, null, '3000002') then raise exception 'CAS com cursor velho passou'; end if;

  -- Rodada que não é a dona não grava nada.
  if public.gravar_ads_lote(org1, rod - interval '1 day', '2026-09-27T14:00:00Z',
      ('[{"ad_group_id":3000001,"tipo":"ITEM","external_id":"MLB1","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1"],"dias":[' || d1 || ']}]')::jsonb)
    then raise exception 'gravou com rodada obsoleta'; end if;
  if exists (select 1 from public.ml_ads_grupo where org_id = org1) then raise exception 'rodada obsoleta deixou linha'; end if;

  -- Lote válido: FAMILY com 2 membros e 2 dias; ITEM fora de campanha (campaign_id 0).
  if not public.gravar_ads_lote(org1, rod, '2026-09-27T14:00:00Z', ('[
      {"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1","MLB2"],"dias":[' || d1 || ',' || d2 || ']},
      {"ad_group_id":3000002,"tipo":"ITEM","external_id":"MLB3","campaign_id":0,"status":"PAUSED","itens":["MLB3"],"dias":[' || d2 || ']}]')::jsonb)
    then raise exception 'lote válido recusado'; end if;
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'membros do FAMILY errados'; end if;
  if (select sum(cost) from public.ml_ads_grupo_dia where org_id = org1) <> 6.00 then raise exception 'soma de custo errada'; end if;

  -- O mais recente vence (atribuição revisada para BAIXO também vale); itens null mantém o vínculo.
  perform public.gravar_ads_lote(org1, rod, '2026-09-28T14:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":null,
       "dias":[{"dia":"2026-09-26","cost":2.25,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":5,"total_amount":5,"direct_units":0,"units":1}]}]');
  if (select total_amount from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001 and dia = '2026-09-26') <> 5
    then raise exception 'releitura mais nova não substituiu'; end if;
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens null apagou o vínculo'; end if;

  -- Leitura mais velha não sobrescreve dia, metadado nem vínculo.
  perform public.gravar_ads_lote(org1, rod, '2026-09-27T10:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"PAUSED","itens":["MLB9"],
       "dias":[{"dia":"2026-09-26","cost":9,"clicks":4,"prints":500,"direct_amount":0,"indirect_amount":99,"total_amount":99,"direct_units":0,"units":1}]}]');
  if (select total_amount from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001 and dia = '2026-09-26') <> 5
    then raise exception 'leitura velha sobrescreveu o dia'; end if;
  if exists (select 1 from public.ml_ads_grupo_item where org_id = org1 and ml_item_id = 'MLB9')
    then raise exception 'leitura velha trocou o vínculo'; end if;
  if (select status from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000001) <> 'ACTIVE'
    then raise exception 'leitura velha trocou o status'; end if;

  -- Grupo fora do lote (sumiu do search) fica intacto; itens [] (lista vazia do ML) NÃO apaga o vínculo.
  if not exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000002)
    then raise exception 'grupo fora do lote perdeu dias'; end if;
  perform public.gravar_ads_lote(org1, rod, '2026-09-29T14:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"EMPTY","itens":[],"dias":[]}]');
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens [] apagou o vínculo gravado'; end if;
  if (select count(*) from public.ml_ads_grupo_dia where org_id = org1 and ad_group_id = 3000001) <> 2
    then raise exception 'itens [] apagou dias'; end if;
  if (select status from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000001) <> 'EMPTY'
    then raise exception 'metadado mais novo não foi gravado'; end if;
  -- Lista nova não vazia substitui o vínculo (o worker só manda quando não é menor que o gravado).
  perform public.gravar_ads_lote(org1, rod, '2026-09-29T15:00:00Z',
    '[{"ad_group_id":3000001,"tipo":"FAMILY","external_id":"4000001","campaign_id":2000001,"status":"ACTIVE","itens":["MLB1","MLB2","MLB4"],"dias":[]}]');
  if (select count(*) from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000001) <> 3
    then raise exception 'lista nova não substituiu o vínculo'; end if;

  -- Checks de faixa e de tipo.
  begin
    insert into public.ml_ads_grupo_dia values (org1, 3000001, '2026-09-01', -1, 0, 0, 0, 0, 0, 0, 0, now());
    raise exception 'custo negativo passou';
  exception when check_violation then null; end;
  begin
    insert into public.ml_ads_grupo_dia values (org1, 3000001, '2026-09-01', 0, -1, 0, 0, 0, 0, 0, 0, now());
    raise exception 'cliques negativos passaram';
  exception when check_violation then null; end;
  begin
    insert into public.ml_ads_grupo values (org1, 1, 'OUTRO', null, null, 'X', now());
    raise exception 'tipo inválido passou';
  exception when check_violation then null; end;

  -- concluir: rodada obsoleta não fecha; ok fecha carga, grava advertiser e cobertura.
  if public.concluir_ads_rodada(org1, rod - interval '1 day', 'ok') then raise exception 'concluir obsoleto passou'; end if;
  if not public.concluir_ads_rodada(org1, rod, 'ok', null, true, 1000001, '2026-06-29', 100.00, 97.40) then raise exception 'concluir ok falhou'; end if;
  select * into r from public.ml_ads_sync where org_id = org1;
  if r.estado <> 'ok' or not r.carga_inicial_ok or r.cobertura_desde <> '2026-06-29' or r.advertiser_id <> 1000001
     or r.cursor is not null or r.posse_ate is not null or r.ultimo_ok_em is null
     or r.custo_resumo <> 100.00 or r.custo_listado <> 97.40 then raise exception 'concluir ok errado (custos no sync?): %', r; end if;
  -- Rodada diária seguinte não recua a cobertura.
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'ok', null, true, 1000001, '2026-09-12', 100.00, 97.40);
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) <> '2026-06-29' then raise exception 'cobertura recuou'; end if;
  -- Worker parado > 90 dias: a janela relida começa depois de "último ok − 14" → a cobertura avança (buraco ≠ zero).
  update public.ml_ads_sync set ultimo_ok_em = now() - interval '200 days' where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'ok', null, true, 1000001, current_date - 90, 100.00, 97.40);
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) <> current_date - 90
    then raise exception 'cobertura não avançou depois do buraco'; end if;
  -- sem_permissao: guarda o motivo e preserva ultimo_ok_em.
  select * into r from public.reservar_ads_posse(org1);
  perform public.concluir_ads_rodada(org1, r.rodada, 'sem_permissao', 'ML 403 em advertisers: sem permissão de Publicidade ou conexão recusada');
  select * into r from public.ml_ads_sync where org_id = org1;
  if r.estado <> 'sem_permissao' or r.erro is null or r.ultimo_erro_em is null or r.ultimo_ok_em is null
    then raise exception 'concluir sem_permissao errado: %', r; end if;
  if r.custo_resumo is null then raise exception 'rodada sem ok apagou os custos da última rodada ok'; end if;
  -- Carga inicial interrompida: a próxima rodada retoma o cursor.
  update public.ml_ads_sync set carga_inicial_ok = false where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  perform public.avancar_ads_cursor(org1, r.rodada, r.cursor, '3000005');
  update public.ml_ads_sync set posse_ate = now() - interval '1 minute' where org_id = org1;
  select * into r from public.reservar_ads_posse(org1);
  if r.cursor is distinct from '3000005' then raise exception 'não retomou o cursor da carga inicial: %', r; end if;

  -- Retenção: dia antes do corte sai; grupo velho sem dia retido sai com o vínculo (cascade).
  perform public.gravar_ads_lote(org1, r.rodada, '2026-01-01T00:00:00Z',
    '[{"ad_group_id":3000009,"tipo":"ITEM","external_id":"MLB8","campaign_id":0,"status":"IDLE","itens":["MLB8"],"dias":[]}]');
  perform public.limpar_ads_retencao('2026-09-26');
  if exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and dia < '2026-09-26') then raise exception 'retenção não apagou'; end if;
  if not exists (select 1 from public.ml_ads_grupo_dia where org_id = org1 and dia = '2026-09-26') then raise exception 'retenção apagou demais'; end if;
  if exists (select 1 from public.ml_ads_grupo where org_id = org1 and ad_group_id = 3000009) then raise exception 'grupo velho ficou'; end if;
  if exists (select 1 from public.ml_ads_grupo_item where org_id = org1 and ad_group_id = 3000009) then raise exception 'vínculo órfão ficou'; end if;
  if (select cobertura_desde from public.ml_ads_sync where org_id = org1) < '2026-09-26'
    then raise exception 'retenção apagou dias sem avançar a cobertura'; end if;

  -- Org 2 com dado próprio (não pode vazar para a org 1).
  select * into r from public.reservar_ads_posse(org2);
  perform public.gravar_ads_lote(org2, r.rodada, '2026-09-27T14:00:00Z',
    ('[{"ad_group_id":3000001,"tipo":"ITEM","external_id":"MLB1","campaign_id":0,"status":"ACTIVE","itens":["MLB1"],"dias":[' || d2 || ']}]')::jsonb);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"95000000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare m jsonb;
begin
  if (select count(*) from public.ml_ads_sync) <> 1 then raise exception 'RLS: viu sync de outra org'; end if;
  if exists (select 1 from public.ml_ads_grupo_dia where org_id <> '95000000-0000-0000-0000-000000000001')
    then raise exception 'RLS: viu dia de outra org'; end if;
  begin
    insert into public.ml_ads_sync (org_id, estado) values ('95000000-0000-0000-0000-000000000001', 'ok');
    raise exception 'authenticated inseriu';
  exception when insufficient_privilege then null; end;
  -- Mapa MLB → código de QUALQUER membro (inclusive o que não é do dossiê), só da própria org.
  m := public.vendas_sku_codigos_mlbs('{MLB1,MLB2,MLB7}');
  if m->'MLB1' is distinct from '["A","B"]'::jsonb then raise exception 'MLB1 errado (org 2 vazou?): %', m; end if;
  if m->'MLB2' is distinct from '["A"]'::jsonb then raise exception 'MLB2 errado: %', m; end if;
  if m ? 'MLB7' then raise exception 'MLB sem código entrou: %', m; end if;
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.ml_ads_grupo_dia;
    raise exception 'anon leu';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/vendas_sku_ads.sql`
Expected: FAIL com `function public.reservar_ads_posse(uuid) does not exist` (ou `relation "public.ml_ads_grupo" does not exist`).

- [ ] **Step 4: Escrever a migration**

Conteúdo de `supabase/migrations/<TS>_vendas_sku_ads.sql`:

```sql
-- Vendas SKU — Fatia 2c: Product Ads por grupo (ad_group_id). Só leitura no ML (spike 053).
-- Escrita só pelo worker coletar-ads-ml (service_role), pelas RPCs abaixo. Unidade = ad_group_id:
-- toda soma é por grupo; o vínculo grupo → MLB é só o atual (visto_em).

create table public.ml_ads_sync (
  org_id           uuid primary key references public.organizations(id) on delete cascade,
  advertiser_id    bigint,
  estado           text not null check (estado in ('sincronizando','ok','sem_permissao','sem_advertiser','sem_acesso','erro')),
  erro             text,
  rodada           timestamptz,   -- identidade da cadeia dona da posse (ms)
  posse_ate        timestamptz,   -- posse viva enquanto > now(); renovada a cada lote
  iniciado_em      timestamptz,
  cursor           text,          -- último ad_group_id gravado; null = início
  ultimo_ok_em     timestamptz,
  ultimo_erro_em   timestamptz,
  carga_inicial_ok boolean not null default false,  -- carga de 90 dias concluída
  cobertura_desde  date,          -- 1º dia coberto por coleta ok (carga inicial; avança com retenção/buraco)
  custo_resumo     numeric check (custo_resumo is null or custo_resumo >= 0),    -- metrics_summary.cost da última janela ok
  custo_listado    numeric check (custo_listado is null or custo_listado >= 0)   -- Σ cost dos grupos listados na mesma janela
);

create table public.ml_ads_grupo (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  ad_group_id   bigint not null,
  tipo          text not null check (tipo in ('ITEM','FAMILY','CATALOG')),
  external_id   text,             -- ITEM: MLB; FAMILY: family_id; CATALOG: parent_id
  campaign_id   bigint check (campaign_id is null or campaign_id >= 0),  -- 0 = fora de campanha hoje
  status        text not null,
  atualizado_em timestamptz not null,
  primary key (org_id, ad_group_id)
);

create table public.ml_ads_grupo_item (
  org_id      uuid not null,
  ad_group_id bigint not null,
  ml_item_id  text not null,
  visto_em    timestamptz not null,
  primary key (org_id, ad_group_id, ml_item_id),
  foreign key (org_id, ad_group_id) references public.ml_ads_grupo (org_id, ad_group_id) on delete cascade
);
-- Leitura do dossiê: grupos que tocam os MLBs do alvo.
create index ml_ads_grupo_item_mlb_idx on public.ml_ads_grupo_item (org_id, ml_item_id);

create table public.ml_ads_grupo_dia (
  org_id          uuid not null,
  ad_group_id     bigint not null,
  dia             date not null,
  cost            numeric not null check (cost >= 0),
  clicks          integer not null check (clicks >= 0),
  prints          integer not null check (prints >= 0),
  direct_amount   numeric not null check (direct_amount >= 0),
  indirect_amount numeric not null check (indirect_amount >= 0),
  total_amount    numeric not null check (total_amount >= 0),
  direct_units    integer not null check (direct_units >= 0),
  units           integer not null check (units >= 0),
  coletado_em     timestamptz not null,  -- define se a atribuição do dia já fechou (coletado_em − dia ≥ 15)
  primary key (org_id, ad_group_id, dia),
  foreign key (org_id, ad_group_id) references public.ml_ads_grupo (org_id, ad_group_id) on delete cascade
);
-- Releitura (grupos com gasto na janela) e retenção.
create index ml_ads_grupo_dia_org_dia_idx on public.ml_ads_grupo_dia (org_id, dia);

-- RLS: membro lê a própria org; escrita só service_role (precedente: 20260927084615_vendas_sku_trafego.sql).
alter table public.ml_ads_sync       enable row level security;
alter table public.ml_ads_grupo      enable row level security;
alter table public.ml_ads_grupo_item enable row level security;
alter table public.ml_ads_grupo_dia  enable row level security;
create policy "ml_ads_sync: select org"       on public.ml_ads_sync       for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo: select org"      on public.ml_ads_grupo      for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo_item: select org" on public.ml_ads_grupo_item for select to authenticated using (org_id = (select public.current_org_id()));
create policy "ml_ads_grupo_dia: select org"  on public.ml_ads_grupo_dia  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia from anon;
revoke insert, update, delete, truncate, references, trigger on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia from authenticated;
grant select on public.ml_ads_sync, public.ml_ads_grupo, public.ml_ads_grupo_item, public.ml_ads_grupo_dia to authenticated;

-- Contrato do worker (mesmo da 2b, estado próprio):
-- 1. Fan-out: reservar_ads_posse(org) → 1 linha {rodada, cursor} = posse tomada (cursor retomado se a carga
--    inicial não terminou); 0 linhas = posse viva de outra cadeia.
-- 2. Cada lote: gravar_ads_lote (false = não é a dona) e DEPOIS avancar_ads_cursor (CAS).
-- 3. Fim/parada: concluir_ads_rodada(org, rodada, estado, …) → false = rodada obsoleta. Sempre solta a posse.

create function public.reservar_ads_posse(p_org uuid)
returns table (rodada timestamptz, cursor text)
language sql security definer set search_path = '' as $$
  insert into public.ml_ads_sync as s (org_id, estado, rodada, posse_ate, iniciado_em)
  values (p_org, 'sincronizando', date_trunc('milliseconds', now()), now() + interval '10 minutes', now())
  on conflict (org_id) do update set
    estado = 'sincronizando', rodada = date_trunc('milliseconds', now()), posse_ate = now() + interval '10 minutes',
    iniciado_em = now(), erro = null,
    cursor = case when not s.carga_inicial_ok then s.cursor end
  where s.posse_ate is null or s.posse_ate <= now()
  returning s.rodada, s.cursor;
$$;

create function public.avancar_ads_cursor(p_org uuid, p_rodada timestamptz, p_cursor_atual text, p_cursor_novo text)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_ads_sync
       set cursor = p_cursor_novo, posse_ate = now() + interval '10 minutes'
     where org_id = p_org and rodada = p_rodada and cursor is not distinct from p_cursor_atual
    returning 1)
  select exists (select 1 from u);
$$;

-- p_grupos: [{ad_group_id, tipo, external_id, campaign_id, status, itens: [mlb]|null, dias: [...]}].
-- O mais recente vence por p_coletado_em (a atribuição muda por 14 dias, inclusive para baixo).
-- itens array não vazio = vínculo atual completo (substitui); null ou [] = mantém o gravado (lista vazia do
-- ML não apaga vínculo: o gasto do grupo sumiria do dossiê).
-- Grupo que não vem no lote não é tocado: nada é apagado quando um grupo some do search.
create function public.gravar_ads_lote(p_org uuid, p_rodada timestamptz, p_coletado_em timestamptz, p_grupos jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  g jsonb;
  v_id bigint;
begin
  perform 1 from public.ml_ads_sync s where s.org_id = p_org and s.rodada = p_rodada for update;
  if not found then return false; end if;
  for g in select e from jsonb_array_elements(p_grupos) as t(e) loop
    v_id := (g->>'ad_group_id')::bigint;
    if exists (select 1 from public.ml_ads_grupo a
                where a.org_id = p_org and a.ad_group_id = v_id and a.atualizado_em > p_coletado_em) then
      continue;
    end if;
    insert into public.ml_ads_grupo as a (org_id, ad_group_id, tipo, external_id, campaign_id, status, atualizado_em)
    values (p_org, v_id, g->>'tipo', g->>'external_id', (g->>'campaign_id')::bigint, g->>'status', p_coletado_em)
    on conflict (org_id, ad_group_id) do update
      set tipo = excluded.tipo, external_id = excluded.external_id, campaign_id = excluded.campaign_id,
          status = excluded.status, atualizado_em = excluded.atualizado_em;
    if jsonb_typeof(g->'itens') = 'array' and jsonb_array_length(g->'itens') > 0 then
      delete from public.ml_ads_grupo_item i
       where i.org_id = p_org and i.ad_group_id = v_id
         and not (i.ml_item_id in (select jsonb_array_elements_text(g->'itens')));
      insert into public.ml_ads_grupo_item (org_id, ad_group_id, ml_item_id, visto_em)
      select distinct p_org, v_id, x, p_coletado_em from jsonb_array_elements_text(g->'itens') as t(x)
      on conflict (org_id, ad_group_id, ml_item_id) do update set visto_em = excluded.visto_em;
    end if;
    insert into public.ml_ads_grupo_dia as a (org_id, ad_group_id, dia, cost, clicks, prints, direct_amount,
                                               indirect_amount, total_amount, direct_units, units, coletado_em)
    select distinct on (x.dia) p_org, v_id, x.dia, x.cost, x.clicks, x.prints, x.direct_amount,
           x.indirect_amount, x.total_amount, x.direct_units, x.units, p_coletado_em
      from jsonb_to_recordset(coalesce(g->'dias', '[]'::jsonb)) as x(dia date, cost numeric, clicks integer,
           prints integer, direct_amount numeric, indirect_amount numeric, total_amount numeric,
           direct_units integer, units integer)
     order by x.dia
    on conflict (org_id, ad_group_id, dia) do update
      set cost = excluded.cost, clicks = excluded.clicks, prints = excluded.prints,
          direct_amount = excluded.direct_amount, indirect_amount = excluded.indirect_amount,
          total_amount = excluded.total_amount, direct_units = excluded.direct_units, units = excluded.units,
          coletado_em = excluded.coletado_em
      where excluded.coletado_em >= a.coletado_em;
  end loop;
  return true;
end $$;

-- Fecha a rodada (só a dona). ok → ultimo_ok_em, custo_resumo e custo_listado da janela; outro estado →
-- ultimo_erro_em + erro (ultimo_ok_em e os custos da última rodada ok ficam).
-- p_carga_concluida → carga_inicial_ok, cursor zerado e cobertura_desde: a 1ª carga a define; depois ela só
-- avança se a janela relida (p_cobertura_desde) começou depois de "último ok − 14" — worker parado > 90 dias
-- deixou buraco que não pode virar zero. `ultimo_ok_em` no SET é o valor anterior ao update.
-- Sempre solta a posse.
create function public.concluir_ads_rodada(p_org uuid, p_rodada timestamptz, p_estado text, p_erro text default null,
                                           p_carga_concluida boolean default false, p_advertiser_id bigint default null,
                                           p_cobertura_desde date default null, p_custo_resumo numeric default null,
                                           p_custo_listado numeric default null)
returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.ml_ads_sync
       set estado = p_estado,
           posse_ate = null,
           advertiser_id = coalesce(p_advertiser_id, advertiser_id),
           ultimo_ok_em = case when p_estado = 'ok' then now() else ultimo_ok_em end,
           ultimo_erro_em = case when p_estado <> 'ok' then now() else ultimo_erro_em end,
           erro = case when p_estado <> 'ok' then p_erro end,
           custo_resumo = case when p_estado = 'ok' then p_custo_resumo else custo_resumo end,
           custo_listado = case when p_estado = 'ok' then p_custo_listado else custo_listado end,
           carga_inicial_ok = carga_inicial_ok or p_carga_concluida,
           cobertura_desde = case
             when not p_carga_concluida then cobertura_desde
             when cobertura_desde is null then p_cobertura_desde
             when ultimo_ok_em is not null
                  and p_cobertura_desde > (ultimo_ok_em at time zone 'America/Sao_Paulo')::date - 14 then p_cobertura_desde
             else cobertura_desde end,
           cursor = case when p_carga_concluida then null else cursor end
     where org_id = p_org and rodada = p_rodada
    returning 1)
  select exists (select 1 from u);
$$;

-- Retenção de 13 meses (corte calculado pelo worker, corteRetencao). Grupo sem dia retido e sem leitura
-- desde o corte sai com o vínculo (cascade). A cobertura avança junto: dia apagado não pode virar
-- "zero comprovado" no dossiê.
create function public.limpar_ads_retencao(p_corte date)
returns void
language sql security definer set search_path = '' as $$
  delete from public.ml_ads_grupo_dia where dia < p_corte;
  update public.ml_ads_sync set cobertura_desde = p_corte where cobertura_desde < p_corte;
  delete from public.ml_ads_grupo g
   where g.atualizado_em < p_corte
     and not exists (select 1 from public.ml_ads_grupo_dia d where d.org_id = g.org_id and d.ad_group_id = g.ad_group_id);
$$;

-- Leitura do dossiê: códigos de MLBs arbitrários (membros de um grupo de Ads), mesma UNION de
-- vendas_sku_mlbs (20260927045118_vendas_sku_dossie.sql, CTE `pares`), sem familias.ml_item_id (spike 053 §4).
-- MLB sem código resolvido fica fora do objeto: no front ele impede a exclusividade do grupo.
create function public.vendas_sku_codigos_mlbs(p_mlbs text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with org as (select public.current_org_id() as id),
  pares as (
    select i.ml_item_id as mlb, i.codigo from public.ml_vendas_itens i cross join org
     where i.org_id = org.id and i.ml_item_id = any (p_mlbs) and coalesce(i.codigo, '') <> ''
    union
    select x.item_externo_id, x.sku from public.anuncios_externos_itens x cross join org
     where x.org_id = org.id and x.item_externo_id = any (p_mlbs) and coalesce(x.sku, '') <> ''
    union
    select a.item_externo_id, k.codigo from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_object_keys(
        case when jsonb_typeof(a.variacoes_externas) = 'object' then a.variacoes_externas else '{}'::jsonb end
      ) as k(codigo)
     where a.org_id = org.id and a.item_externo_id = any (p_mlbs)
    union
    select a.ml_item_id_anterior, e.v ->> 'sku' from public.anuncios_externos a
      cross join org
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(a.migracao_pxv_snapshot) = 'array' then a.migracao_pxv_snapshot else '[]'::jsonb end
      ) as e(v)
     where a.org_id = org.id and a.ml_item_id_anterior = any (p_mlbs)
       and coalesce(e.v ->> 'sku', '') <> ''
  )
  select coalesce(jsonb_object_agg(g.mlb, g.codigos), '{}'::jsonb)
  from (
    select p.mlb, to_jsonb(array_agg(distinct p.codigo order by p.codigo)) as codigos
    from pares p group by p.mlb
  ) g
$$;

revoke all on function public.reservar_ads_posse(uuid)                                   from public, anon, authenticated;
revoke all on function public.avancar_ads_cursor(uuid, timestamptz, text, text)          from public, anon, authenticated;
revoke all on function public.gravar_ads_lote(uuid, timestamptz, timestamptz, jsonb)     from public, anon, authenticated;
revoke all on function public.concluir_ads_rodada(uuid, timestamptz, text, text, boolean, bigint, date, numeric, numeric) from public, anon, authenticated;
revoke all on function public.limpar_ads_retencao(date)                                   from public, anon, authenticated;
grant execute on function public.reservar_ads_posse(uuid)                                to service_role;
grant execute on function public.avancar_ads_cursor(uuid, timestamptz, text, text)       to service_role;
grant execute on function public.gravar_ads_lote(uuid, timestamptz, timestamptz, jsonb)  to service_role;
grant execute on function public.concluir_ads_rodada(uuid, timestamptz, text, text, boolean, bigint, date, numeric, numeric) to service_role;
grant execute on function public.limpar_ads_retencao(date)                                to service_role;
revoke all on function public.vendas_sku_codigos_mlbs(text[]) from public, anon;
grant execute on function public.vendas_sku_codigos_mlbs(text[]) to authenticated;
```

- [ ] **Step 5: Aplicar no Postgres LOCAL e rodar o teste (GREEN)**

Run: `docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/<TS>_vendas_sku_ads.sql`
Run: `docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < supabase/tests/vendas_sku_ads.sql`
Expected: termina em `ROLLBACK` sem `ERROR`. Rodar também `supabase/tests/vendas_sku_dossie.sql` e `supabase/tests/vendas_sku_trafego.sql` (nada regrediu).

- [ ] **Step 6: Tipos do front**

Run: `supabase gen types typescript --local > /tmp/types-ads.ts`
Copiar de `/tmp/types-ads.ts` para `src/lib/database.types.ts` **só** os blocos `ml_ads_grupo`, `ml_ads_grupo_dia`, `ml_ads_grupo_item`, `ml_ads_sync` (em `Tables`, na ordem alfabética) e `avancar_ads_cursor`, `concluir_ads_rodada`, `gravar_ads_lote`, `limpar_ads_retencao`, `reservar_ads_posse`, `vendas_sku_codigos_mlbs` (em `Functions`). Não substituir o arquivo inteiro (pode haver deriva local).
Run: `pnpm preflight:static`
Expected: PASS.

- [ ] **Step 7: Commit**

Escrever em `$JOB_TMP/commit-2c-t1.txt`:
```
feat(vendas-sku): tabelas de Ads por grupo com RLS, posse e mapa MLB → código

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run (um por vez): `/usr/bin/git add supabase/migrations/<TS>_vendas_sku_ads.sql supabase/tests/vendas_sku_ads.sql src/lib/database.types.ts` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t1.txt` (caminho absoluto literal).

---

### Task 2: Lib pura — janelas, classificação de erro e parsers de Ads

**Files:**
- Create: `supabase/functions/_shared/ads/janelas.ts`, `supabase/functions/_shared/ads/parsers.ts`
- Test: `supabase/functions/_shared/ads/__tests__/janelas.test.ts`, `supabase/functions/_shared/ads/__tests__/parsers.test.ts`

**Interfaces:**
- Consumes: `DAY_MS` de `supabase/functions/_shared/trafego/janelas.ts`.
- Produces:
  - `interface JanelaAds { desde: string; ate: string }`; `DIAS_CARGA = 90`; `DIAS_RELEITURA = 15`
  - `janelaAds(p: { hoje: string; cargaInicialOk: boolean; ultimoOkDia: string | null }): JanelaAds`
  - `type TipoGrupo = 'ITEM' | 'FAMILY' | 'CATALOG'`
  - `interface GrupoBusca { ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string; cost: number }`
  - `interface DiaAds { dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number; total_amount: number; direct_units: number; units: number }`
  - `type ClasseResposta = 'ok' | 'sem_acesso' | 'sem_permissao' | 'nao_encontrado' | 'transitorio' | 'erro'`
  - `classificarResposta(r: { status: number }): ClasseResposta`
  - `parseAdvertiser(corpo: unknown): number | null`
  - `parseBuscaGrupos(corpo: unknown): { total: number; grupos: GrupoBusca[]; custoResumo: number | null } | null`
  - `parseSerieGrupo(corpo: unknown, janela: JanelaAds): DiaAds[] | null`
  - `parseMembros(corpo: unknown): { total: number; itens: string[] } | null`

- [ ] **Step 1: Escrever os testes (RED)**

Create `supabase/functions/_shared/ads/__tests__/janelas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../trafego/janelas.ts';
import { janelaAds } from '../janelas.ts';

const dias = (j: { desde: string; ate: string }) => (Date.parse(j.ate) - Date.parse(j.desde)) / DAY_MS + 1;

describe('janelaAds', () => {
  it('carga inicial: 90 dias terminando ontem (a janela aceita no spike 053: 29/06–26/09 em 27/09)', () => {
    const j = janelaAds({ hoje: '2026-09-27', cargaInicialOk: false, ultimoOkDia: null });
    expect(j).toEqual({ desde: '2026-06-29', ate: '2026-09-26' });
    expect(dias(j)).toBe(90);
  });
  it('dia a dia: D-1 + 14 dias de releitura da atribuição; hoje nunca entra', () => {
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-09-26' })).toEqual({ desde: '2026-09-12', ate: '2026-09-26' });
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: null })).toEqual({ desde: '2026-09-12', ate: '2026-09-26' });
  });
  it('worker parado: estende até o último ok − 14 (dias ainda em aberto naquela leitura)', () => {
    expect(janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-09-01' })).toEqual({ desde: '2026-08-18', ate: '2026-09-26' });
  });
  it('nunca passa de 90 dias (acima disso o ML devolve 400)', () => {
    const j = janelaAds({ hoje: '2026-09-27', cargaInicialOk: true, ultimoOkDia: '2026-05-01' });
    expect(j).toEqual({ desde: '2026-06-29', ate: '2026-09-26' });
    expect(dias(j)).toBeLessThanOrEqual(90);
  });
});
```

Create `supabase/functions/_shared/ads/__tests__/parsers.test.ts` (números inventados; nenhum valor real de cliente):

```ts
import { describe, expect, it } from 'vitest';
import { classificarResposta, parseAdvertiser, parseBuscaGrupos, parseMembros, parseSerieGrupo } from '../parsers.ts';

const JANELA = { desde: '2026-09-12', ate: '2026-09-26' };
/** Os 15 dias da janela (a série do ML é densa: toda resposta válida traz todos). */
const DIAS = Array.from({ length: 15 }, (_, i) => `2026-09-${String(12 + i).padStart(2, '0')}`);
const linha = (date: string, o: Record<string, unknown> = {}) => ({
  date, clicks: 3, prints: 400, cost: 1.5, cpc: 0.5, ctr: 0.75, direct_amount: 20, indirect_amount: 0, total_amount: 20,
  direct_units_quantity: 1, units_quantity: 1, organic_units_quantity: 0, acos: 7.5, roas: 13.33, sov: 100, ...o,
});

describe('classificarResposta', () => {
  it('403 PolicyAgent é falta de permissão, nunca token expirado; 401 é acesso; 404 é recurso ausente', () => {
    expect(classificarResposta({ status: 200 })).toBe('ok');
    expect(classificarResposta({ status: 401 })).toBe('sem_acesso');
    expect(classificarResposta({ status: 403 })).toBe('sem_permissao');
    expect(classificarResposta({ status: 404 })).toBe('nao_encontrado');
    expect(classificarResposta({ status: 429 })).toBe('transitorio');
    expect(classificarResposta({ status: 503 })).toBe('transitorio');
    expect(classificarResposta({ status: 400 })).toBe('erro');
  });
});

describe('parseAdvertiser', () => {
  it('escolhe o anunciante do site MLB', () => {
    expect(parseAdvertiser({ advertisers: [
      { advertiser_id: 1000002, site_id: 'MLA', advertiser_name: '***' },
      { advertiser_id: 1000001, site_id: 'MLB', advertiser_name: '***', account_name: '***' },
    ] })).toBe(1000001);
  });
  it('lista vazia, sem MLB ou malformada → null (sem_advertiser)', () => {
    expect(parseAdvertiser({ advertisers: [] })).toBeNull();
    expect(parseAdvertiser({ advertisers: [{ advertiser_id: 1000002, site_id: 'MLA' }] })).toBeNull();
    expect(parseAdvertiser({ advertisers: [{ advertiser_id: '1000001', site_id: 'MLB' }] })).toBeNull();
    expect(parseAdvertiser(null)).toBeNull();
  });
});

describe('parseBuscaGrupos', () => {
  const corpo = {
    paging: { offset: 0, total: 3, limit: 100 },
    results: [
      { id: 3000001, ad_group_type: 'FAMILY', ad_group_external_id: '4000001', campaign_id: 2000001, status: 'ACTIVE',
        catalog_listing: false, current_advertiser_id: 1000001, metrics: { cost: 12.5, clicks: 7, roas: 3.1 } },
      { id: 3000002, ad_group_type: 'ITEM', ad_group_external_id: 'MLB1000000002', campaign_id: 0, status: 'EMPTY', metrics: { cost: 0 } },
      { id: 3000003, ad_group_type: 'CATALOG', ad_group_external_id: 4000003, campaign_id: 2000001, status: 'PAUSED', metrics: { cost: 3.25 } },
    ],
    metrics_summary: { cost: 16.0, roas: 2.2 },
  };
  it('lê grupos, total da paginação e o resumo de custo', () => {
    expect(parseBuscaGrupos(corpo)).toEqual({
      total: 3, custoResumo: 16,
      grupos: [
        { ad_group_id: 3000001, tipo: 'FAMILY', external_id: '4000001', campaign_id: 2000001, status: 'ACTIVE', cost: 12.5 },
        { ad_group_id: 3000002, tipo: 'ITEM', external_id: 'MLB1000000002', campaign_id: 0, status: 'EMPTY', cost: 0 },
        { ad_group_id: 3000003, tipo: 'CATALOG', external_id: '4000003', campaign_id: 2000001, status: 'PAUSED', cost: 3.25 },
      ],
    });
  });
  it('status fora da lista conhecida (ex.: ARCHIVED) é mantido como veio: o grupo não some da leitura', () => {
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], status: 'ARCHIVED' }] })?.grupos[0].status).toBe('ARCHIVED');
  });
  it('sem metrics_summary → custoResumo null', () => {
    expect(parseBuscaGrupos({ ...corpo, metrics_summary: undefined })?.custoResumo).toBeNull();
  });
  it('tipo desconhecido, custo negativo ou sem paging → null', () => {
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], ad_group_type: 'BRAND' }] })).toBeNull();
    expect(parseBuscaGrupos({ ...corpo, results: [{ ...corpo.results[0], metrics: { cost: -1 } }] })).toBeNull();
    expect(parseBuscaGrupos({ results: corpo.results })).toBeNull();
  });
});

describe('parseSerieGrupo', () => {
  const completa = (o: (d: string) => Record<string, unknown> = () => ({})) => ({ results: DIAS.map((d) => linha(d, o(d))) });
  it('lê a série densa, ordena por dia e descarta os percentuais da API (acos/roas/cpc)', () => {
    const dias = parseSerieGrupo({ results: [...DIAS].reverse().map((d) => linha(d)) }, JANELA);
    expect(dias).toHaveLength(15);
    expect(dias![0]).toEqual({ dia: '2026-09-12', cost: 1.5, clicks: 3, prints: 400, direct_amount: 20, indirect_amount: 0, total_amount: 20, direct_units: 1, units: 1 });
    expect(dias!.some((d) => 'roas' in d || 'cpc' in d || 'acos' in d)).toBe(false);
  });
  it('zero explícito do ML vira linha com cost 0', () => {
    const dias = parseSerieGrupo(completa((d) => (d === '2026-09-25'
      ? { cost: 0, clicks: 0, direct_amount: 0, total_amount: 0, direct_units_quantity: 0, units_quantity: 0 } : {})), JANELA);
    expect(dias!.find((d) => d.dia === '2026-09-25')).toMatchObject({ cost: 0, clicks: 0, total_amount: 0 });
  });
  it('dia da janela faltando → null (série furada: nunca vira zero nem é gravada pela metade)', () => {
    expect(parseSerieGrupo({ results: DIAS.slice(1).map((d) => linha(d)) }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [] }, JANELA)).toBeNull();
  });
  it('dia fora da janela (inclusive hoje, parcial), repetido, negativo ou campo ausente → null', () => {
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-27')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-11')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: [...DIAS.map((d) => linha(d)), linha('2026-09-26')] }, JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { cost: -0.01 } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { units_quantity: undefined } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo(completa((d) => (d === '2026-09-26' ? { clicks: 1.5 } : {})), JANELA)).toBeNull();
    expect(parseSerieGrupo({ results: 'x' }, JANELA)).toBeNull();
  });
});

describe('parseMembros', () => {
  it('lê os MLBs e o total', () => {
    expect(parseMembros({ paging: { total: 2, offset: 0, limit: 100 }, results: [
      { item_id: 'MLB1000000001', ad_group_id: 3000001, family_id: 4000001, user_product_id: 'MLBU1000000001', metrics: { cost: 9 } },
      { item_id: 'MLB1000000003', ad_group_id: 3000001 },
    ] })).toEqual({ total: 2, itens: ['MLB1000000001', 'MLB1000000003'] });
  });
  it('item que não é MLB ou sem paging → null', () => {
    expect(parseMembros({ paging: { total: 1 }, results: [{ item_id: 'MLBU1000000001' }] })).toBeNull();
    expect(parseMembros({ results: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/janelas.test.ts supabase/functions/_shared/ads/__tests__/parsers.test.ts`
Expected: FAIL com `Failed to resolve import "../janelas.ts"` / `"../parsers.ts"`.

- [ ] **Step 3: Implementar**

Create `supabase/functions/_shared/ads/janelas.ts`:

```ts
// Janela de coleta de Ads (Fatia 2c, spike 053). Dia = data literal do ML (BRT, "10:00 GMT-3").
// Carga inicial: [hoje−90, hoje−1] — o máximo aceito (> 90 dias → 400). Dia a dia: [hoje−15, hoje−1]
// (D-1 + 14 dias de releitura, porque as vendas atribuídas mudam por 14 dias). Hoje nunca: o ML já o
// devolve parcial.
import { DAY_MS } from '../trafego/janelas.ts';

export const DIAS_CARGA = 90;
export const DIAS_RELEITURA = 15;

export interface JanelaAds { desde: string; ate: string }

const somar = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function janelaAds(p: { hoje: string; cargaInicialOk: boolean; ultimoOkDia: string | null }): JanelaAds {
  const ate = somar(p.hoje, -1);
  const minimo = somar(p.hoje, -DIAS_CARGA);
  if (!p.cargaInicialOk) return { desde: minimo, ate };
  let desde = somar(p.hoje, -DIAS_RELEITURA);
  // Worker parado: na última leitura ok (dia U) os dias ≥ U−14 ainda estavam em aberto.
  if (p.ultimoOkDia) {
    const doUltimo = somar(p.ultimoOkDia, -(DIAS_RELEITURA - 1));
    if (doUltimo < desde) desde = doUltimo;
  }
  return { desde: desde < minimo ? minimo : desde, ate };
}
```

Create `supabase/functions/_shared/ads/parsers.ts`:

```ts
// Parsers puros das respostas de Product Ads (spike 053 §3). Nunca lançam: resposta fora do contrato →
// null (a orquestração trata como erro da rodada; dado de dinheiro não é inventado nem completado).
// Os percentuais da API (acos, roas, cpc, ctr, cvr, sov, tacos) são descartados: o front recalcula por Σ.
export type TipoGrupo = 'ITEM' | 'FAMILY' | 'CATALOG';

export interface GrupoBusca {
  ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string; cost: number;
}
export interface DiaAds {
  dia: string; cost: number; clicks: number; prints: number; direct_amount: number; indirect_amount: number;
  total_amount: number; direct_units: number; units: number;
}
export type ClasseResposta = 'ok' | 'sem_acesso' | 'sem_permissao' | 'nao_encontrado' | 'transitorio' | 'erro';

const TIPOS = new Set<string>(['ITEM', 'FAMILY', 'CATALOG']);
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MLB_RE = /^MLB\d+$/;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const naoNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const inteiro = (v: unknown): v is number => naoNeg(v) && Number.isInteger(v);
const idPositivo = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

export function classificarResposta(r: { status: number }): ClasseResposta {
  if (r.status >= 200 && r.status < 300) return 'ok';
  if (r.status === 401) return 'sem_acesso';
  // 403 PolicyAgent (PA_UNAUTHORIZED_RESULT_FROM_POLICIES): o mesmo corpo vem com bearer malformado e com
  // o app sem a permissão. Nunca é "token expirado": não renova, não repete.
  if (r.status === 403) return 'sem_permissao';
  if (r.status === 404) return 'nao_encontrado';
  if (r.status === 429 || r.status >= 500) return 'transitorio';
  return 'erro';
}

/** `GET /advertising/advertisers?product_id=PADS` → id do anunciante MLB; null = sem anunciante. */
export function parseAdvertiser(corpo: unknown): number | null {
  if (!obj(corpo) || !Array.isArray(corpo.advertisers)) return null;
  for (const a of corpo.advertisers) if (obj(a) && a.site_id === 'MLB') return idPositivo(a.advertiser_id);
  return null;
}

/** `…/ad_groups/search` (uma página). */
export function parseBuscaGrupos(corpo: unknown): { total: number; grupos: GrupoBusca[]; custoResumo: number | null } | null {
  if (!obj(corpo) || !obj(corpo.paging) || !Array.isArray(corpo.results)) return null;
  const total = corpo.paging.total;
  if (!inteiro(total)) return null;
  const grupos: GrupoBusca[] = [];
  for (const g of corpo.results) {
    if (!obj(g) || !obj(g.metrics)) return null;
    const id = idPositivo(g.id);
    const tipo = g.ad_group_type;
    const ext = g.ad_group_external_id;
    const campanha = g.campaign_id;
    const status = g.status;
    const cost = g.metrics.cost;
    if (id == null || typeof tipo !== 'string' || !TIPOS.has(tipo) || typeof status !== 'string' || !naoNeg(cost)) return null;
    if (ext != null && typeof ext !== 'string' && typeof ext !== 'number') return null;
    if (campanha != null && !inteiro(campanha)) return null;
    grupos.push({
      ad_group_id: id, tipo: tipo as TipoGrupo, external_id: ext == null ? null : String(ext),
      campaign_id: campanha == null ? null : campanha, status, cost,
    });
  }
  const resumo = obj(corpo.metrics_summary) ? corpo.metrics_summary.cost : null;
  return { total, grupos, custoResumo: naoNeg(resumo) ? resumo : null };
}

const DIA_MS = 86_400_000;
const diasNaJanela = (j: { desde: string; ate: string }) =>
  Math.round((Date.parse(`${j.ate}T00:00:00Z`) - Date.parse(`${j.desde}T00:00:00Z`)) / DIA_MS) + 1;

/**
 * `…/ad_groups/{id}?aggregation_type=daily`. A série é densa (zero vem explícito): resposta válida traz
 * TODOS os dias da janela. Dia faltando, fora da janela (inclusive hoje), repetido ou com campo inválido
 * → null (a rodada vira erro; nada é gravado pela metade nem completado com zero).
 */
export function parseSerieGrupo(corpo: unknown, janela: { desde: string; ate: string }): DiaAds[] | null {
  if (!obj(corpo) || !Array.isArray(corpo.results)) return null;
  const porDia = new Map<string, DiaAds>();
  for (const r of corpo.results) {
    if (!obj(r) || typeof r.date !== 'string') return null;
    const dia = r.date.slice(0, 10);
    if (!DIA_RE.test(dia) || dia < janela.desde || dia > janela.ate || porDia.has(dia)) return null;
    const cost = r.cost; const clicks = r.clicks; const prints = r.prints;
    const direto = r.direct_amount; const indireto = r.indirect_amount; const total = r.total_amount;
    const unidadesDiretas = r.direct_units_quantity; const unidades = r.units_quantity;
    if (!naoNeg(cost) || !inteiro(clicks) || !inteiro(prints) || !naoNeg(direto) || !naoNeg(indireto)
      || !naoNeg(total) || !inteiro(unidadesDiretas) || !inteiro(unidades)) return null;
    porDia.set(dia, {
      dia, cost, clicks, prints, direct_amount: direto, indirect_amount: indireto, total_amount: total,
      direct_units: unidadesDiretas, units: unidades,
    });
  }
  if (porDia.size !== diasNaJanela(janela)) return null;
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** `…/ad_groups/{id}/ads` (uma página): os MLBs membros atuais. As métricas por MLB não são lidas (R2). */
export function parseMembros(corpo: unknown): { total: number; itens: string[] } | null {
  if (!obj(corpo) || !obj(corpo.paging) || !Array.isArray(corpo.results)) return null;
  const total = corpo.paging.total;
  if (!inteiro(total)) return null;
  const itens: string[] = [];
  for (const r of corpo.results) {
    const item = obj(r) ? r.item_id : null;
    if (typeof item !== 'string' || !MLB_RE.test(item)) return null;
    itens.push(item);
  }
  return { total, itens };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/janelas.test.ts supabase/functions/_shared/ads/__tests__/parsers.test.ts`
Expected: PASS. Depois `pnpm preflight:static` → PASS.

- [ ] **Step 5: Commit**

`$JOB_TMP/commit-2c-t2.txt`:
```
feat(vendas-sku): lib pura de janelas, classificação de erro e parsers de Ads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add supabase/functions/_shared/ads/janelas.ts supabase/functions/_shared/ads/parsers.ts supabase/functions/_shared/ads/__tests__/janelas.test.ts supabase/functions/_shared/ads/__tests__/parsers.test.ts` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t2.txt`

---

### Task 3: Orquestração pura `sincronizarAdsOrg`

**Files:**
- Create: `supabase/functions/_shared/ads/sincronizar.ts`
- Test: `supabase/functions/_shared/ads/__tests__/sincronizar.test.ts`

**Interfaces:**
- Consumes: T2 (`janelaAds`, `classificarResposta`, `parseAdvertiser`, `parseBuscaGrupos`, `parseSerieGrupo`, `parseMembros`, tipos); `emParalelo` de `../promocoes/sincronizar.ts`; `diaDeHoje` de `../trafego/janelas.ts`; `TIMEOUT_ML_MS` de `../trafego/fiacao.ts`; `MsgTrafego`, `RespostaML` de `../trafego/sincronizar.ts`.
- Produces (T4 liga):
  - `type EstadoParada = 'sem_acesso' | 'sem_permissao' | 'sem_advertiser'`; `class ParadaAds extends Error { estado: EstadoParada }`
  - `type MsgAds = MsgTrafego`; `type ResultadoAds = 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso'`
  - `interface GrupoConhecido { ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string }`
  - `interface GrupoGravar extends GrupoConhecido { itens: string[] | null; dias: DiaAds[] }`
  - `interface ExtraConcluir { cargaConcluida: boolean; advertiserId: number | null; coberturaDesde: string | null; custoResumo: number | null; custoListado: number | null }`
  - `interface DepsAds` (abaixo; inclui `contarVinculos(ids: number[]): Promise<Map<number, number>>`) e `sincronizarAdsOrg(deps: DepsAds, msg: MsgAds, cfg?): Promise<{ resultado: ResultadoAds }>`

- [ ] **Step 1: Escrever os testes (RED)**

Create `supabase/functions/_shared/ads/__tests__/sincronizar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ParadaAds, sincronizarAdsOrg, type DepsAds, type GrupoGravar } from '../sincronizar.ts';
import type { RespostaML } from '../../trafego/sincronizar.ts';

const T0 = Date.parse('2026-09-27T15:00:00Z'); // 12:00 BRT → hoje = 2026-09-27
const RODADA = '2026-09-27T14:17:00.123Z';
const ORG = 'org-1';
const JANELA_DIARIA = { desde: '2026-09-12', ate: '2026-09-26' };
const JANELA_90 = { desde: '2026-06-29', ate: '2026-09-26' };
const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
const http = (status: number, corpo: unknown = null, retryAfterMs: number | null = null): RespostaML => ({ status, retryAfterMs, corpo });
const grupo = (id: number, tipo: 'ITEM' | 'FAMILY' | 'CATALOG' = 'FAMILY', cost = 10, status = 'ACTIVE') => ({
  id, ad_group_type: tipo, ad_group_external_id: tipo === 'ITEM' ? `MLB${id}` : String(4000000 + id),
  campaign_id: 2000001, status, metrics: { cost },
});
const busca = (grupos: unknown[], total = grupos.length) => ok({ paging: { offset: 0, total, limit: 100 }, results: grupos, metrics_summary: { cost: 99 } });
/** Série densa: uma linha por dia da janela pedida (o parser recusa série furada). */
function diasDe(j: { desde: string; ate: string }): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${j.desde}T00:00:00Z`); t <= Date.parse(`${j.ate}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const serie = (j: { desde: string; ate: string }) => ok({ results: diasDe(j).map((date) => ({
  date, clicks: 2, prints: 100, cost: 1.25, cpc: 0.62, direct_amount: 10, indirect_amount: 0, total_amount: 10,
  direct_units_quantity: 1, units_quantity: 1, acos: 12.5, roas: 8,
})) });
const membros = (itens: string[], total = itens.length) =>
  ok({ paging: { total, offset: 0, limit: 100 }, results: itens.map((item_id) => ({ item_id })) });
const DIA = { cost: 1.25, clicks: 2, prints: 100, direct_amount: 10, indirect_amount: 0, total_amount: 10, direct_units: 1, units: 1 };

type Fake = DepsAds & Record<keyof DepsAds, ReturnType<typeof vi.fn>> & { relogio: { t: number } };
function fake(o: Partial<DepsAds> = {}): Fake {
  const relogio = { t: T0 };
  return {
    relogio,
    agora: vi.fn(() => relogio.t),
    esperar: vi.fn(async (ms: number) => { relogio.t += ms; }),
    reservarPosse: vi.fn(async () => ({ rodada: RODADA, cursor: null })),
    avancarCursor: vi.fn(async () => true),
    lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: true, ultimoOkEm: '2026-09-26T14:20:00Z' })),
    lerGruposComGasto: vi.fn(async () => []),
    contarVinculos: vi.fn(async () => new Map<number, number>()),
    buscarAdvertiser: vi.fn(async () => ok({ advertisers: [{ advertiser_id: 1000001, site_id: 'MLB' }] })),
    buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY'), grupo(13, 'CATALOG', 0)])),
    buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) => serie(j)),
    buscarMembros: vi.fn(async () => membros(['MLB21', 'MLB22'])),
    gravarLote: vi.fn(async () => true),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    ...o,
  } as Fake;
}
const primeira = { org_id: ORG, primeira: true };
const gravados = (d: Fake): GrupoGravar[] => d.gravarLote.mock.calls.flatMap((c) => c[2] as GrupoGravar[]);
const lidos = (d: Fake) => d.buscarSerieGrupo.mock.calls.map((c) => c[0]);
const PARADA = { cargaConcluida: false, coberturaDesde: null, custoResumo: null, custoListado: null };

describe('sincronizarAdsOrg', () => {
  it('primeira: advertiser → search → série dos grupos com gasto → grava por grupo → CAS → conclui', async () => {
    const d = fake();
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarGrupos).toHaveBeenCalledWith(1000001, JANELA_DIARIA, 0);
    expect(lidos(d)).toEqual([11, 12]); // 13 sem gasto na janela: nem lido
    expect(d.buscarSerieGrupo).toHaveBeenCalledWith(11, JANELA_DIARIA);
    // Membros sempre na janela de 90 dias, mesmo na rodada diária.
    expect(d.buscarMembros).toHaveBeenCalledTimes(1);
    expect(d.buscarMembros).toHaveBeenCalledWith(12, JANELA_90, 0);
    expect(d.gravarLote.mock.calls[0].slice(0, 2)).toEqual([RODADA, new Date(T0).toISOString()]);
    const [g11, g12] = gravados(d);
    expect(g11).toMatchObject({ ad_group_id: 11, tipo: 'ITEM', external_id: 'MLB11', campaign_id: 2000001, status: 'ACTIVE', itens: ['MLB11'] });
    expect(g11.dias).toHaveLength(15);
    expect(g11.dias[0]).toEqual({ dia: '2026-09-12', ...DIA });
    expect(g11.dias[0]).not.toHaveProperty('roas');
    expect(g12).toMatchObject({ ad_group_id: 12, tipo: 'FAMILY', external_id: '4000012', itens: ['MLB21', 'MLB22'] });
    expect(d.gravarLote.mock.invocationCallOrder[0]).toBeLessThan(d.avancarCursor.mock.invocationCallOrder[0]);
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, '12');
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      { cargaConcluida: true, advertiserId: 1000001, coberturaDesde: '2026-09-12', custoResumo: 99, custoListado: 20 });
  });

  it('carga inicial: janela de 90 dias terminando ontem', async () => {
    const d = fake({ lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })) });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarGrupos).toHaveBeenCalledWith(1000001, JANELA_90, 0);
    expect(gravados(d)[0].dias).toHaveLength(90);
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ coberturaDesde: '2026-06-29' });
  });

  it('search paginado: segue o offset até o total', async () => {
    const d = fake({ buscarGrupos: vi.fn(async (_a: number, _j: unknown, offset: number) =>
      (offset === 0 ? busca([grupo(11, 'ITEM'), grupo(12, 'ITEM')], 3) : busca([grupo(14, 'ITEM')], 3))) });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarGrupos.mock.calls.map((c) => c[2])).toEqual([0, 2]);
    expect(lidos(d)).toEqual([11, 12, 14]);
  });

  it('status de grupo fora da lista conhecida no search: o grupo com gasto é lido e gravado com o status do ML', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(15, 'ITEM', 5, 'ARCHIVED')])) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d)[0]).toMatchObject({ ad_group_id: 15, status: 'ARCHIVED' });
  });

  it('/ads paginado com total > 100: lê todas as páginas', async () => {
    const pag1 = Array.from({ length: 100 }, (_, k) => `MLB${3000 + k}`);
    const pag2 = Array.from({ length: 50 }, (_, k) => `MLB${4000 + k}`);
    const d = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      buscarMembros: vi.fn(async (_id: number, _j: unknown, offset: number) => (offset === 0 ? membros(pag1, 150) : membros(pag2, 150))),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarMembros.mock.calls.map((c) => c[2])).toEqual([0, 100]);
    expect(gravados(d)[0].itens).toHaveLength(150);
  });

  it('releitura com menos membros que o vínculo gravado (ou lista vazia) mantém o vínculo: o grupo compartilhado não vira sku', async () => {
    const menor = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      contarVinculos: vi.fn(async () => new Map([[12, 2]])),
      buscarMembros: vi.fn(async () => membros(['MLB21'])), // a cor irmã MLB22 sumiu da leitura
    });
    await sincronizarAdsOrg(menor, primeira);
    expect(menor.contarVinculos).toHaveBeenCalledWith([12]);
    expect(gravados(menor)[0].itens).toBeNull();
    const vazia = fake({ buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])), buscarMembros: vi.fn(async () => membros([])) });
    await sincronizarAdsOrg(vazia, primeira);
    expect(gravados(vazia)[0].itens).toBeNull();
    const maior = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      contarVinculos: vi.fn(async () => new Map([[12, 2]])),
      buscarMembros: vi.fn(async () => membros(['MLB21', 'MLB22', 'MLB23'])),
    });
    await sincronizarAdsOrg(maior, primeira);
    expect(gravados(maior)[0].itens).toEqual(['MLB21', 'MLB22', 'MLB23']);
  });

  it('403 PolicyAgent no advertiser → sem_permissao, sem retry e sem tocar em grupos', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => http(403, { blocked_by: 'PolicyAgent', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' })) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(d.buscarAdvertiser).toHaveBeenCalledTimes(1);
    expect(d.esperar).not.toHaveBeenCalled();
    expect(d.buscarGrupos).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'sem_permissao',
      expect.stringContaining('sem permissão de Publicidade ou conexão recusada'), { ...PARADA, advertiserId: null });
  });

  it('401 (já depois da releitura do token nas deps) → sem_acesso; 404 no advertiser ou lista sem MLB → sem_advertiser', async () => {
    const a = fake({ buscarAdvertiser: vi.fn(async () => http(401, { error_code: 'unauthorized' })) });
    await sincronizarAdsOrg(a, primeira);
    expect(a.concluir.mock.calls[0][1]).toBe('sem_acesso');
    const b = fake({ buscarAdvertiser: vi.fn(async () => http(404, { message: 'No permissions found for user_id' })) });
    await sincronizarAdsOrg(b, primeira);
    expect(b.concluir.mock.calls[0][1]).toBe('sem_advertiser');
    const c = fake({ buscarAdvertiser: vi.fn(async () => ok({ advertisers: [] })) });
    expect(await sincronizarAdsOrg(c, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(c.concluir.mock.calls[0][1]).toBe('sem_advertiser');
  });

  it('org sem conexão (deps lança ParadaAds) → sem_acesso', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => { throw new ParadaAds('sem_acesso', 'Organização sem conexão com o Mercado Livre.'); }) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(d.concluir.mock.calls[0][1]).toBe('sem_acesso');
  });

  it('404 de um grupo (apagado entre o search e a leitura) → pula o grupo, grava os outros', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
      (id === 11 ? http(404, { error_code: 'ad_group_not_found_exception' }) : serie(j))) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d).map((g) => g.ad_group_id)).toEqual([12]);
  });

  it('grupo com gasto gravado na janela que saiu do search é relido por id e mantém o vínculo', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      lerGruposComGasto: vi.fn(async () => [{ ad_group_id: 9, tipo: 'FAMILY' as const, external_id: '4000009', campaign_id: 0, status: 'ACTIVE' }]),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.lerGruposComGasto).toHaveBeenCalledWith('2026-09-12', '2026-09-26');
    expect(lidos(d)).toEqual([9, 12]);
    expect(d.buscarMembros.mock.calls.map((c) => c[0])).toEqual([12]);
    expect(gravados(d).find((g) => g.ad_group_id === 9)).toMatchObject({ itens: null, status: 'ACTIVE' });
  });

  it('429 que não cabe no orçamento → continuação no mesmo cursor, nada gravado', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.gravarLote).not.toHaveBeenCalled();
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 120_000 });
  });

  it('5º adiamento no mesmo cursor: os grupos não lidos viram falha, o cursor anda e a rodada fecha em erro (nunca ok)', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 })).toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.gravarLote).not.toHaveBeenCalled();
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, '12');
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('2 grupos não lidos'), { ...PARADA, advertiserId: 1000001 });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  it('429 com Retry-After que cabe → espera e segue', async () => {
    let n = 0;
    const d = fake({ buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) => (n++ === 0 ? http(429, null, 1_000) : serie(j))) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.esperar).toHaveBeenCalledWith(1_000);
  });

  it('gravarLote false (não é mais a dona) → obsoleta, sem avançar cursor', async () => {
    const d = fake({ gravarLote: vi.fn(async () => false) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.avancarCursor).not.toHaveBeenCalled();
  });

  it('orçamento estourado entre lotes → continua do último grupo gravado', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'ITEM'), grupo(14, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (_id: number, j: { desde: string; ate: string }) => { d.relogio.t += 40_000; return serie(j); });
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 60_000, lote: 1, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, tentativa: 0 }, {});
  });

  it('continuação: confere a posse e só lê grupos depois do cursor', async () => {
    const d = fake();
    await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false });
    expect(d.avancarCursor).toHaveBeenNthCalledWith(1, RODADA, '11', '11');
    expect(lidos(d)).toEqual([12]);
  });

  it('série malformada ou furada → erro da rodada (500), nunca grava zero inventado', async () => {
    const malformada = fake({ buscarSerieGrupo: vi.fn(async () => ok({ results: [{ date: '2026-09-26', cost: 'x' }] })) });
    expect(await sincronizarAdsOrg(malformada, primeira)).toEqual({ resultado: 'erro' });
    expect(malformada.gravarLote).not.toHaveBeenCalled();
    expect(malformada.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('resposta inválida'), { ...PARADA, advertiserId: 1000001 });
    const furada = fake({ buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) =>
      ok({ results: (serie(j).corpo as { results: unknown[] }).results.slice(1) })) });
    expect(await sincronizarAdsOrg(furada, primeira)).toEqual({ resultado: 'erro' });
    expect(furada.gravarLote).not.toHaveBeenCalled();
  });

  it('primeira sem posse → obsoleta sem ler nada', async () => {
    const d = fake({ reservarPosse: vi.fn(async () => null) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.buscarAdvertiser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/sincronizar.test.ts`
Expected: FAIL com `Failed to resolve import "../sincronizar.ts"`.

- [ ] **Step 3: Implementar**

Create `supabase/functions/_shared/ads/sincronizar.ts`:

```ts
// Vendas SKU Fatia 2c — orquestração pura do worker de Ads (uma org por mensagem, em cadeia).
// Mesmo contrato de posse/cursor da 2b (_shared/trafego/sincronizar.ts), com estado próprio (ml_ads_sync,
// migration <TS>_vendas_sku_ads.sql). Unidade = ad_group_id (R3). Só GET no ML.
import { emParalelo } from '../promocoes/sincronizar.ts';
import { diaDeHoje } from '../trafego/janelas.ts';
import { TIMEOUT_ML_MS } from '../trafego/fiacao.ts';
import type { MsgTrafego, RespostaML } from '../trafego/sincronizar.ts';
import { janelaAds, type JanelaAds } from './janelas.ts';
import {
  classificarResposta, parseAdvertiser, parseBuscaGrupos, parseMembros, parseSerieGrupo,
  type DiaAds, type GrupoBusca, type TipoGrupo,
} from './parsers.ts';

export type EstadoParada = 'sem_acesso' | 'sem_permissao' | 'sem_advertiser';
/** A org para sem ser erro do worker: conexão recusada, sem permissão de Publicidade ou sem anunciante. */
export class ParadaAds extends Error {
  estado: EstadoParada;
  constructor(estado: EstadoParada, mensagem: string) { super(mensagem); this.estado = estado; }
}

export type MsgAds = MsgTrafego;
export type ResultadoAds = 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso';
export interface GrupoConhecido { ad_group_id: number; tipo: TipoGrupo; external_id: string | null; campaign_id: number | null; status: string }
/** `itens` null = vínculo não lido nesta rodada (o banco mantém o atual). */
export interface GrupoGravar extends GrupoConhecido { itens: string[] | null; dias: DiaAds[] }

export interface DepsAds {
  agora(): number;
  esperar(ms: number): Promise<void>;
  /** reservar_ads_posse: null = posse viva de outra cadeia. */
  reservarPosse(): Promise<{ rodada: string; cursor: string | null } | null>;
  /** avancar_ads_cursor (CAS; renova a posse). novo = atual só confere. false = obsoleta. */
  avancarCursor(rodada: string, atual: string | null, novo: string | null): Promise<boolean>;
  lerEstadoSync(): Promise<{ cargaInicialOk: boolean; ultimoOkEm: string | null }>;
  /** Grupos com linha de custo > 0 gravada em [desde, ate] (relidos mesmo fora do search). */
  lerGruposComGasto(desde: string, ate: string): Promise<GrupoConhecido[]>;
  /** Nº de MLBs no vínculo gravado de cada grupo (ml_ads_grupo_item). */
  contarVinculos(adGroupIds: number[]): Promise<Map<number, number>>;
  /** Os GETs nunca lançam por status HTTP (401 já vem depois de 1 releitura do token, ver
   *  getComReautenticacao). Sem conexão → lançar ParadaAds('sem_acesso'). */
  buscarAdvertiser(): Promise<RespostaML>;
  buscarGrupos(advertiserId: number, janela: JanelaAds, offset: number): Promise<RespostaML>;
  buscarSerieGrupo(adGroupId: number, janela: JanelaAds): Promise<RespostaML>;
  buscarMembros(adGroupId: number, janela: JanelaAds, offset: number): Promise<RespostaML>;
  /** gravar_ads_lote: false = a rodada não é mais a dona. */
  gravarLote(rodada: string, coletadoEm: string, grupos: GrupoGravar[]): Promise<boolean>;
  continuar(msg: MsgAds, opts: { atrasoMs?: number }): Promise<void>;
  concluir(rodada: string, estado: 'ok' | 'erro' | EstadoParada, erro: string | null, extra: ExtraConcluir): Promise<boolean>;
}

/** custoResumo = metrics_summary.cost do search; custoListado = Σ cost dos grupos listados (mesma janela). */
export interface ExtraConcluir {
  cargaConcluida: boolean; advertiserId: number | null; coberturaDesde: string | null;
  custoResumo: number | null; custoListado: number | null;
}

const FALLBACK_RETRY_MS = 1_500;
const MAX_TENTATIVAS = 3;
const LIMITE_ADIAMENTOS = 5;
const MSG_403 = 'sem permissão de Publicidade ou conexão recusada';
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 429/5xx: espera Retry-After (fallback 1,5 s) só se couber com uma requisição inteira; senão adia. */
async function comRetry(deps: DepsAds, fimMs: number, busca: () => Promise<RespostaML>): Promise<RespostaML | { adiar: number }> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await busca();
    if (classificarResposta(r) !== 'transitorio' || tentativa >= MAX_TENTATIVAS) return r;
    const espera = r.retryAfterMs ?? FALLBACK_RETRY_MS;
    if (deps.agora() + espera + TIMEOUT_ML_MS > fimMs) return { adiar: espera };
    await deps.esperar(espera);
  }
}

/** 2xx segue. 401/403 param a org (403 nunca é tratado como token expirado). O resto é erro da rodada. */
function exigir(r: RespostaML, onde: string): void {
  const c = classificarResposta(r);
  if (c === 'ok') return;
  if (c === 'sem_acesso') throw new ParadaAds('sem_acesso', `ML 401 em ${onde}: conexão recusada`);
  if (c === 'sem_permissao') throw new ParadaAds('sem_permissao', `ML 403 em ${onde}: ${MSG_403}`);
  throw new Error(`ML HTTP ${r.status} em ${onde}`);
}

const meta = (g: GrupoConhecido): GrupoConhecido =>
  ({ ad_group_id: g.ad_group_id, tipo: g.tipo, external_id: g.external_id, campaign_id: g.campaign_id, status: g.status });

export async function sincronizarAdsOrg(
  deps: DepsAds,
  msg: MsgAds,
  cfg = { limiteMs: 90_000, lote: 20, concorrencia: 6 },
): Promise<{ resultado: ResultadoAds }> {
  const inicio = deps.agora();
  const fim = inicio + cfg.limiteMs;
  let rodada: string | null = null;
  let advertiserId: number | null = null;
  const parada = (extra: Partial<ExtraConcluir> = {}): ExtraConcluir =>
    ({ cargaConcluida: false, advertiserId, coberturaDesde: null, custoResumo: null, custoListado: null, ...extra });
  try {
    let cursor: string | null;
    if (msg.primeira) {
      const posse = await deps.reservarPosse();
      if (!posse) return { resultado: 'obsoleta' };
      ({ rodada, cursor } = posse);
    } else {
      if (!msg.rodada) return { resultado: 'obsoleta' };
      cursor = msg.cursor ?? null;
      if (!(await deps.avancarCursor(msg.rodada, cursor, cursor))) return { resultado: 'obsoleta' };
      rodada = msg.rodada;
    }
    const dona = rodada;
    const inicial = cursor;
    const continuar = async (c: string | null, atrasoMs?: number) => {
      const tentativa = c === inicial ? (msg.tentativa ?? 0) + 1 : 0;
      await deps.continuar({ org_id: msg.org_id, rodada: dona, cursor: c, primeira: false, tentativa },
        atrasoMs != null ? { atrasoMs } : {});
      return { resultado: 'continua' as const };
    };

    const estado = await deps.lerEstadoSync();
    const hoje = diaDeHoje(new Date(inicio), 'brt');
    const janela = janelaAds({
      hoje,
      cargaInicialOk: estado.cargaInicialOk,
      ultimoOkDia: estado.ultimoOkEm ? diaDeHoje(new Date(estado.ultimoOkEm), 'brt') : null,
    });
    // Membros sempre na janela de 90 dias: numa janela curta o ML pode omitir a cor sem atividade, e o
    // vínculo encolhido faria um grupo compartilhado parecer exclusivo.
    const janelaMembros = janelaAds({ hoje, cargaInicialOk: false, ultimoOkDia: null });

    const a = await comRetry(deps, fim, () => deps.buscarAdvertiser());
    if ('adiar' in a) return await continuar(cursor, a.adiar);
    if (classificarResposta(a) === 'nao_encontrado') throw new ParadaAds('sem_advertiser', 'ML 404: conta sem anunciante de Product Ads');
    exigir(a, 'advertisers');
    advertiserId = parseAdvertiser(a.corpo);
    if (advertiserId == null) throw new ParadaAds('sem_advertiser', 'Nenhum anunciante MLB de Product Ads na conta');
    const adv = advertiserId;

    const listados: GrupoBusca[] = [];
    let custoResumo: number | null = null;
    for (let offset = 0; ;) {
      const r = await comRetry(deps, fim, () => deps.buscarGrupos(adv, janela, offset));
      if ('adiar' in r) return await continuar(cursor, r.adiar);
      exigir(r, 'ad_groups/search');
      const p = parseBuscaGrupos(r.corpo);
      if (!p) throw new Error('ad_groups/search: resposta inválida');
      if (offset === 0) custoResumo = p.custoResumo;
      listados.push(...p.grupos);
      offset += p.grupos.length;
      if (p.grupos.length === 0 || offset >= p.total) break;
    }
    const noSearch = new Set(listados.map((g) => g.ad_group_id));
    // Relidos: com gasto na janela pelo search + os que já têm gasto gravado nela (grupo apagado some do
    // search, mas o ML o mantém 90 dias; 404 → os dias gravados ficam).
    const alvo = new Map<number, GrupoConhecido>();
    for (const g of await deps.lerGruposComGasto(janela.desde, janela.ate)) alvo.set(g.ad_group_id, meta(g));
    for (const g of listados) if (g.cost > 0) alvo.set(g.ad_group_id, meta(g));
    const pendentes = [...alvo.values()].sort((x, y) => x.ad_group_id - y.ad_group_id)
      .filter((g) => inicial == null || g.ad_group_id > Number(inicial));

    let naoLidos = 0;
    for (let i = 0; i < pendentes.length; i += cfg.lote) {
      if (i > 0 && deps.agora() - inicio > cfg.limiteMs) return await continuar(cursor);
      const lote = pendentes.slice(i, i + cfg.lote);
      const vinculos = await deps.contarVinculos(lote.map((g) => g.ad_group_id));
      let adiarMs: number | null = null;
      // null = não lido (adiado); 'sumiu' = 404 (grupo apagado: os dias gravados ficam).
      const lidos = await emParalelo(lote, cfg.concorrencia, async (g): Promise<GrupoGravar | 'sumiu' | null> => {
        if (adiarMs != null) return null;
        if (deps.agora() > fim) { adiarMs ??= 0; return null; }
        const s = await comRetry(deps, fim, () => deps.buscarSerieGrupo(g.ad_group_id, janela));
        if ('adiar' in s) { adiarMs ??= s.adiar; return null; }
        if (classificarResposta(s) === 'nao_encontrado') return 'sumiu';
        exigir(s, `ad_groups/${g.ad_group_id}`);
        const dias = parseSerieGrupo(s.corpo, janela);
        if (!dias) throw new Error(`ad_groups/${g.ad_group_id}: resposta inválida`);
        let itens: string[] | null = null;
        if (g.tipo === 'ITEM') {
          itens = g.external_id ? [g.external_id] : null;
        } else if (noSearch.has(g.ad_group_id)) {
          const achados: string[] = [];
          for (let offset = 0; ;) {
            const m = await comRetry(deps, fim, () => deps.buscarMembros(g.ad_group_id, janelaMembros, offset));
            if ('adiar' in m) { adiarMs ??= m.adiar; return null; }
            if (classificarResposta(m) === 'nao_encontrado') return 'sumiu';
            exigir(m, `ad_groups/${g.ad_group_id}/ads`);
            const p = parseMembros(m.corpo);
            if (!p) throw new Error(`ad_groups/${g.ad_group_id}/ads: resposta inválida`);
            achados.push(...p.itens);
            offset += p.itens.length;
            if (p.itens.length === 0 || offset >= p.total) break;
          }
          itens = [...new Set(achados)].sort();
          // Lista vazia ou menor que o vínculo gravado: mantém o gravado (itens null). O vínculo nunca encolhe
          // por esta leitura; o custo é uma cor removida de verdade seguir no grupo (fica "compartilhado",
          // o lado conservador: nunca um falso `sku`).
          if (itens.length === 0 || itens.length < (vinculos.get(g.ad_group_id) ?? 0)) itens = null;
        }
        return { ...g, itens, dias };
      });
      if (adiarMs != null) {
        // Mesmo limite da 2b: depois de 5 adiamentos no mesmo cursor, os não lidos viram falha e o cursor
        // anda. A rodada termina em `erro` (nunca `ok`): ultimo_ok_em não avança e o dossiê não prova zero.
        const preso = cursor === inicial && (msg.tentativa ?? 0) >= LIMITE_ADIAMENTOS;
        if (!preso) return await continuar(cursor, adiarMs);
        naoLidos += lidos.filter((x) => x === null).length;
      }
      const grupos = lidos.filter((x): x is GrupoGravar => x != null && x !== 'sumiu');
      if (grupos.length && !(await deps.gravarLote(dona, new Date(deps.agora()).toISOString(), grupos))) {
        return { resultado: 'obsoleta' };
      }
      const novo = String(lote[lote.length - 1].ad_group_id);
      if (!(await deps.avancarCursor(dona, cursor, novo))) return { resultado: 'obsoleta' };
      cursor = novo;
    }

    // Gasto fora de grupo listado (provável `deleted`, spike ~2,6 %) fica gravado no sync: com diferença > 0
    // o dossiê não mostra "Lucro após Ads". Só a razão vai para o log (valor em R$ não sai do banco).
    const custoListado = Math.round(listados.reduce((s, g) => s + g.cost, 0) * 100) / 100;
    console.info('[ads] custo da janela', {
      org_id: msg.org_id, janela, listadoSobreResumo: custoResumo ? custoListado / custoResumo : null,
    });
    if (naoLidos > 0) {
      const erro = `${naoLidos} ${naoLidos === 1 ? 'grupo não lido' : 'grupos não lidos'} depois de ${LIMITE_ADIAMENTOS} adiamentos (429/5xx)`;
      if (!(await deps.concluir(dona, 'erro', erro, parada({ advertiserId: adv })))) return { resultado: 'obsoleta' };
      return { resultado: 'erro' };
    }
    let dono: boolean;
    try {
      dono = await deps.concluir(dona, 'ok', null,
        { cargaConcluida: true, advertiserId: adv, coberturaDesde: janela.desde, custoResumo, custoListado });
    } catch (e) {
      console.error('[ads] concluir ok falhou', { org_id: msg.org_id, erro: mensagem(e) });
      return { resultado: 'erro' };
    }
    return { resultado: dono ? 'ok' : 'obsoleta' };
  } catch (e) {
    const estadoParada = e instanceof ParadaAds ? e.estado : null;
    if (rodada == null) {
      console.error('[ads] falha antes da posse', { org_id: msg.org_id, erro: mensagem(e) });
      return { resultado: 'erro' };
    }
    try {
      const dono = await deps.concluir(rodada, estadoParada ?? 'erro', mensagem(e), parada());
      if (!dono) return { resultado: 'obsoleta' };
    } catch (e2) {
      console.error('[ads] concluir falhou', { org_id: msg.org_id, erro: mensagem(e), concluir: mensagem(e2) });
    }
    return { resultado: estadoParada ? 'sem_acesso' : 'erro' };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/sincronizar.test.ts`
Expected: PASS. Depois `pnpm preflight:static` → PASS.

- [ ] **Step 5: Commit**

`$JOB_TMP/commit-2c-t3.txt`:
```
feat(vendas-sku): orquestração pura do worker de Ads por grupo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add supabase/functions/_shared/ads/sincronizar.ts supabase/functions/_shared/ads/__tests__/sincronizar.test.ts` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t3.txt`

---

### Task 4: Worker `coletar-ads-ml` (fiação, deps, config) + runbook

**Files:**
- Create: `supabase/functions/_shared/ads/fiacao.ts`, `supabase/functions/_shared/ads/__tests__/fiacao.test.ts`
- Modify: `supabase/functions/_shared/trafego/fiacao.ts` (`buscarML` ganha `headers` opcional; `Rotas` ganha `rotulo` opcional)
- Create: `supabase/functions/coletar-ads-ml/index.ts`, `supabase/functions/coletar-ads-ml/deps.ts`
- Modify: `supabase/config.toml`
- Create: `docs/runbooks/coletar-ads-ml.md`

**Interfaces:**
- Consumes: T1 (RPCs `reservar_ads_posse`, `avancar_ads_cursor`, `gravar_ads_lote`, `concluir_ads_rodada`, `limpar_ads_retencao`; tabelas `ml_ads_sync`, `ml_ads_grupo`, `ml_ads_grupo_dia`), T3 (`DepsAds`, `ParadaAds`, `GrupoConhecido`, `sincronizarAdsOrg`), `_shared/trafego/fiacao.ts` (`buscarML`, `corteRetencao`, `delaySegundos`, `tratarRequisicao`), `_shared/queue.ts`, `_shared/canais/conexao.ts`, `_shared/ml/token.ts`, `_shared/pagina.ts`.
- Produces:
  - `buscarML(url, token, f = fetch, headers: Record<string, string> = {})` (compatível com a 2b)
  - `Rotas.rotulo?: string` (default `'coletar-trafego-ml'` nos logs)
  - `getComReautenticacao(token: () => Promise<string>, renovar: () => void, chamar: (t: string) => Promise<RespostaML>): Promise<RespostaML>` (401 → 1 releitura do token)
  - `ML_API`, `METRICAS_GRUPO`, `STATUS_GRUPOS`, `HEADERS_ADVERTISER`, `HEADERS_ADS`, `urlAdvertiser()`, `urlBuscaGrupos(adv, j, offset)`, `urlSerieGrupo(id, j)`, `urlMembros(id, j, offset)`, `dedupFanoutAds(org, dia)`, `dedupContinuacaoAds(msg)`
  - `depsAds(admin, orgId, tokenFixo?: () => Promise<string>): DepsAds`, `publicarFanout(admin)`, `limparRetencao(admin)` (T7 usa `depsAds` com `tokenFixo`)

- [ ] **Step 1: Escrever os testes (RED)**

Create `supabase/functions/_shared/ads/__tests__/fiacao.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buscarML, dedupFanout, tratarRequisicao } from '../../trafego/fiacao.ts';
import type { RespostaML } from '../../trafego/sincronizar.ts';
import {
  HEADERS_ADS, HEADERS_ADVERTISER, dedupContinuacaoAds, dedupFanoutAds, getComReautenticacao,
  urlAdvertiser, urlBuscaGrupos, urlMembros, urlSerieGrupo,
} from '../fiacao.ts';

const J = { desde: '2026-09-12', ate: '2026-09-26' };

describe('fiação de Ads', () => {
  it('dedup com prefixo ads: nunca colide com o do tráfego (QStash deduplica por conta)', () => {
    expect(dedupFanoutAds('org-1', '2026-09-27')).toBe('ads_org-1_2026-09-27');
    expect(dedupFanoutAds('org-1', '2026-09-27')).not.toBe(dedupFanout('org-1', '2026-09-27'));
    expect(dedupContinuacaoAds({ org_id: 'org-1', rodada: '2026-09-27T14:17:00.123Z', cursor: '12', primeira: false, tentativa: 2 }))
      .toBe('ads_org-1_2026-09-27T14_17_00_123Z_12_2');
  });
  it('URLs e headers do spike 053: advertiser v1; demais v2; métricas em maiúsculas; daily minúsculo', () => {
    expect(urlAdvertiser()).toBe('/advertising/advertisers?product_id=PADS');
    expect(HEADERS_ADVERTISER).toEqual({ 'Api-Version': '1' });
    expect(HEADERS_ADS).toEqual({ 'api-version': '2' });
    const busca = urlBuscaGrupos(1000001, J, 100);
    expect(busca).toContain('/marketplace/advertising/MLB/advertisers/1000001/product_ads/ad_groups/search?limit=100&offset=100');
    expect(busca).toContain('date_from=2026-09-12&date_to=2026-09-26');
    expect(busca).toContain('metrics=CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY');
    expect(busca).toContain('metrics_summary=true');
    expect(busca).toContain('filters[status]=ACTIVE,PAUSED,IDLE,EMPTY,HOLD');
    expect(urlSerieGrupo(3000001, J)).toBe('/marketplace/advertising/MLB/product_ads/ad_groups/3000001?date_from=2026-09-12&date_to=2026-09-26'
      + '&metrics=CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY&aggregation_type=daily');
    expect(urlMembros(3000001, J, 0)).toBe('/marketplace/advertising/MLB/product_ads/ad_groups/3000001/ads?limit=100&offset=0&date_from=2026-09-12&date_to=2026-09-26&metrics=COST');
    for (const u of [busca, urlSerieGrupo(1, J), urlMembros(1, J, 0)]) {
      expect(u).not.toMatch(/ads\/search|product_ads\/items/); // endpoints legados proibidos
    }
  });
  it('buscarML manda os headers extras, só GET, e o Authorization não é sobrescrito', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const r = await buscarML('https://x/y', 'tok', f as unknown as typeof fetch, { 'api-version': '2', Authorization: 'x' });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'api-version': '2', Authorization: 'Bearer tok' });
    expect(r).toEqual({ status: 200, retryAfterMs: null, corpo: { ok: true } });
  });
  it('401 no meio da cadeia: relê o token uma vez e repete; 401 de novo volta; 403 nunca repete', async () => {
    const r = (status: number): RespostaML => ({ status, retryAfterMs: null, corpo: null });
    let n = 0;
    const token = vi.fn(async () => (n === 0 ? 'velho' : 'novo'));
    const renovar = vi.fn(() => { n++; });
    const chamar = vi.fn(async (t: string) => r(t === 'velho' ? 401 : 200));
    expect((await getComReautenticacao(token, renovar, chamar)).status).toBe(200);
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual(['velho', 'novo']);

    const sempre401 = vi.fn(async () => r(401));
    expect((await getComReautenticacao(async () => 't', () => {}, sempre401)).status).toBe(401);
    expect(sempre401).toHaveBeenCalledTimes(2);

    const deu403 = vi.fn(async () => r(403));
    const renovar403 = vi.fn();
    expect((await getComReautenticacao(async () => 't', renovar403, deu403)).status).toBe(403);
    expect(deu403).toHaveBeenCalledTimes(1);
    expect(renovar403).not.toHaveBeenCalled();
  });
  it('tratarRequisicao usa o rótulo do worker no log de erro', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await tratarRequisicao(new Request('https://x', { method: 'POST', body: '{"org_id":"org-1"}' }), {
      rotulo: 'coletar-ads-ml', verificar: async () => true, fanout: async () => 0, limpar: async () => {},
      sincronizar: async () => { throw new Error('boom'); },
    });
    expect(res.status).toBe(500);
    expect(erro).toHaveBeenCalledWith('[coletar-ads-ml]', 'boom');
    erro.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/fiacao.test.ts`
Expected: FAIL com `Failed to resolve import "../fiacao.ts"`.

- [ ] **Step 3: Acréscimos compatíveis em `_shared/trafego/fiacao.ts`**

Trocar a assinatura e os headers de `buscarML`:

```ts
export async function buscarML(
  url: string, token: string, f: typeof fetch = fetch, headers: Record<string, string> = {},
): Promise<RespostaML> {
  try {
    const r = await f(url, {
      method: 'GET',
      // Headers extras (api-version do Product Ads) antes: o Authorization nunca é sobrescrito.
      headers: { ...headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_ML_MS),
    });
```
(o resto da função fica igual).

Em `interface Rotas`, acrescentar como primeiro campo:

```ts
  /** Nome do worker nos logs (default 'coletar-trafego-ml'). */
  rotulo?: string;
```

Em `tratarRequisicao`, trocar as duas ocorrências do literal de log:
- `console.error('[coletar-trafego-ml] limpeza da retenção falhou', …)` → ``console.error(`[${r.rotulo ?? 'coletar-trafego-ml'}] limpeza da retenção falhou`, …)``
- `console.error('[coletar-trafego-ml]', …)` → ``console.error(`[${r.rotulo ?? 'coletar-trafego-ml'}]`, …)``

Rodar `pnpm vitest run supabase/functions/_shared/trafego` → os testes da 2b continuam PASS.

- [ ] **Step 4: Criar `_shared/ads/fiacao.ts`**

```ts
// Partes puras da fiação do worker `coletar-ads-ml` (Fatia 2c): URLs e headers do Product Ads (spike 053 §3)
// e ids de deduplicação do QStash. Sem import Deno/npm: o vitest carrega.
import type { MsgTrafego, RespostaML } from '../trafego/sincronizar.ts';
import type { JanelaAds } from './janelas.ts';

export const ML_API = 'https://api.mercadolibre.com';
export const METRICAS_GRUPO = 'CLICKS,PRINTS,COST,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,UNITS_QUANTITY';
/** Os status de grupo vistos no spike 053 (EMPTY, IDLE, ACTIVE, HOLD, PAUSED), como pede R4. Os 2,4 % de gasto
 *  escondidos no spike vieram de campanhas em `error` no `campaigns/search`, não de status de grupo; a T7
 *  confere que o total do `ad_groups/search` com este filtro é igual ao total sem filtro. */
export const STATUS_GRUPOS = 'ACTIVE,PAUSED,IDLE,EMPTY,HOLD';
export const LIMITE_PAGINA = 100;
export const HEADERS_ADVERTISER: Record<string, string> = { 'Api-Version': '1' };
export const HEADERS_ADS: Record<string, string> = { 'api-version': '2' };

const periodo = (j: JanelaAds) => `date_from=${j.desde}&date_to=${j.ate}`;
const BASE = '/marketplace/advertising/MLB';

export const urlAdvertiser = () => '/advertising/advertisers?product_id=PADS';
export const urlBuscaGrupos = (adv: number, j: JanelaAds, offset: number) =>
  `${BASE}/advertisers/${adv}/product_ads/ad_groups/search?limit=${LIMITE_PAGINA}&offset=${offset}&${periodo(j)}`
  + `&metrics=${METRICAS_GRUPO}&metrics_summary=true&filters[status]=${STATUS_GRUPOS}`;
export const urlSerieGrupo = (id: number, j: JanelaAds) =>
  `${BASE}/product_ads/ad_groups/${id}?${periodo(j)}&metrics=${METRICAS_GRUPO}&aggregation_type=daily`;
/** Só a lista de membros: as métricas por MLB não são usadas (R2). */
export const urlMembros = (id: number, j: JanelaAds, offset: number) =>
  `${BASE}/product_ads/ad_groups/${id}/ads?limit=${LIMITE_PAGINA}&offset=${offset}&${periodo(j)}&metrics=COST`;

/**
 * GET com 1 releitura do token em caso de 401: o token pode ter sido rotacionado no meio da cadeia (ex.:
 * renovar-tokens-ml). `renovar` só descarta o token em memória; o próximo `token()` passa de novo por
 * getValidAccessTokenConexao (única rota de refresh). 401 de novo → devolvido (a rodada vira sem_acesso).
 * 403 nunca repete: é permissão, não token.
 */
export async function getComReautenticacao(
  token: () => Promise<string>, renovar: () => void, chamar: (t: string) => Promise<RespostaML>,
): Promise<RespostaML> {
  const r = await chamar(await token());
  if (r.status !== 401) return r;
  renovar();
  return chamar(await token());
}

const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_'); // mesmo filtro de trafego/fiacao.ts
/** Prefixo próprio: o QStash deduplica por conta, e `trafego:` descartaria a mensagem de Ads. */
export const dedupFanoutAds = (orgId: string, dia: string) => seguro(`ads:${orgId}:${dia}`);
export const dedupContinuacaoAds = (m: MsgTrafego) =>
  seguro(`ads:${m.org_id}:${m.rodada ?? ''}:${m.cursor ?? ''}:${m.tentativa ?? 0}`);
```

- [ ] **Step 5: Rodar o teste da fiação (GREEN)**

Run: `pnpm vitest run supabase/functions/_shared/ads/__tests__/fiacao.test.ts`
Expected: PASS.

- [ ] **Step 6: Worker real**

Create `supabase/functions/coletar-ads-ml/deps.ts`:

```ts
// Fiação real do worker de Ads (Vendas SKU Fatia 2c). Só ligação: a regra vive em _shared/ads/*.ts
// (vitest). No ML só GET; o único POST é o refresh OAuth de _shared/ml/token.ts. Gravação só pelas RPCs
// de <TS>_vendas_sku_ads.sql. O token nunca é logado.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { qstashClient } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { diaDeHoje } from '../_shared/trafego/janelas.ts';
import { buscarML, corteRetencao, delaySegundos } from '../_shared/trafego/fiacao.ts';
import {
  HEADERS_ADS, HEADERS_ADVERTISER, ML_API, dedupContinuacaoAds, dedupFanoutAds, getComReautenticacao,
  urlAdvertiser, urlBuscaGrupos, urlMembros, urlSerieGrupo,
} from '../_shared/ads/fiacao.ts';
import { ParadaAds, type DepsAds, type GrupoConhecido } from '../_shared/ads/sincronizar.ts';

const urlWorker = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/coletar-ads-ml`;
const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };

/** Uma mensagem `primeira` por org com conexão ML (dedup org+dia BRT, prefixo ads:). */
export async function publicarFanout(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from('marketplace_connections')
    .select('org_id').eq('canal', 'mercado_livre').not('conta_externa_id', 'is', null);
  falhou('conexões ML', error);
  const orgs = [...new Set((data ?? []).map((r) => r.org_id as string))];
  const dia = diaDeHoje(new Date(), 'brt');
  for (const org of orgs) {
    await qstashClient().publishJSON({
      url: urlWorker(), body: { org_id: org, primeira: true }, retries: 1, deduplicationId: dedupFanoutAds(org, dia),
    });
  }
  return orgs.length;
}

/** Retenção de 13 meses (um delete por tabela; ~1 dia de linhas por execução). */
export async function limparRetencao(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.rpc('limpar_ads_retencao', { p_corte: corteRetencao(new Date()) });
  falhou('limpar_ads_retencao', error);
}

/**
 * `tokenFixo` só para a validação local (T7), que lê o token em memória e nunca renova. Em produção o
 * token vem de getValidAccessTokenConexao (única rota de refresh).
 */
export function depsAds(admin: SupabaseClient, orgId: string, tokenFixo?: () => Promise<string>): DepsAds {
  let token: Promise<string> | null = null;
  const tokenML = tokenFixo ?? (() => token ??= (async () => {
    const cx = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new ParadaAds('sem_acesso', 'Organização sem conexão com o Mercado Livre.');
    return getValidAccessTokenConexao(cx);
  })());
  // 401 → descarta o token em memória e pede de novo a getValidAccessTokenConexao, uma vez.
  const get = (caminho: string, headers: Record<string, string>) =>
    getComReautenticacao(tokenML, () => { token = null; }, (t) => buscarML(`${ML_API}${caminho}`, t, fetch, headers));
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    falhou(fn, error);
    return data;
  };

  return {
    agora: () => Date.now(),
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),

    async reservarPosse() {
      const linhas = await rpc('reservar_ads_posse', { p_org: orgId }) as { rodada: string; cursor: string | null }[] | null;
      return linhas?.[0] ?? null;
    },
    avancarCursor: async (rodada, atual, novo) =>
      (await rpc('avancar_ads_cursor', { p_org: orgId, p_rodada: rodada, p_cursor_atual: atual, p_cursor_novo: novo })) === true,

    async lerEstadoSync() {
      const { data, error } = await admin.from('ml_ads_sync').select('carga_inicial_ok, ultimo_ok_em').eq('org_id', orgId).maybeSingle();
      falhou('lerEstadoSync', error);
      return { cargaInicialOk: data?.carga_inicial_ok === true, ultimoOkEm: (data?.ultimo_ok_em as string | null | undefined) ?? null };
    },

    async lerGruposComGasto(desde, ate) {
      const dias = await paginarTudo<{ ad_group_id: number }>((de, fim) => admin.from('ml_ads_grupo_dia')
        .select('ad_group_id').eq('org_id', orgId).gte('dia', desde).lte('dia', ate).gt('cost', 0)
        .order('ad_group_id').order('dia').range(de, fim));
      const ids = [...new Set(dias.map((d) => d.ad_group_id))];
      if (!ids.length) return [];
      const { data, error } = await admin.from('ml_ads_grupo')
        .select('ad_group_id, tipo, external_id, campaign_id, status').eq('org_id', orgId).in('ad_group_id', ids);
      falhou('lerGruposComGasto', error);
      return (data ?? []) as GrupoConhecido[];
    },

    async contarVinculos(ids) {
      // ≤ 20 grupos por lote × dezenas de MLBs: bem abaixo do teto de 1.000 linhas do PostgREST.
      const { data, error } = await admin.from('ml_ads_grupo_item').select('ad_group_id')
        .eq('org_id', orgId).in('ad_group_id', ids);
      falhou('contarVinculos', error);
      const n = new Map<number, number>();
      for (const l of data ?? []) n.set(l.ad_group_id as number, (n.get(l.ad_group_id as number) ?? 0) + 1);
      return n;
    },

    buscarAdvertiser: () => get(urlAdvertiser(), HEADERS_ADVERTISER),
    buscarGrupos: (adv, j, offset) => get(urlBuscaGrupos(adv, j, offset), HEADERS_ADS),
    buscarSerieGrupo: (id, j) => get(urlSerieGrupo(id, j), HEADERS_ADS),
    buscarMembros: (id, j, offset) => get(urlMembros(id, j, offset), HEADERS_ADS),

    gravarLote: async (rodada, coletadoEm, grupos) =>
      (await rpc('gravar_ads_lote', { p_org: orgId, p_rodada: rodada, p_coletado_em: coletadoEm, p_grupos: grupos })) === true,

    async continuar(msg, { atrasoMs }) {
      await qstashClient().publishJSON({
        url: urlWorker(), body: msg, retries: 1, deduplicationId: dedupContinuacaoAds(msg), delay: delaySegundos(atrasoMs),
      });
    },

    concluir: async (rodada, estado, erro, extra) =>
      (await rpc('concluir_ads_rodada', {
        p_org: orgId, p_rodada: rodada, p_estado: estado, p_erro: erro, p_carga_concluida: extra.cargaConcluida,
        p_advertiser_id: extra.advertiserId, p_cobertura_desde: extra.coberturaDesde,
        p_custo_resumo: extra.custoResumo, p_custo_listado: extra.custoListado,
      })) === true,
  };
}
```

Create `supabase/functions/coletar-ads-ml/index.ts`:

```ts
// Vendas SKU Fatia 2c — coleta diária de Product Ads por grupo (só GET no ML).
// Worker QStash puro (schedule `17 14 * * *` UTC = 11:17 BRT; runbook docs/runbooks/coletar-ads-ml.md):
//  - {} → fan-out de 1 mensagem por org com conexão ML e, depois, a retenção de 13 meses;
//  - { org_id, primeira | rodada, cursor, tentativa } → uma mensagem da cadeia da org.
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { tratarRequisicao } from '../_shared/trafego/fiacao.ts';
import { sincronizarAdsOrg } from '../_shared/ads/sincronizar.ts';
import { depsAds, limparRetencao, publicarFanout } from './deps.ts';

Deno.serve((req) => tratarRequisicao(req, {
  rotulo: 'coletar-ads-ml',
  verificar: verificarAssinatura,
  fanout: () => publicarFanout(adminClient()),
  limpar: () => limparRetencao(adminClient()),
  sincronizar: (msg) => sincronizarAdsOrg(depsAds(adminClient(), msg.org_id), msg),
}));
```

Em `supabase/config.toml`, logo depois do bloco `[functions.coletar-trafego-ml]`:

```toml
[functions.coletar-ads-ml]
verify_jwt = false
```

- [ ] **Step 7: Runbook**

Create `docs/runbooks/coletar-ads-ml.md` com este conteúdo:

````markdown
# Runbook — Coleta de Ads (`coletar-ads-ml`)

Worker da Fatia 2c de Vendas SKU. Todo dia lê no Mercado Livre, **só com GET**, o gasto e as vendas
atribuídas de Product Ads **por grupo de anúncios** (`ad_group_id`): anunciante
(`/advertising/advertisers?product_id=PADS`), grupos com gasto na janela (`ad_groups/search`), a série
diária de cada grupo (`/ad_groups/{id}?aggregation_type=daily`) e os membros atuais de FAMILY/CATALOG
(`/ad_groups/{id}/ads`). O único POST é o refresh OAuth de `_shared/ml/token.ts`. Nada é alterado em
anúncio ou campanha.

Grava em `ml_ads_sync`, `ml_ads_grupo`, `ml_ads_grupo_item` e `ml_ads_grupo_dia`, só pelas RPCs de
`supabase/migrations/<TS>_vendas_sku_ads.sql`. Contrato: plano
`docs/superpowers/plans/2026-09-27-vendas-sku-fatia-2c.md`; spike `docs/spikes/053-product-ads-ml.md`.

Nada disto foi aplicado em produção pela implementação (R14). Ordem obrigatória: banco → funções → schedule.

## 1. Migration (one-time)

```bash
supabase link --project-ref txvncrgkoynoxwopfkbp   # se o worktree ainda não estiver linkado
supabase db push                                   # aplica <TS>_vendas_sku_ads.sql
npm run db:check
```

Conferir as 4 tabelas e as RPCs `reservar_ads_posse`, `avancar_ads_cursor`, `gravar_ads_lote`,
`concluir_ads_rodada`, `limpar_ads_retencao` (execute só `service_role`) e `vendas_sku_codigos_mlbs`
(execute `authenticated`, lida pelo dossiê).

## 2. Deploy (one-time)

```bash
supabase functions deploy coletar-ads-ml --no-verify-jwt
supabase functions deploy coletar-trafego-ml --no-verify-jwt   # _shared/trafego/fiacao.ts mudou (headers/rotulo)
supabase functions list                                        # conferir as versões novas
```

`_shared/ads/*` só é importado por `coletar-ads-ml`; `_shared/trafego/fiacao.ts` também por
`coletar-trafego-ml` (mudança compatível, mas a regra do projeto é redeployar quem importa `_shared/` alterado).

Conferir `verify_jwt = false`:

```bash
curl -s -i -X POST https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-ads-ml
# esperado: HTTP 401 com corpo "Invalid signature"
# errado:   401 JSON "Missing authorization header" → redeployar com --no-verify-jwt
```

## 3. Schedule QStash (one-time)

Cron **`17 14 * * *` (UTC) = 11:17 BRT**: depois das 10:00 BRT em que o ML atualiza as métricas, fora da
virada da hora e do `renovar-tokens-ml` (`:40`). **Sem body.** Retries 1.

```bash
curl -s -X POST \
  "https://qstash.upstash.io/v2/schedules/https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/coletar-ads-ml" \
  -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: 17 14 * * *" \
  -H "Upstash-Retries: 1"
```

Anotar o `scheduleId` e acrescentar a linha na tabela de schedules de
`docs/reference/edge-functions.md`.

## 4. Teste ponta a ponta

1. Disparar uma execução (publish sem body na mesma URL, ou "Trigger" no schedule).
2. Fan-out: `{ "ok": true, "orgs": N }`.
3. Por org (Logs do QStash): `{ "ok": true, "resultado": "ok" | "continua" | "sem_acesso" }`. Carga inicial
   da Avil: ~134 grupos com gasto em 90 dias ≈ 1 série + membros por grupo, em 1–3 mensagens.
4. `ml_ads_sync.custo_resumo` (metrics_summary do ML) × `custo_listado` (Σ dos grupos listados), da última
   janela ok. Diferença > 0 = gasto fora de grupo listado (spike: ~2,6 %, provável `deleted`): o dossiê mostra a
   despesa, mas deixa o "Lucro após Ads" indisponível com esse motivo. O log `[ads] custo da janela` só traz a razão.
5. SQL (read-only, Management API):

```sql
select org_id, estado, advertiser_id, carga_inicial_ok, cobertura_desde, ultimo_ok_em, cursor, posse_ate, erro,
       round(100 * (custo_resumo - custo_listado) / nullif(custo_resumo, 0), 2) as pct_fora_dos_grupos
  from ml_ads_sync;
select tipo, status, count(*) from ml_ads_grupo group by 1, 2 order by 1, 2;
select min(dia), max(dia), count(*), sum(cost) from ml_ads_grupo_dia;
```

Esperado ao fim: `estado = 'ok'`, `carga_inicial_ok = true`, `cobertura_desde` = hoje − 90 da 1ª carga,
`max(dia)` = ontem (hoje nunca é gravado), `posse_ate` e `cursor` nulos.

## 5. Como ler `ml_ads_sync`

| `estado` | Significa | O que fazer |
|---|---|---|
| `sincronizando` | Cadeia em andamento (`posse_ate` > agora). | Nada. Posse vencida há muito = cadeia morta; a execução seguinte assume e, na carga inicial, retoma do `cursor`. |
| `ok` | Rodada concluída. | Nada. |
| `sem_permissao` | ML devolveu 403 PolicyAgent: sem permissão de Publicidade **ou** conexão recusada (o ML usa o mesmo corpo para bearer malformado). Não é tratado como token expirado. | Conferir a permissão funcional "Publicidade" do app no portal do ML e reconectar a conta em Canais. |
| `sem_advertiser` | 404 no advertiser ou conta sem anunciante MLB. | O vendedor ativa em *Meu perfil → Publicidade* (reputação amarela ou melhor, 15 dias de cadastro, sem fatura vencida). |
| `sem_acesso` | Org sem conexão ML, ou 401 que se repetiu depois de reler o token uma vez em `getValidAccessTokenConexao`. | Reconectar a conta em Canais. |
| `erro` | Falha real (banco, resposta fora do contrato — inclusive série diária com dia faltando —, 5xx esgotado, ou grupos não lidos depois de 5 adiamentos). A mensagem devolveu 500 e o QStash tentou 1 vez. `ultimo_ok_em` não avança. | Ver logs pelo `org_id`. A execução do dia seguinte recomeça. |

Outros sinais:
- `{ "resultado": "obsoleta" }` (HTTP 200) é normal: rodada que perdeu a posse.
- 429/5xx que não cabe no orçamento de 90 s → continuação no mesmo cursor com `delay` = `Retry-After`;
  depois de 5 adiamentos os grupos não lidos viram falha, o cursor anda e a rodada fecha em `erro` (os dias já
  gravados ficam; o dossiê marca "desatualizado" depois de 48 h sem ok).
- Membros de FAMILY/CATALOG: lidos sempre na janela de 90 dias. Lista vazia ou menor que o vínculo gravado
  não substitui o vínculo (conservador: o grupo nunca vira "exclusivo" por uma leitura parcial).
- Grupo que some do search (provável `deleted`) **não** é apagado: se ainda tem gasto gravado na janela, é
  relido por id; 404 → os dias ficam. Só a retenção apaga.
- Atribuição: `direct/indirect/total_amount` mudam por 14 dias; cada execução relê D-1 + 14 dias e a
  leitura mais recente vence (inclusive para baixo).
- Retenção: depois do fan-out, apaga dias anteriores a hoje − 13 meses e grupos sem dia retido, e avança
  `cobertura_desde` para o corte. Falha só aparece no log, nunca como 500.

## 6. Pausar / retomar

- **Pausar:** QStash → Schedules → `coletar-ads-ml` → **Pause** (ou `…/v2/schedules/<scheduleId>/pause`).
- **Retomar:** **Resume**. A janela estende até o último dia ok − 14 (limite de 90 dias). Parada > 90 dias
  deixa buraco irrecuperável (o ML só aceita 90 dias por chamada): `cobertura_desde` avança para o início da
  janela relida e a tela mostra "sem dado" (nunca zero) antes dele.
- **Parar de vez:** apagar o schedule. Os dados ficam até a retenção.
````

- [ ] **Step 8: Checagem local sem produção**

Run: `pnpm preflight:static` (inclui `lint:functions` e `check:functions` do Deno)
Expected: PASS.
Run: `pnpm vitest run supabase/functions/_shared/ads supabase/functions/_shared/trafego`
Expected: PASS.

- [ ] **Step 9: Commit**

`$JOB_TMP/commit-2c-t4.txt`:
```
feat(vendas-sku): worker coletar-ads-ml e runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add supabase/functions/_shared/ads/fiacao.ts supabase/functions/_shared/ads/__tests__/fiacao.test.ts supabase/functions/_shared/trafego/fiacao.ts supabase/functions/coletar-ads-ml/index.ts supabase/functions/coletar-ads-ml/deps.ts supabase/config.toml docs/runbooks/coletar-ads-ml.md` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t4.txt`

---

### Task 5: Lib do front — leitura e `montarAds`

**Files:**
- Modify: `src/lib/sku-dossie-dados.ts` (tipos e leitura de Ads)
- Create: `src/lib/sku-ads.ts`
- Test: `tests/lib/sku-ads.test.ts`

**Interfaces:**
- Consumes: T1 (tabelas `ml_ads_*` com RLS, RPC `vendas_sku_codigos_mlbs`); `diaBRT`, `Intervalo` (`src/lib/calendario-brt.ts`); `diasDoIntervalo` (`src/lib/sku-trafego.ts`); `round2` (`src/lib/formato.ts`); `AlvoDossie` (`src/lib/sku-dossie.ts`); `emLotes` e `buscarTodasPaginas` já usados em `sku-dossie-dados.ts`.
- Produces (T6 usa):
  - em `sku-dossie-dados.ts`: `AdsSync`, `AdsGrupo`, `AdsMembro`, `AdsDia`, `FonteAds`, `buscarAdsSync(): Promise<AdsSync | null>`, `buscarCodigosMlbs(mlbs: string[]): Promise<Map<string, string[]>>`, `buscarFonteAds(mlbs: string[], desde: string, ate: string): Promise<FonteAds>`
  - em `sku-ads.ts`: `AlcanceAds`, `EstadoAds`, `TotaisAds`, `PontoAds`, `GrupoAdsDossie`, `MotivoSemLucro`, `AdsDossie` (com `serie` pelos intervalos do dossiê e `serieDiaria` por dia), `atribuicaoFinal(dia: string, coletadoEm: string): boolean`, `totaisAds(linhas: AdsDia[]): TotaisAds`, `montarAds(p): AdsDossie`

- [ ] **Step 1: Escrever os testes (RED)**

Create `tests/lib/sku-ads.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { atribuicaoFinal, montarAds } from '@/lib/sku-ads';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { AdsDia, AdsGrupo, AdsSync, FonteAds } from '@/lib/sku-dossie-dados';

const AGORA = new Date('2026-09-27T15:00:00Z'); // 12:00 BRT → hoje 27/09, ontem 26/09
const JANELA = { desde: '2026-09-14T03:00:00.000Z', ate: '2026-09-28T02:59:59.999Z' };
// Semanas BRT de 14/09 (14..20) e 21/09 (21..27; o dia 27 é hoje e nunca entra).
const IVS = intervalosBRT(JANELA.desde, JANELA.ate, 'semana', AGORA);
const SYNC: AdsSync = {
  estado: 'ok', erro: null, ultimo_ok_em: '2026-09-27T14:20:00Z', carga_inicial_ok: true, cobertura_desde: '2026-06-29',
  custo_resumo: 100, custo_listado: 100,
};

function dia(id: number, d: string, o: Partial<AdsDia> = {}): AdsDia {
  return { ad_group_id: id, dia: d, cost: 0, clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0,
    direct_units: 0, units: 0, coletado_em: '2026-09-27T14:20:00Z', ...o };
}
/** Uma linha por dia de `de` a `ate` (dias de set/2026), como a série densa que o worker grava. */
const diasDe = (id: number, de: number, ate: number, o: Partial<AdsDia> = {}): AdsDia[] =>
  Array.from({ length: ate - de + 1 }, (_, k) => dia(id, `2026-09-${String(de + k).padStart(2, '0')}`, o));
const grupo = (id: number, tipo: AdsGrupo['tipo'] = 'FAMILY'): AdsGrupo =>
  ({ ad_group_id: id, tipo, external_id: String(4000000 + id), campaign_id: 2000001, status: 'ACTIVE', atualizado_em: '2026-09-27T14:20:00Z' });
function fonte(p: { membros: [number, string][]; codigos: Record<string, string[]>; dias?: AdsDia[]; sync?: AdsSync | null }): FonteAds {
  const ids = [...new Set(p.membros.map(([id]) => id))];
  return {
    sync: p.sync === undefined ? SYNC : p.sync,
    grupos: ids.map((id) => grupo(id)),
    membros: p.membros.map(([ad_group_id, ml_item_id]) => ({ ad_group_id, ml_item_id })),
    dias: p.dias ?? [],
    codigosDosMembros: new Map(Object.entries(p.codigos)),
  };
}
type Entrada = Parameters<typeof montarAds>[0];
const monta = (o: Partial<Entrada> & Pick<Entrada, 'fonte'>) => montarAds({
  alvo: { tipo: 'sku', codigo: 'A' }, codigos: ['A'], mlbs: new Map([['MLB1', ['A']]]),
  intervalos: IVS, janela: JANELA, lucroPeriodo: 500, agora: AGORA, ...o,
});

describe('atribuicaoFinal', () => {
  it('fecha só quando o dia foi relido 15+ dias depois dele (D-1 + 14 de atribuição)', () => {
    expect(atribuicaoFinal('2026-09-15', '2026-09-27T14:20:00Z')).toBe(false);
    expect(atribuicaoFinal('2026-09-15', '2026-09-29T14:20:00Z')).toBe(false);
    expect(atribuicaoFinal('2026-09-15', '2026-09-30T14:20:00Z')).toBe(true);
  });
});

describe('montarAds', () => {
  it('sku: grupo ITEM antigo + FAMILY novo do mesmo MLB somam os dois; ROAS/ACOS/CPC por Σ, nunca média', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1'], [12, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [
      dia(11, '2026-09-15', { cost: 10, total_amount: 100, direct_amount: 100, clicks: 5, units: 2 }),
      dia(12, '2026-09-16', { cost: 90, total_amount: 90, indirect_amount: 90, clicks: 45, units: 1 }),
    ] }) });
    expect(a.alcance).toBe('sku');
    expect(a.estado).toBe('ok');
    expect(a.totais).toMatchObject({ custo: 100, vendasTotais: 190, vendasDiretas: 100, vendasIndiretas: 90, cliques: 50, unidades: 3 });
    expect(a.totais!.roas).toBeCloseTo(1.9);   // média dos ROAS diários seria 5,5
    expect(a.totais!.acos).toBeCloseTo(100 / 190);
    expect(a.totais!.cpc).toBeCloseTo(2);
    expect(a.lucroAposAds).toBe(400);
    expect(a.motivoSemLucro).toBeNull();
    expect(a.grupos.map((g) => [g.id, g.custo, g.exclusivo])).toEqual([[12, 90, true], [11, 10, true]]);
    // Série diária: 14/09 a 26/09 (hoje fora); dia sem linha gravada fica sem valor (nunca 0).
    expect(a.serieDiaria.map((p) => p.intervalo.rotulo)).toEqual(
      ['14/09', '15/09', '16/09', '17/09', '18/09', '19/09', '20/09', '21/09', '22/09', '23/09', '24/09', '25/09', '26/09']);
    expect(a.serieDiaria.slice(0, 3).map((p) => p.custo)).toEqual([null, 10, 90]);
  });

  it('família: grupo alcançado por dois MLBs da família conta uma vez só (dedup por ad_group_id)', () => {
    const f = fonte({ membros: [[21, 'MLB1'], [21, 'MLB2']], codigos: { MLB1: ['A'], MLB2: ['B'] },
      dias: [dia(21, '2026-09-15', { cost: 50 }), dia(21, '2026-09-15', { cost: 50 })] });
    const a = monta({ alvo: { tipo: 'familia', codigoPai: 'P' }, codigos: ['A', 'B'],
      mlbs: new Map([['MLB1', ['A']], ['MLB2', ['B']]]), fonte: f });
    expect(a.alcance).toBe('familia');
    expect(a.totais!.custo).toBe(50);
    expect(a.grupos).toHaveLength(1);
    expect(a.lucroAposAds).toBe(450);
  });

  it('SKU em grupo com outro código: mostra o gasto do grupo, lucro após Ads indisponível', () => {
    const a = monta({ fonte: fonte({ membros: [[21, 'MLB1'], [21, 'MLB2']], codigos: { MLB1: ['A'], MLB2: ['B'] },
      dias: [dia(21, '2026-09-15', { cost: 50 })] }) });
    expect(a.alcance).toBe('anuncio');
    expect(a.totais!.custo).toBe(50);
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('compartilhado');
    expect(a.compartilhadoCom).toEqual({ codigos: ['B'], semVinculo: 0 });
  });

  it('membro sem código resolvido (catálogo sem venda, anúncio fora do app) impede o sku', () => {
    const a = monta({ fonte: fonte({ membros: [[31, 'MLB1'], [31, 'MLB9']], codigos: { MLB1: ['A'] },
      dias: [dia(31, '2026-09-15', { cost: 5 })] }) });
    expect(a.alcance).toBe('anuncio');
    expect(a.grupos[0]).toMatchObject({ exclusivo: false, semVinculo: 1 });
    expect(a.compartilhadoCom).toEqual({ codigos: [], semVinculo: 1 });
  });

  it('atribuição em aberto vem do coletado_em; com o worker parado o dia continua em aberto', () => {
    const f = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 14, 20, { cost: 5 }) });
    const hoje = monta({ fonte: f });
    expect(hoje.serie[0].aberto).toBe(true);
    expect(hoje.diasAbertos).toBeGreaterThan(0);
    const parado = monta({ fonte: f, agora: new Date('2026-10-20T15:00:00Z') });
    expect(parado.estado).toBe('desatualizado');
    expect(parado.serie[0].aberto).toBe(true); // lido quando tinha 12 dias: não fechou
  });

  it('hoje nunca entra, nem se houver linha', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-27', { cost: 999 })] }) });
    expect(a.totais!.custo).toBe(0);
    expect(a.estado).toBe('sem_ads');
  });

  it('cobertura: intervalo antes da carga fica sem dado; despesa só soma dia coberto (mesmo recorte do gráfico)', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, sync: { ...SYNC, cobertura_desde: '2026-09-16' },
      dias: [dia(11, '2026-09-15', { cost: 7 }), ...diasDe(11, 21, 26)] }) });
    expect(a.serie[0].custo).toBeNull();
    expect(a.serie[1].custo).toBe(0);      // zero porque o ML devolveu as linhas com cost 0
    expect(a.totais!.custo).toBe(0);       // os R$ 7 de 15/09 estão antes da cobertura: fora da despesa
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('cobertura');
  });

  it('zero só com linha real: dia coberto sem linha deixa o intervalo sem valor; carga parcial não desenha', () => {
    const f = fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: diasDe(11, 21, 25) });
    const a = monta({ fonte: f });
    expect(a.serie[1].custo).toBeNull();   // 26/09 sem linha
    expect(a.serieDiaria.find((p) => p.intervalo.rotulo === '25/09')!.custo).toBe(0);
    expect(a.serieDiaria.find((p) => p.intervalo.rotulo === '26/09')!.custo).toBeNull();
    const parcial = monta({ fonte: { ...f, sync: { ...SYNC, carga_inicial_ok: false, cobertura_desde: null } } });
    expect([...parcial.serie, ...parcial.serieDiaria].every((p) => p.custo === null)).toBe(true);
  });

  it('gasto fora dos grupos listados (provável grupo excluído): despesa aparece, lucro após Ads indisponível', () => {
    const a = monta({ fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-15', { cost: 10 })],
      sync: { ...SYNC, custo_resumo: 100, custo_listado: 97.4 } }) });
    expect(a.totais!.custo).toBe(10);
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('fora_dos_grupos');
  });

  it('lucro do período nulo → lucro após Ads nulo, nunca "−despesa"', () => {
    const a = monta({ lucroPeriodo: null, fonte: fonte({ membros: [[11, 'MLB1']], codigos: { MLB1: ['A'] }, dias: [dia(11, '2026-09-15', { cost: 7 })] }) });
    expect(a.lucroAposAds).toBeNull();
    expect(a.motivoSemLucro).toBe('sem_lucro');
  });

  it('estados honestos', () => {
    const base = { membros: [[11, 'MLB1']] as [number, string][], codigos: { MLB1: ['A'] } };
    expect(monta({ fonte: fonte({ ...base, sync: null }) }).estado).toBe('sem_coleta');
    const semPerm = monta({ fonte: fonte({ ...base, sync: { ...SYNC, estado: 'sem_permissao', erro: 'ML 403 em advertisers: sem permissão de Publicidade ou conexão recusada' } }) });
    expect(semPerm.estado).toBe('sem_permissao');
    expect(semPerm.erro).toContain('sem permissão de Publicidade');
    expect(monta({ fonte: fonte({ ...base, sync: { ...SYNC, estado: 'sem_advertiser' } }) }).estado).toBe('sem_advertiser');
    const parcial = monta({ fonte: fonte({ ...base, sync: { ...SYNC, carga_inicial_ok: false, cobertura_desde: null } }) });
    expect(parcial.estado).toBe('parcial');
    expect(parcial.motivoSemLucro).toBe('cobertura');
    expect(monta({ fonte: fonte({ ...base, sync: { ...SYNC, ultimo_ok_em: '2026-09-24T14:20:00Z' } }) }).estado).toBe('desatualizado');
    const semGrupo = monta({ fonte: fonte({ membros: [], codigos: {} }) });
    expect(semGrupo).toMatchObject({ estado: 'sem_ads', alcance: 'sku', lucroAposAds: 500 });
    expect(monta({ mlbs: new Map(), fonte: fonte(base) }).alcance).toBe('indisponivel');
    expect(monta({ fonte: 'carregando' }).estado).toBe('carregando');
    expect(monta({ fonte: 'erro' }).estado).toBe('erro');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/lib/sku-ads.test.ts`
Expected: FAIL com `Failed to resolve import "@/lib/sku-ads"`.

- [ ] **Step 3: Leitura em `src/lib/sku-dossie-dados.ts`**

Acrescentar ao fim do arquivo:

```ts
// ---- Ads (Fatia 2c). Tabelas org-scoped com RLS; unidade = ad_group_id. ----

export interface AdsSync {
  estado: string; erro: string | null; ultimo_ok_em: string | null; carga_inicial_ok: boolean; cobertura_desde: string | null;
  /** metrics_summary.cost × Σ dos grupos listados na última janela ok: diferença > 0 = gasto fora de grupo listado. */
  custo_resumo: number | null; custo_listado: number | null;
}
export interface AdsGrupo {
  ad_group_id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; external_id: string | null; campaign_id: number | null;
  status: string; atualizado_em: string;
}
export interface AdsMembro { ad_group_id: number; ml_item_id: string }
export interface AdsDia {
  ad_group_id: number; dia: string; cost: number; clicks: number; prints: number; direct_amount: number;
  indirect_amount: number; total_amount: number; direct_units: number; units: number; coletado_em: string;
}
/** Grupos que tocam os MLBs do dossiê, TODOS os membros deles e o código de cada membro. */
export interface FonteAds {
  sync: AdsSync | null; grupos: AdsGrupo[]; membros: AdsMembro[]; dias: AdsDia[];
  codigosDosMembros: Map<string, string[]>;
}

/** Estado da coleta de Ads da org; null = nunca rodou. */
export async function buscarAdsSync(): Promise<AdsSync | null> {
  const { data, error } = await supabase.from('ml_ads_sync')
    .select('estado, erro, ultimo_ok_em, carga_inicial_ok, cobertura_desde, custo_resumo, custo_listado').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // numeric do Postgres: Number() como em src/lib/pulse.ts (o PostgREST pode devolver string em precisão alta).
  return { ...data, custo_resumo: data.custo_resumo == null ? null : Number(data.custo_resumo),
    custo_listado: data.custo_listado == null ? null : Number(data.custo_listado) };
}

/** MLB → códigos de MLBs arbitrários — RPC `vendas_sku_codigos_mlbs` (mesma UNION de vendas_sku_mlbs).
 *  MLB sem código não vem no objeto. */
export async function buscarCodigosMlbs(mlbs: string[]): Promise<Map<string, string[]>> {
  if (!mlbs.length) return new Map();
  const { data, error } = await supabase.rpc('vendas_sku_codigos_mlbs', { p_mlbs: mlbs });
  if (error) throw new Error(error.message);
  return new Map(Object.entries((data ?? {}) as Record<string, string[]>));
}

export async function buscarFonteAds(mlbs: string[], desde: string, ate: string): Promise<FonteAds> {
  const [sync, doDossie] = await Promise.all([
    buscarAdsSync(),
    emLotes<AdsMembro>(mlbs, (lote, de, fim) => supabase.from('ml_ads_grupo_item').select('ad_group_id, ml_item_id')
      .in('ml_item_id', lote).order('ad_group_id').order('ml_item_id').range(de, fim)),
  ]);
  const ids = [...new Set(doDossie.map((m) => String(m.ad_group_id)))].sort();
  if (!ids.length) return { sync, grupos: [], membros: [], dias: [], codigosDosMembros: new Map() };
  const [grupos, membros, dias] = await Promise.all([
    emLotes<AdsGrupo>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo')
      .select('ad_group_id, tipo, external_id, campaign_id, status, atualizado_em')
      .in('ad_group_id', lote.map(Number)).order('ad_group_id').range(de, fim) as Pagina<AdsGrupo>),
    emLotes<AdsMembro>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo_item').select('ad_group_id, ml_item_id')
      .in('ad_group_id', lote.map(Number)).order('ad_group_id').order('ml_item_id').range(de, fim)),
    emLotes<AdsDia>(ids, (lote, de, fim) => supabase.from('ml_ads_grupo_dia')
      .select('ad_group_id, dia, cost, clicks, prints, direct_amount, indirect_amount, total_amount, direct_units, units, coletado_em')
      .in('ad_group_id', lote.map(Number)).gte('dia', desde).lte('dia', ate).order('ad_group_id').order('dia').range(de, fim)),
  ]);
  const codigosDosMembros = await buscarCodigosMlbs([...new Set(membros.map((m) => m.ml_item_id))].sort());
  // numeric → Number() (mesmo cinto de src/lib/pulse.ts).
  const diasNum = dias.map((d) => ({
    ...d, cost: Number(d.cost), direct_amount: Number(d.direct_amount), indirect_amount: Number(d.indirect_amount),
    total_amount: Number(d.total_amount),
  }));
  return { sync, grupos, membros, dias: diasNum, codigosDosMembros };
}
```

(`as Pagina<AdsGrupo>`: o `tipo` gerado é `string`, a união literal vem do check da tabela — mesmo recurso de `buscarVisitasDia`.)

- [ ] **Step 4: Implementar `src/lib/sku-ads.ts`**

```ts
// Dossiê do SKU (Vendas SKU, Fatia 2c): Ads por grupo (ad_group_id). Toda soma é por grupo, deduplicada;
// ROAS/ACOS/CPC por Σ/Σ; "Lucro após Ads" só com gasto exclusivo do alvo e período coberto. Dia = data BRT
// literal do ML; hoje nunca entra. Nada daqui vai para ranking, ABC, Financeiro ou billing.
import { diaBRT, type Intervalo } from './calendario-brt';
import { round2 } from './formato';
import { diasDoIntervalo } from './sku-trafego';
import type { AlvoDossie } from './sku-dossie';
import type { AdsDia, FonteAds } from './sku-dossie-dados';

export type AlcanceAds = 'sku' | 'anuncio' | 'familia' | 'indisponivel';
export type EstadoAds = 'carregando' | 'erro' | 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso'
  | 'parcial' | 'desatualizado' | 'sem_ads' | 'ok';
export type MotivoSemLucro = 'compartilhado' | 'sem_lucro' | 'cobertura' | 'fora_dos_grupos' | null;

export interface TotaisAds {
  custo: number; cliques: number; impressoes: number; vendasDiretas: number; vendasIndiretas: number; vendasTotais: number;
  unidadesDiretas: number; unidades: number; cpc: number | null; roas: number | null; acos: number | null;
}
export interface PontoAds {
  intervalo: Intervalo;
  /** null = algum dia do intervalo sem linha gravada, fora da cobertura ou carga inicial em curso.
   *  Zero só aparece quando o ML devolveu a linha com cost 0. */
  custo: number | null;
  vendas: number | null;
  /** Algum dia do intervalo ainda pode ganhar vendas atribuídas (relido < 15 dias depois dele). */
  aberto: boolean;
}
export interface GrupoAdsDossie {
  id: number; tipo: 'ITEM' | 'FAMILY' | 'CATALOG'; status: string; campanhaId: number | null; custo: number;
  exclusivo: boolean; mlbs: string[]; codigos: string[]; semVinculo: number;
}
export interface AdsDossie {
  estado: EstadoAds;
  alcance: AlcanceAds;
  totais: TotaisAds | null;
  lucroAposAds: number | null;
  motivoSemLucro: MotivoSemLucro;
  /** Códigos de fora do alvo e membros sem código nos grupos do alcance. */
  compartilhadoCom: { codigos: string[]; semVinculo: number };
  /** Pelos intervalos do dossiê (Semana/Mês). */
  serie: PontoAds[];
  /** Um ponto por dia do período até ontem (a aba Ads tem "Dia" além de Semana/Mês). */
  serieDiaria: PontoAds[];
  grupos: GrupoAdsDossie[];
  coberturaDesde: string | null;
  ultimoOkEm: string | null;
  /** Dias do período (até ontem) com atribuição ainda em aberto. */
  diasAbertos: number;
  /** Motivo gravado pelo worker (sem_permissao etc.). */
  erro: string | null;
}

const DIA_MS = 86_400_000;
const DESATUALIZADO_MS = 48 * 3_600_000;
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DIA_MS);
function diasEntre(desde: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= ate; d = somarDias(d, 1)) out.push(d);
  return out;
}

/** A atribuição do dia fecha quando ele foi relido 15+ dias depois (D-1 + 14 dias de janela). Medido pelo
 *  coletado_em: com o worker parado, o dia continua em aberto por mais velho que seja. */
export const atribuicaoFinal = (dia: string, coletadoEm: string) => difDias(diaBRT(Date.parse(coletadoEm)), dia) >= 15;

/** Σ por campo e razões Σ/Σ — nunca a média dos percentuais diários (o parser do worker nem os lê). */
export function totaisAds(linhas: AdsDia[]): TotaisAds {
  const soma = (k: 'cost' | 'clicks' | 'prints' | 'direct_amount' | 'indirect_amount' | 'total_amount' | 'direct_units' | 'units') =>
    linhas.reduce((s, l) => s + l[k], 0);
  const custo = round2(soma('cost'));
  const cliques = soma('clicks');
  const vendasTotais = round2(soma('total_amount'));
  return {
    custo, cliques, impressoes: soma('prints'),
    vendasDiretas: round2(soma('direct_amount')), vendasIndiretas: round2(soma('indirect_amount')), vendasTotais,
    unidadesDiretas: soma('direct_units'), unidades: soma('units'),
    cpc: cliques > 0 ? custo / cliques : null,
    roas: custo > 0 ? vendasTotais / custo : null,
    acos: vendasTotais > 0 ? custo / vendasTotais : null,
  };
}

export function montarAds(p: {
  alvo: AlvoDossie; codigos: string[];
  /** Mapa do dossiê (vendas_sku_mlbs): MLBs do alvo. */
  mlbs: Map<string, string[]>;
  intervalos: Intervalo[];
  /** Período do dossiê (ISO). */
  janela: { desde: string; ate: string };
  /** Lucro atual do período (linhaPeriodo.m.lucro); null = sem custo. */
  lucroPeriodo: number | null;
  agora: Date;
  fonte: FonteAds | 'carregando' | 'erro';
}): AdsDossie {
  const cods = new Set(p.codigos);
  const mlbsAlvo = new Set([...p.mlbs].filter(([, cs]) => cs.some((c) => cods.has(c))).map(([m]) => m));
  const vazio = (estado: EstadoAds, erro: string | null = null): AdsDossie => ({
    estado, alcance: 'indisponivel', totais: null, lucroAposAds: null, motivoSemLucro: null,
    compartilhadoCom: { codigos: [], semVinculo: 0 }, serie: [], serieDiaria: [], grupos: [], coberturaDesde: null, ultimoOkEm: null,
    diasAbertos: 0, erro,
  });
  if (!mlbsAlvo.size) return vazio('ok');
  if (p.fonte === 'carregando' || p.fonte === 'erro') return vazio(p.fonte);
  const f = p.fonte;
  const sync = f.sync;
  if (!sync) return vazio('sem_coleta');
  if (sync.estado === 'sem_permissao' || sync.estado === 'sem_advertiser' || sync.estado === 'sem_acesso') {
    return { ...vazio(sync.estado, sync.erro), ultimoOkEm: sync.ultimo_ok_em };
  }

  const hoje = diaBRT(p.agora.getTime());
  const ontem = somarDias(hoje, -1);
  const parcial = !sync.carga_inicial_ok;
  // Último dia que uma coleta ok cobriu (ela lê até D-1). Coberto = dentro de [cobertura_desde, ultimoDia].
  // Coberto não é zero: o gráfico só mostra valor em dia com linha real; a despesa só soma dia coberto.
  const ultimoDia = sync.ultimo_ok_em ? somarDias(diaBRT(Date.parse(sync.ultimo_ok_em)), -1) : null;
  const coberto = (d: string) => sync.cobertura_desde != null && ultimoDia != null && d >= sync.cobertura_desde && d <= ultimoDia;
  const aberto = (d: string, coletadoEm: string | null) => !coletadoEm || !atribuicaoFinal(d, coletadoEm);

  const membros = new Map<number, Set<string>>();
  for (const m of f.membros) {
    const s = membros.get(m.ad_group_id) ?? new Set<string>();
    s.add(m.ml_item_id);
    membros.set(m.ad_group_id, s);
  }
  // Um grupo entra uma vez, por mais MLBs do alvo que ele tenha.
  const doAlvo = [...membros].filter(([, ms]) => [...ms].some((m) => mlbsAlvo.has(m))).map(([id]) => id);
  const ids = new Set(doAlvo);
  const linhas = [...new Map(f.dias.filter((d) => ids.has(d.ad_group_id) && d.dia <= ontem)
    .map((d) => [`${d.ad_group_id}|${d.dia}`, d] as const)).values()];
  const desdeDia = diaBRT(Date.parse(p.janela.desde));
  const fimJanela = diaBRT(Date.parse(p.janela.ate));
  const ateDia = fimJanela < ontem ? fimJanela : ontem;
  // Despesa do período = mesmo recorte do gráfico: só dia coberto (na carga parcial, o que já chegou, rotulado).
  const doPeriodo = linhas.filter((d) => d.dia >= desdeDia && d.dia <= ateDia && (parcial || coberto(d.dia)));
  const diasPeriodo = diasEntre(desdeDia, ateDia);

  const codigosDe = (m: string) => f.codigosDosMembros.get(m) ?? [];
  const meta = new Map(f.grupos.map((g) => [g.ad_group_id, g]));
  const grupos: GrupoAdsDossie[] = doAlvo.map((id) => {
    const ms = [...membros.get(id)!].sort();
    const codigos = [...new Set(ms.flatMap(codigosDe))].sort();
    const semVinculo = ms.filter((m) => codigosDe(m).length === 0).length;
    const g = meta.get(id); // a FK garante a linha; sem ela (RLS/leitura parcial) o grupo aparece como desconhecido
    return {
      id, tipo: g?.tipo ?? 'ITEM', status: g?.status ?? 'desconhecido', campanhaId: g?.campaign_id ?? null,
      custo: round2(doPeriodo.filter((d) => d.ad_group_id === id).reduce((s, d) => s + d.cost, 0)),
      exclusivo: semVinculo === 0 && codigos.every((c) => cods.has(c)), mlbs: ms, codigos, semVinculo,
    };
  }).sort((a, b) => b.custo - a.custo || a.id - b.id);

  const alcance: AlcanceAds = grupos.every((g) => g.exclusivo) ? (p.alvo.tipo === 'sku' ? 'sku' : 'familia') : 'anuncio';
  const totais = totaisAds(doPeriodo);
  const estado: EstadoAds = parcial ? 'parcial'
    : !sync.ultimo_ok_em || p.agora.getTime() - Date.parse(sync.ultimo_ok_em) > DESATUALIZADO_MS ? 'desatualizado'
      : totais.custo === 0 ? 'sem_ads' : 'ok';
  const periodoCoberto = !parcial && diasPeriodo.length > 0 && diasPeriodo.every(coberto);
  // Gasto do anunciante fora de qualquer grupo listado (provável grupo excluído): a despesa do alcance pode
  // estar abaixo do real, então não há "Lucro após Ads" — a despesa continua aparecendo.
  const foraDosGrupos = sync.custo_resumo != null && sync.custo_listado != null && sync.custo_resumo - sync.custo_listado > 0.005;
  const motivoSemLucro: MotivoSemLucro = alcance === 'anuncio' ? 'compartilhado'
    : p.lucroPeriodo == null ? 'sem_lucro' : !periodoCoberto ? 'cobertura' : foraDosGrupos ? 'fora_dos_grupos' : null;
  const lucroAposAds = motivoSemLucro == null && p.lucroPeriodo != null ? round2(p.lucroPeriodo - totais.custo) : null;

  const abertoNoDia = (d: string, ls: AdsDia[]) => (ls.length ? ls.some((l) => aberto(d, l.coletado_em)) : aberto(d, sync.ultimo_ok_em));
  const porDia = new Map<string, AdsDia[]>();
  for (const l of linhas) porDia.set(l.dia, [...(porDia.get(l.dia) ?? []), l]);
  const ponto = (intervalo: Intervalo): PontoAds => {
    const ds = diasDoIntervalo(intervalo, p.agora).filter((d) => d <= ontem);
    const doIv = ds.flatMap((d) => porDia.get(d) ?? []);
    // Valor só com todos os dias cobertos E com linha real; carga parcial → sem valor no gráfico.
    const provado = !parcial && ds.length > 0 && ds.every((d) => coberto(d) && porDia.has(d));
    return {
      intervalo,
      custo: provado ? round2(doIv.reduce((s, l) => s + l.cost, 0)) : null,
      vendas: provado ? round2(doIv.reduce((s, l) => s + l.total_amount, 0)) : null,
      aberto: provado && ds.some((d) => abertoNoDia(d, doIv.filter((l) => l.dia === d))),
    };
  };
  const intervaloDoDia = (d: string): Intervalo => ({
    inicio: `${d}T03:00:00.000Z`, fim: `${somarDias(d, 1)}T03:00:00.000Z`, rotulo: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
    incompleto: false, inicioParcial: false,
  });

  return {
    estado, alcance, totais, lucroAposAds, motivoSemLucro,
    compartilhadoCom: {
      codigos: [...new Set(grupos.flatMap((g) => g.codigos.filter((c) => !cods.has(c))))].sort(),
      semVinculo: grupos.reduce((s, g) => s + g.semVinculo, 0),
    },
    serie: p.intervalos.map(ponto), serieDiaria: diasPeriodo.map((d) => ponto(intervaloDoDia(d))),
    grupos, coberturaDesde: sync.cobertura_desde, ultimoOkEm: sync.ultimo_ok_em,
    diasAbertos: diasPeriodo.filter((d) => abertoNoDia(d, doPeriodo.filter((l) => l.dia === d))).length,
    erro: sync.erro,
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run tests/lib/sku-ads.test.ts`
Expected: PASS. Depois `pnpm preflight:static` → PASS.

- [ ] **Step 6: Commit**

`$JOB_TMP/commit-2c-t5.txt`:
```
feat(vendas-sku): leitura de Ads no dossiê (alcance por grupo, Σ e lucro após Ads)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add src/lib/sku-dossie-dados.ts src/lib/sku-ads.ts tests/lib/sku-ads.test.ts` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t5.txt`

---

### Task 6: Hook + aba "Ads" premium no dossiê

> sonnet + skill **`frontend-design-fable5`** (system work, Tier 1) com `~/.claude/skills/frontend-design-fable5/scripts/preflight.sh`; o controlador faz a auditoria Tier 2 (≥ 8/10). O código abaixo é o piso funcional (props, estados, textos, a11y); o polimento visual vem do Tier 1, sem mudar props nem textos de estado.

**Files:**
- Modify: `src/hooks/useSkuDossie.ts`
- Modify: `src/components/sku-dossie/trafego-dossie.tsx` (exportar `Aviso`)
- Create: `src/components/sku-dossie/ads-dossie.tsx`
- Modify: `src/pages/SkuDossie.tsx`
- Test: `src/components/sku-dossie/__tests__/ads-dossie.test.tsx`; Modify: `src/pages/__tests__/SkuDossie.test.tsx` (mock do hook)

**Interfaces:**
- Consumes: T5 (`buscarFonteAds`, `montarAds`, `AdsDossie`, `GrupoAdsDossie`, `PontoAds`); `faixaTrafego` (`src/lib/sku-trafego.ts`); `Fato` (`cabecalho-dossie.tsx`); `EIXO`, `MARGEM`, `MIN_POR_INTERVALO`, `TOOLTIP`, `kCompacto`, `marcaParcial` (`serie-pontos.ts`); `asHoraDeBRT`, `diaMesLiteral`, `pctBR` (`formato-dossie.ts`); `fmtBRL`, `fmtInt` (`src/lib/formato.ts`).
- Produces: `useSkuDossie(...)` passa a devolver também `ads: AdsDossie | null` e `refetchAds: () => Promise<void>`; `export function AdsDossie(props: { ads: AdsDossie | null; familia: boolean; passo: Passo; onPasso: (p: Passo) => void; onTentar: () => void })`.

- [ ] **Step 1: Escrever o teste do componente (RED)**

Create `src/components/sku-dossie/__tests__/ads-dossie.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdsDossie } from '../ads-dossie';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { AdsDossie as DadosAds } from '@/lib/sku-ads';

const AGORA = new Date('2026-09-27T15:00:00Z');
const IVS = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-28T02:59:59.999Z', 'semana', AGORA);
const base: DadosAds = {
  estado: 'ok', alcance: 'sku',
  totais: { custo: 100, cliques: 50, impressoes: 900, vendasDiretas: 100, vendasIndiretas: 90, vendasTotais: 190,
    unidadesDiretas: 2, unidades: 3, cpc: 2, roas: 1.9, acos: 100 / 190 },
  lucroAposAds: 400, motivoSemLucro: null, compartilhadoCom: { codigos: [], semVinculo: 0 },
  serie: IVS.map((intervalo, i) => ({ intervalo, custo: i ? 90 : 10, vendas: i ? 90 : 100, aberto: i === 1 })),
  serieDiaria: ['14', '15'].map((d) => ({
    intervalo: { inicio: `2026-09-${d}T03:00:00.000Z`, fim: `2026-09-${Number(d) + 1}T03:00:00.000Z`, rotulo: `${d}/09`, incompleto: false, inicioParcial: false },
    custo: 5, vendas: 20, aberto: true,
  })),
  grupos: [{ id: 3000001, tipo: 'FAMILY', status: 'ACTIVE', campanhaId: 2000001, custo: 100, exclusivo: true, mlbs: ['MLB1'], codigos: ['A'], semVinculo: 0 }],
  coberturaDesde: '2026-06-29', ultimoOkEm: '2026-09-27T14:20:00Z', diasAbertos: 12, erro: null,
};
const renderiza = (ads: DadosAds | null) =>
  render(<AdsDossie ads={ads} familia={false} passo="semana" onPasso={vi.fn()} onTentar={vi.fn()} />);

describe('AdsDossie', () => {
  it('KPIs por Σ e lucro após Ads com o rótulo do período', () => {
    renderiza(base);
    expect(screen.getByText('Despesa de Ads do período')).toBeInTheDocument();
    expect(screen.getByText('1,9×')).toBeInTheDocument();
    expect(screen.getByText('Lucro após Ads')).toBeInTheDocument();
    expect(screen.getByText('Vendas atribuídas · 12 dias com atribuição em aberto')).toBeInTheDocument();
  });
  it('"Dia" troca para a série diária (rótulo dd/mm) sem mexer no Passo do dossiê', () => {
    const onPasso = vi.fn();
    render(<AdsDossie ads={base} familia={false} passo="semana" onPasso={onPasso} onTentar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(screen.getByRole('heading', { name: 'Ads por dia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Série diária de 14\/09 a 15\/09\./)).toBeInTheDocument();
    expect(onPasso).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    expect(onPasso).toHaveBeenCalledWith('mes');
  });
  it('estados com dado: parcial, desatualizado e sem_ads', () => {
    const r1 = renderiza({ ...base, estado: 'parcial' });
    expect(screen.getByText(/Carga inicial dos últimos 90 dias em curso/)).toBeInTheDocument();
    r1.unmount();
    const r2 = renderiza({ ...base, estado: 'desatualizado' });
    expect(screen.getByText(/Última coleta ok/)).toBeInTheDocument();
    r2.unmount();
    renderiza({ ...base, estado: 'sem_ads', totais: { ...base.totais!, custo: 0 } });
    expect(screen.getByText(/Nenhum gasto de Ads nos anúncios vinculados a este SKU/)).toBeInTheDocument();
  });
  it('gasto fora dos grupos listados: lucro após Ads indisponível, despesa continua', () => {
    renderiza({ ...base, lucroAposAds: null, motivoSemLucro: 'fora_dos_grupos' });
    expect(screen.getAllByText(/gasto fora dos grupos listados \(provável grupo excluído\)/).length).toBeGreaterThan(0);
    expect(screen.getByText('Despesa de Ads do período')).toBeInTheDocument();
  });
  it('gasto compartilhado: lucro após Ads indisponível com o motivo', () => {
    renderiza({ ...base, alcance: 'anuncio', lucroAposAds: null, motivoSemLucro: 'compartilhado', compartilhadoCom: { codigos: ['B'], semVinculo: 0 } });
    expect(screen.getAllByText(/gasto compartilhado com 1 código de fora/).length).toBeGreaterThan(0);
  });
  it('403: explica permissão de Publicidade ou conexão recusada, sem falar em token expirado', () => {
    renderiza({ ...base, estado: 'sem_permissao', totais: null });
    expect(screen.getByText(/sem permissão de Publicidade ou conexão recusada/)).toBeInTheDocument();
    expect(screen.queryByText(/expirad/)).toBeNull();
  });
  it('sem coleta, sem anunciante e carregando', () => {
    const { unmount } = renderiza({ ...base, estado: 'sem_coleta', totais: null });
    expect(screen.getByText(/A coleta de Ads começa após a ativação/)).toBeInTheDocument();
    unmount();
    const r2 = renderiza({ ...base, estado: 'sem_advertiser', totais: null });
    expect(screen.getByText(/Meu perfil → Publicidade/)).toBeInTheDocument();
    r2.unmount();
    renderiza(null);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/components/sku-dossie/__tests__/ads-dossie.test.tsx`
Expected: FAIL com `Failed to resolve import "../ads-dossie"`.

- [ ] **Step 3: Exportar `Aviso` de `trafego-dossie.tsx`**

Trocar `function Aviso({ icone: Icone, tom, children }` por `export function Aviso({ icone: Icone, tom, children }` (mais nada muda).

- [ ] **Step 4: Componente `src/components/sku-dossie/ads-dossie.tsx`**

```tsx
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock, CloudOff, KeyRound, Megaphone, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { Passo } from '@/lib/calendario-brt';
import type { AdsDossie as DadosAds, GrupoAdsDossie, PontoAds } from '@/lib/sku-ads';
import { Fato } from './cabecalho-dossie';
import { Aviso } from './trafego-dossie';
import { EIXO, EIXO_LUCRO, MARGEM, MIN_POR_INTERVALO, TOOLTIP, kCompacto, marcaParcial } from './serie-pontos';
import { asHoraDeBRT, diaMesLiteral, pctBR } from './formato-dossie';

const TIPO: Record<GrupoAdsDossie['tipo'], string> = { ITEM: 'Anúncio', FAMILY: 'Família (UP)', CATALOG: 'Catálogo' };
const fmtRoas = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function textoAlcance(a: DadosAds, familia: boolean): string {
  if (a.alcance === 'sku') return 'Gasto dos grupos exclusivos deste SKU';
  if (a.alcance === 'familia') return 'Gasto dos grupos exclusivos da família (cada grupo contado uma vez)';
  if (a.alcance === 'anuncio') return `Gasto dos grupos compartilhados: não é só ${familia ? 'desta família' : 'deste SKU'}`;
  return '';
}

function textoSemLucro(a: DadosAds): string {
  if (a.motivoSemLucro === 'compartilhado') {
    const { codigos, semVinculo } = a.compartilhadoCom;
    const partes = [
      codigos.length ? plural(codigos.length, 'código de fora', 'códigos de fora') : '',
      semVinculo ? plural(semVinculo, 'anúncio sem vínculo', 'anúncios sem vínculo') : '',
    ].filter(Boolean);
    return `indisponível: gasto compartilhado com ${partes.join(' e ')}`;
  }
  if (a.motivoSemLucro === 'sem_lucro') return 'indisponível: lucro do período sem custo cadastrado';
  if (a.motivoSemLucro === 'cobertura') return 'indisponível: período fora da coleta de Ads';
  if (a.motivoSemLucro === 'fora_dos_grupos') return 'indisponível: gasto fora dos grupos listados (provável grupo excluído)';
  return '';
}

function linhasPonto(p: PontoAds): Array<[string, string]> {
  if (p.custo == null) return [['Ads', 'sem dado (fora da coleta)']];
  return [
    ['Despesa de Ads', fmtBRL(p.custo)],
    ['Vendas atribuídas', fmtBRL(p.vendas ?? 0)],
    ['ROAS', p.custo > 0 ? fmtRoas((p.vendas ?? 0) / p.custo) : 'sem gasto'],
    ...(p.aberto ? [['Atribuição', 'em aberto (até 14 dias)'] as [string, string]] : []),
  ];
}

interface Props {
  ads: DadosAds | null;
  familia: boolean;
  passo: Passo;
  onPasso: (p: Passo) => void;
  onTentar: () => void;
}

/** Ads do período (Fatia 2c): gasto e vendas atribuídas por grupo de anúncios, no alcance comprovado.
 *  Barras = despesa; linha = vendas atribuídas; barra hachurada = atribuição ainda em aberto. */
export function AdsDossie({ ads: a, familia, passo, onPasso, onTentar }: Props) {
  const hachura = `ads-aberto-${useId().replace(/:/g, '')}`;
  // "Dia" é local da aba (o Passo do dossiê só tem Semana/Mês); Semana/Mês seguem o seletor do dossiê.
  const [diario, setDiario] = useState(false);
  const serie = (diario ? a?.serieDiaria : a?.serie) ?? [];
  const n = serie.length;
  const dados = useMemo(() => serie.map((p, i) => ({ i, rotulo: p.intervalo.rotulo, custo: p.custo, vendas: p.vendas, aberto: p.aberto, parcial: p.intervalo.incompleto })), [serie]);
  const temDados = !!a && !!a.totais && a.alcance !== 'indisponivel'
    && (a.estado === 'ok' || a.estado === 'parcial' || a.estado === 'desatualizado' || a.estado === 'sem_ads');

  let corpo: ReactNode = null;
  if (!a || a.estado === 'carregando') {
    corpo = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Carregando os Ads</span>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-1.5 bg-card px-3 py-2.5"><Skeleton className="h-3 w-24 bg-foreground/10" /><Skeleton className="h-4 w-20 bg-foreground/10" /></div>
          ))}
        </div>
        <Skeleton className="h-60 w-full bg-foreground/10 sm:h-64" />
      </div>
    );
  } else if (a.estado === 'erro') {
    corpo = (
      <Aviso icone={CloudOff} tom="warning">
        <p><span className="font-medium">Não foi possível ler os Ads.</span>{' '}
          <span className="text-muted-foreground">O resto do dossiê não depende deles.</span></p>
        <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={onTentar}>Tentar de novo</Button>
      </Aviso>
    );
  } else if (a.estado === 'sem_coleta') {
    corpo = <Aviso icone={Clock} tom="muted">A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.</Aviso>;
  } else if (a.estado === 'sem_permissao') {
    corpo = (
      <Aviso icone={KeyRound} tom="warning">
        O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada.
        Reconecte a conta em Canais; se continuar, confira a permissão "Publicidade" do aplicativo.
      </Aviso>
    );
  } else if (a.estado === 'sem_advertiser') {
    corpo = (
      <Aviso icone={Megaphone} tom="muted">
        Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.
      </Aviso>
    );
  } else if (a.estado === 'sem_acesso') {
    corpo = <Aviso icone={CloudOff} tom="warning">A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.</Aviso>;
  } else if (a.alcance === 'indisponivel') {
    corpo = (
      <Aviso icone={Unlink} tom="muted">
        {`Nenhum anúncio do Mercado Livre vinculado a ${familia ? 'esta família' : 'este código'} no mapa atual: não há gasto de Ads para atribuir.`}
      </Aviso>
    );
  } else if (temDados && a.totais) {
    const t = a.totais;
    const resumo = [
      `${textoAlcance(a, familia)}.`,
      `Despesa de Ads do período ${fmtBRL(t.custo)}, vendas atribuídas ${fmtBRL(t.vendasTotais)}.`,
      t.roas != null ? `ROAS ${fmtRoas(t.roas)}.` : '',
      a.lucroAposAds != null ? `Lucro após Ads ${fmtBRL(a.lucroAposAds)}.` : `Lucro após Ads ${textoSemLucro(a)}.`,
      a.diasAbertos ? `${plural(a.diasAbertos, 'dia', 'dias')} com atribuição em aberto.` : '',
      n ? `Série ${diario ? 'diária' : passo === 'semana' ? 'semanal' : 'mensal'} de ${serie[0].intervalo.rotulo} a ${serie[n - 1].intervalo.rotulo}.` : '',
    ].filter(Boolean).join(' ');
    corpo = (
      <>
        {a.estado === 'parcial' && <Aviso icone={Clock} tom="muted">Carga inicial dos últimos 90 dias em curso: valores parciais.</Aviso>}
        {a.estado === 'desatualizado' && a.ultimoOkEm && (
          <Aviso icone={Clock} tom="warning">{`Última coleta ok ${asHoraDeBRT(a.ultimoOkEm)}: os dias depois disso estão sem dado.`}</Aviso>
        )}
        {a.estado === 'sem_ads' && (
          <Aviso icone={Megaphone} tom="muted">
            {`Nenhum gasto de Ads nos anúncios vinculados a ${familia ? 'esta família' : 'este SKU'} no período (vínculo atual${a.coberturaDesde ? `, coleta desde ${diaMesLiteral(a.coberturaDesde)}` : ''}).`}
          </Aviso>
        )}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <Fato rotulo="Despesa de Ads do período">{fmtBRL(t.custo)}</Fato>
          <Fato rotulo={`Vendas atribuídas${a.diasAbertos ? ` · ${plural(a.diasAbertos, 'dia', 'dias')} com atribuição em aberto` : ''}`}>
            {fmtBRL(t.vendasTotais)} <span className="font-normal text-muted-foreground">{`${fmtInt(t.unidades)} un.`}</span>
          </Fato>
          <Fato rotulo="ROAS" fraco={t.roas == null}>{t.roas != null ? fmtRoas(t.roas) : 'sem gasto'}</Fato>
          <Fato rotulo="ACOS" fraco={t.acos == null}>{t.acos != null ? pctBR(t.acos) : 'sem venda atribuída'}</Fato>
          <Fato rotulo="CPC" fraco={t.cpc == null}>{t.cpc != null ? fmtBRL(t.cpc) : 'sem clique'}</Fato>
          <Fato rotulo="Lucro após Ads" fraco={a.lucroAposAds == null}>
            {a.lucroAposAds != null ? fmtBRL(a.lucroAposAds) : 'indisponível'}
          </Fato>
        </dl>
        <p className="text-xs text-muted-foreground">
          {a.lucroAposAds != null
            ? 'Lucro após Ads = lucro atual do período − despesa de Ads até ontem. O lucro atual não muda.'
            : `Lucro após Ads ${textoSemLucro(a)}.`}
        </p>

        <p className="sr-only">{resumo}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-2" />Despesa de Ads</li>
          <li className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-chart-1" />Vendas atribuídas</li>
          <li className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden><rect width="10" height="10" fill={`url(#${hachura})`} /></svg>
            Atribuição em aberto (até 14 dias)
          </li>
        </ul>

        <div className="-mx-1 overflow-x-auto px-1">
          <div className="relative h-60 sm:h-64 [&_*]:outline-none" style={{ minWidth: n * MIN_POR_INTERVALO + EIXO_LUCRO + 2 * MARGEM }} aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dados} margin={{ top: 16, right: MARGEM, left: MARGEM, bottom: 0 }} accessibilityLayer={false}>
                <defs>
                  <pattern id={hachura} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="var(--chart-2)" fillOpacity={0.3} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-2)" strokeWidth={3} />
                  </pattern>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" interval="preserveStartEnd" />
                <YAxis width={EIXO_LUCRO} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => kCompacto(Number(v))} />
                <Tooltip cursor={TOOLTIP.cursor} filterNull={false} content={({ active, payload }) => {
                  const i = (payload?.[0]?.payload as { i?: number } | undefined)?.i;
                  if (!active || i == null) return null;
                  const p = serie[i];
                  return (
                    <div className="min-w-44 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md">
                      <p className="mb-1 font-medium">{`${!diario && passo === 'semana' ? 'Semana de ' : ''}${p.intervalo.rotulo}${marcaParcial(p.intervalo) ? ` ${marcaParcial(p.intervalo)}` : ''}`}</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {linhasPonto(p).map(([k, v]) => (
                          <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>
                        ))}
                      </dl>
                    </div>
                  );
                }} />
                <Bar dataKey="custo" name="Despesa de Ads" radius={[3, 3, 0, 0]} maxBarSize={36}>
                  {dados.map((d) => <Cell key={d.i} fill={d.aberto ? `url(#${hachura})` : 'var(--chart-2)'} fillOpacity={d.parcial ? 0.5 : 1} />)}
                </Bar>
                <Line dataKey="vendas" name="Vendas atribuídas" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--chart-1)', strokeWidth: 0 }}
                  activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {a.grupos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Grupos de anúncios · vínculo atual</h4>
            <ul className="divide-y rounded-lg border">
              {a.grupos.slice(0, 8).map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{`${TIPO[g.tipo]} · ${g.status.toLowerCase()}${g.campanhaId === 0 ? ' · fora de campanha' : ''}`}</p>
                    <p className="truncate text-xs text-muted-foreground">{`grupo ${g.id} · ${g.mlbs.join(', ')}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={g.exclusivo ? 'success' : 'info'}>
                      {g.exclusivo ? 'exclusivo' : `compartilhado · ${plural(g.codigos.length, 'código', 'códigos')}${g.semVinculo ? ` + ${g.semVinculo} sem vínculo` : ''}`}
                    </StatusPill>
                    <span className="tabular-nums">{fmtBRL(g.custo)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {a.grupos.length > 8 && <p className="text-xs text-muted-foreground">{`e mais ${plural(a.grupos.length - 8, 'grupo', 'grupos')}`}</p>}
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby="dossie-ads" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id="dossie-ads" className="text-sm font-medium">{!temDados ? 'Ads' : diario ? 'Ads por dia' : passo === 'semana' ? 'Ads por semana' : 'Ads por mês'}</h3>
          {temDados && a && <p className="text-xs text-muted-foreground">{textoAlcance(a, familia)}</p>}
        </div>
        {temDados && (
          <div role="group" aria-label="Agrupar por" className="flex gap-1">
            <Button size="sm" variant={diario ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
              aria-pressed={diario} onClick={() => setDiario(true)}>Dia</Button>
            {(['semana', 'mes'] as const).map((p) => (
              <Button key={p} size="sm" variant={!diario && passo === p ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
                aria-pressed={!diario && passo === p} onClick={() => { setDiario(false); onPasso(p); }}>
                {p === 'semana' ? 'Semana' : 'Mês'}
              </Button>
            ))}
          </div>
        )}
      </div>
      {corpo}
    </section>
  );
}
```

- [ ] **Step 5: Rodar o teste do componente (GREEN)**

Run: `pnpm vitest run src/components/sku-dossie/__tests__/ads-dossie.test.tsx`
Expected: PASS.

- [ ] **Step 6: Hook**

Em `src/hooks/useSkuDossie.ts`:
- imports: acrescentar `buscarFonteAds` ao import de `@/lib/sku-dossie-dados` e `import { montarAds, type AdsDossie } from '@/lib/sku-ads';`
- logo depois do bloco `trafegoQ`:

```ts
  // Ads (Fatia 2c): query à parte, como o tráfego — falhar aqui não derruba o dossiê.
  const mlbsAds = useMemo(() => (extrasQ.data ? [...extrasQ.data.mlbs.keys()].sort() : []), [extrasQ.data]);
  const temAds = mlbsAds.length > 0 && !!faixa;
  const adsQ = useQuery({
    queryKey: ['sku-dossie-ads', mlbsAds, faixa],
    queryFn: () => buscarFonteAds(mlbsAds, faixa!.desde, faixa!.ate),
    enabled: temAds,
    staleTime: 5 * 60_000,
  });
```

- logo depois do memo `dados`:

```ts
  // Memo à parte: os Ads chegarem (ou falharem) não recalculam o dossiê.
  const ads = useMemo<AdsDossie | null>(() => {
    if (!r.dados || !extrasQ.data) return null;
    return montarAds({
      alvo: alvoM, codigos, mlbs: extrasQ.data.mlbs, intervalos, janela,
      lucroPeriodo: r.dados.linhaPeriodo?.m.lucro ?? null, agora: new Date(),
      fonte: adsQ.isError ? 'erro' : adsQ.data ?? 'carregando',
    });
  }, [r.dados, extrasQ.data, alvoM, codigos, intervalos, janela, adsQ.isError, adsQ.data]);
```

- no `return`: acrescentar `ads,` depois de `dados,`; em `refetch` acrescentar `...(temAds ? [adsQ.refetch()] : [])` ao array; e o campo

```ts
    /** "Tentar de novo" da aba Ads: só a query dela. */
    refetchAds: async () => { if (temAds) await adsQ.refetch(); },
```

- [ ] **Step 7: Página**

Em `src/pages/SkuDossie.tsx`:
- `import { AdsDossie } from '@/components/sku-dossie/ads-dossie';`
- `const { estado, dados, ads, refetch, refetchTrafego, refetchAds } = useSkuDossie(alvo, periodo, passo);`
- no `TabsList`, depois do trigger de tráfego: `<TabsTrigger value="ads" className="px-3">Ads</TabsTrigger>`
- depois do `TabsContent value="trafego"`:

```tsx
          <TabsContent value="ads">
            <AdsDossie ads={ads} familia={familia} passo={passo} onPasso={setPasso} onTentar={() => { void refetchAds(); }} />
          </TabsContent>
```

Em `src/pages/__tests__/SkuDossie.test.tsx`, no `renderPagina`, o mock passa a ser
`{ estado, dados, ads: null, refetch: vi.fn(), refetchTrafego: vi.fn(), refetchAds: vi.fn() } as never`.

- [ ] **Step 8: Testes e portão**

Run: `pnpm vitest run src/components/sku-dossie src/pages/__tests__/SkuDossie.test.tsx tests/lib/sku-ads.test.ts`
Expected: PASS. Depois `pnpm preflight:static` → PASS.

- [ ] **Step 9: Tier 1 de design + validação visual com dados injetados**

- Invocar a skill `frontend-design-fable5` (modo *system work*: tela dentro do produto; manter o idioma do painel de tráfego). Rodar `bash ~/.claude/skills/frontend-design-fable5/scripts/preflight.sh src/components/sku-dossie/ads-dossie.tsx` e corrigir o que ele apontar. Não mudar props, nomes de estado nem os textos testados no Step 1.
- Invocar a skill `playwright-cli`. App local (`.env.local` copiado para o worktree; `pnpm dev`), conta VALIDATION, dados injetados com `route` nas respostas do PostgREST de `ml_ads_sync`, `ml_ads_grupo_item`, `ml_ads_grupo`, `ml_ads_grupo_dia` e da RPC `vendas_sku_codigos_mlbs` (JSON em arquivos, números inventados; `run-code` com arquivo, nunca JSON inline). Cenários: `ok` com `sku`, `anuncio` (gasto compartilhado), `familia`, `parcial`, `desatualizado`, `sem_ads`, `sem_permissao`, `sem_advertiser`, `sem_coleta`.
- Screenshots reais 1440 px e **390 px**, **claro e escuro**, em `.superpowers/sdd/2026-09-27-vendas-sku-fatia-2c/ui2c6-*.png`. Conferir: nenhuma rolagem horizontal da página em 390 px (só a do gráfico), hachura visível nos dois temas, tooltip com tokens.
- Entregar ao controlador para a auditoria Tier 2 (≥ 8/10). Achados viram commits `fix(vendas-sku): Ads — …`.

- [ ] **Step 10: Commit**

`$JOB_TMP/commit-2c-t6.txt`:
```
feat(vendas-sku): aba Ads no dossiê do SKU

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add src/hooks/useSkuDossie.ts src/components/sku-dossie/trafego-dossie.tsx src/components/sku-dossie/ads-dossie.tsx src/components/sku-dossie/__tests__/ads-dossie.test.tsx src/pages/SkuDossie.tsx src/pages/__tests__/SkuDossie.test.tsx` · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t6.txt`

---

### Task 7: Validação real (só GET, Postgres local) e documentação

**Files:**
- Create: `scripts/validar-ads-ml.ts`
- Modify: `docs/reference/glossario.md`, `docs/reference/modelo-de-dados.md`, `docs/reference/edge-functions.md`, `docs/decisions/0172-vendas-sku-analise-por-variacao.md`, `docs/project-status.md` (+ `obsidian-vault/` se a skill `docs-update-checklist` pedir)

**Interfaces:**
- Consumes: T1 (migration aplicada no Postgres local), T3 (`sincronizarAdsOrg`), T4 (`depsAds(admin, org, tokenFixo)`, `urlBuscaGrupos`, `HEADERS_ADS`, `buscarML`).
- Produces: evidência registrada em `docs/project-status.md` (Σcost × `metrics_summary`, grupos, 2º run).

- [ ] **Step 1: Script de validação (só GET no ML, grava só no Postgres LOCAL)**

Create `scripts/validar-ads-ml.ts`:

```ts
// Fatia 2c, T7 — valida o worker de Ads contra o ML REAL, só com GET, gravando no Postgres LOCAL.
// Uso:
//   eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
//   deno run -A scripts/validar-ads-ml.ts <connection_id_ml> <org_id_local>
// - Token lido em memória via public.get_connection_tokens (Management API, SQL só leitura). NUNCA impresso,
//   NUNCA renovado: vencido → aborta sem chamar o ML.
// - API_URL tem que ser local (127.0.0.1/localhost): o script recusa gravar fora do Postgres local.
// - Valores em R$ saem SÓ neste terminal local; nunca copiar para arquivo versionado (repo público).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { depsAds } from '../supabase/functions/coletar-ads-ml/deps.ts';
import { sincronizarAdsOrg } from '../supabase/functions/_shared/ads/sincronizar.ts';
import { HEADERS_ADS, HEADERS_ADVERTISER, ML_API, urlAdvertiser, urlBuscaGrupos, urlMembros, STATUS_GRUPOS } from '../supabase/functions/_shared/ads/fiacao.ts';
import { janelaAds } from '../supabase/functions/_shared/ads/janelas.ts';
import { parseAdvertiser, parseBuscaGrupos, parseMembros } from '../supabase/functions/_shared/ads/parsers.ts';
import { buscarML } from '../supabase/functions/_shared/trafego/fiacao.ts';
import { diaDeHoje } from '../supabase/functions/_shared/trafego/janelas.ts';
import type { MsgTrafego } from '../supabase/functions/_shared/trafego/sincronizar.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const [cx, org] = Deno.args;
if (!UUID.test(cx ?? '') || !UUID.test(org ?? '')) throw new Error('uso: <connection_id_ml> <org_id_local>');
const apiUrl = Deno.env.get('API_URL') ?? '';
const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl) || !serviceKey) throw new Error('API_URL local e SERVICE_ROLE_KEY obrigatórios');

async function envLocal(nome: string): Promise<string> {
  const v = Deno.env.get(nome);
  if (v) return v;
  const linha = (await Deno.readTextFile('.env.local')).split('\n').find((l) => l.startsWith(`${nome}=`));
  if (!linha) throw new Error(`${nome} ausente`);
  return linha.slice(nome.length + 1).trim().replace(/^"|"$/g, '');
}

async function lerToken(): Promise<string> {
  const pat = await envLocal('SUPABASE_ACCESS_TOKEN');
  const r = await fetch('https://api.supabase.com/v1/projects/txvncrgkoynoxwopfkbp/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select access_token, expires_at from public.get_connection_tokens('${cx}'::uuid)` }),
  });
  if (!r.ok) throw new Error(`Management API HTTP ${r.status}`);
  const [linha] = await r.json() as { access_token: string; expires_at: string }[];
  if (!linha || Date.parse(linha.expires_at) <= Date.now() + 5 * 60_000) throw new Error('BLOCKED: token vencido ou a vencer; não renovar fora do app');
  console.log(`token ok (expira ${linha.expires_at})`);
  return linha.access_token;
}

const token = await lerToken();
const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });

// Conferência do filtro de status (R4): o total com filters[status] tem que bater com o total sem filtro.
const hoje = diaDeHoje(new Date(), 'brt');
const janela = janelaAds({ hoje, cargaInicialOk: false, ultimoOkDia: null });
const adv = parseAdvertiser((await buscarML(`${ML_API}${urlAdvertiser()}`, token, fetch, HEADERS_ADVERTISER)).corpo);
if (adv == null) throw new Error('sem anunciante MLB');
const comFiltro = parseBuscaGrupos((await buscarML(`${ML_API}${urlBuscaGrupos(adv, janela, 0)}`, token, fetch, HEADERS_ADS)).corpo);
const semFiltroUrl = urlBuscaGrupos(adv, janela, 0).replace(`&filters[status]=${STATUS_GRUPOS}`, '');
const semFiltro = parseBuscaGrupos((await buscarML(`${ML_API}${semFiltroUrl}`, token, fetch, HEADERS_ADS)).corpo);
console.log('grupos listados', { comFiltro: comFiltro?.total, semFiltro: semFiltro?.total, resumoCusto: comFiltro?.custoResumo });

// Membros (informativo): o worker sempre lê /ads na janela de 90 dias e nunca encolhe o vínculo; aqui só se
// registra se o ML filtra membros pela atividade da janela (90 dias × último dia).
const familias = (comFiltro?.grupos ?? []).filter((g) => g.tipo === 'FAMILY' && g.cost > 0).slice(0, 3);
for (const g of familias) {
  const t90 = parseMembros((await buscarML(`${ML_API}${urlMembros(g.ad_group_id, janela, 0)}`, token, fetch, HEADERS_ADS)).corpo)?.total;
  const t1 = parseMembros((await buscarML(`${ML_API}${urlMembros(g.ad_group_id, { desde: janela.ate, ate: janela.ate }, 0)}`, token, fetch, HEADERS_ADS)).corpo)?.total;
  console.log('membros', { grupo: g.ad_group_id, janela90: t90, dia1: t1 });
}

/** Σ cost gravado no Postgres local em [desde, ate] (paginado; só leitura). */
async function somaCusto(desde: string, ate: string): Promise<number> {
  let total = 0;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('ml_ads_grupo_dia').select('cost').eq('org_id', org)
      .gte('dia', desde).lte('dia', ate).order('ad_group_id').order('dia').range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) total += Number(l.cost);
    if ((data ?? []).length < 1000) return Math.round(total * 100) / 100;
  }
}

/** Cadeia inteira localmente: continuações vão para uma fila em memória, não para o QStash. */
async function rodar(n: number): Promise<void> {
  const fila: MsgTrafego[] = [{ org_id: org, primeira: true }];
  const deps = { ...depsAds(admin, org, async () => token), continuar: async (m: MsgTrafego) => { fila.push(m); } };
  while (fila.length) {
    const r = await sincronizarAdsOrg(deps, fila.shift()!);
    console.log(`run ${n}`, r);
    if (r.resultado === 'erro' || r.resultado === 'sem_acesso') { console.error(`FALHA: run ${n} terminou em ${r.resultado}`); Deno.exit(1); }
  }
}

// Run 1 = carga inicial de 90 dias. Prova: Σ gravado no intervalo da carga = custoListado do sync.
await rodar(1);
const { data: sync, error: eSync } = await admin.from('ml_ads_sync')
  .select('estado, carga_inicial_ok, cobertura_desde, custo_resumo, custo_listado').eq('org_id', org).single();
if (eSync || !sync) throw new Error(`ml_ads_sync: ${eSync?.message ?? 'sem linha'}`);
const somaCarga = await somaCusto(janela.desde, janela.ate);
const resumo = Number(sync.custo_resumo); const listado = Number(sync.custo_listado);
console.log('run 1 (R$ só neste terminal)', {
  estado: sync.estado, cargaInicialOk: sync.carga_inicial_ok, coberturaDesde: sync.cobertura_desde,
  custoResumo: resumo, custoListado: listado, somaCarga,
  foraDosGruposPct: resumo > 0 ? `${(((resumo - listado) / resumo) * 100).toFixed(2)} %` : 'n/a',
});
if (Math.abs(somaCarga - listado) > 0.01) {
  console.error('FALHA: Σ gravado na carga ≠ custoListado do search', { somaCarga, custoListado: listado });
  Deno.exit(1);
}

// Run 2 = rodada diária (15 dias). Dias com mais de 15 dias (dia < hoje−15) não podem mudar.
const limiteAntigo = new Date(Date.parse(`${janelaAds({ hoje, cargaInicialOk: true, ultimoOkDia: null }).desde}T00:00:00Z`) - 86_400_000)
  .toISOString().slice(0, 10);
const antigosAntes = await somaCusto(janela.desde, limiteAntigo);
await rodar(2);
const antigosDepois = await somaCusto(janela.desde, limiteAntigo);
console.log('run 2', { diasAte: limiteAntigo, antigosAntes, antigosDepois });
if (Math.abs(antigosDepois - antigosAntes) > 0.005) {
  console.error('FALHA: o 2º run mudou dias com mais de 15 dias');
  Deno.exit(1);
}
console.log('OK: carga = custoListado; 2º run não mexeu nos dias antigos');
```

- [ ] **Step 2: Preparar a org local e rodar (só leitura no ML)**

Run (org fictícia local; o `org_id` da Avil nunca vai para o banco local):
```bash
docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -c "insert into public.organizations (id, nome, slug) values ('96000000-0000-0000-0000-000000000001', 'Validação Ads', 'validacao-ads') on conflict do nothing"
```
Pegar o `connection_id` da conexão ML da Avil com `python3 scripts/spike-ads-ml.py conexoes` (só leitura). Depois:
```bash
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
deno run -A scripts/validar-ads-ml.ts <connection_id_avil> 96000000-0000-0000-0000-000000000001
```
Expected (valores em R$ **só neste terminal**; nunca copiar para arquivo versionado):
- `grupos listados { comFiltro: N, semFiltro: N, … }` com N igual (se diferir, **parar** e reportar: o filtro de R4 esconde grupos);
- `membros { janela90, dia1 }` por grupo FAMILY: informativo (o worker já usa 90 dias e não encolhe vínculo); registrar se diferem;
- `run 1 { resultado: 'ok' }` (ou `continua` … `ok`). Se der `erro` com "resposta inválida" (série diária com dia faltando, por exemplo grupo criado dentro da janela), **parar** e reportar ao controlador com o id do grupo e as datas: a premissa de série densa por grupo caiu;
- `run 1 (R$ só neste terminal) { custoResumo, custoListado, somaCarga, foraDosGruposPct }` com `somaCarga = custoListado` (± R$ 0,01; o script falha sozinho se não bater);
- `run 2 { diasAte, antigosAntes, antigosDepois }` iguais (o script falha sozinho se a soma dos dias com mais de 15 dias mudar) e `OK: carga = custoListado; 2º run não mexeu nos dias antigos`.

- [ ] **Step 3: Conferências no Postgres local**

```bash
docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -c "
select estado, carga_inicial_ok, cobertura_desde, advertiser_id is not null as tem_adv, cursor, posse_ate from ml_ads_sync where org_id = '96000000-0000-0000-0000-000000000001';
select min(dia), max(dia), count(*), count(distinct ad_group_id), round(sum(cost), 2) as custo from ml_ads_grupo_dia where org_id = '96000000-0000-0000-0000-000000000001';
select tipo, count(*) from ml_ads_grupo where org_id = '96000000-0000-0000-0000-000000000001' group by 1;
select count(*) from (select ad_group_id, dia from ml_ads_grupo_dia group by 1, 2 having count(*) > 1) d;"
```
Critérios:
- `max(dia)` = ontem (BRT); `min(dia)` = hoje − 90; `carga_inicial_ok = true`; `cursor` e `posse_ate` nulos.
- `somaCarga = custoListado` e a % `foraDosGruposPct` (o spike mediu ~2,6 %) já saíram do script; no `project-status` vai só a %.
- Nº de grupos com gasto na mesma ordem do spike (Avil: 134 em 90 dias) e tipos ITEM/FAMILY/CATALOG presentes.
- 2º run: nenhuma chave duplicada (última query = 0); a estabilidade dos dias com mais de 15 dias já foi provada pelo script (`antigosAntes = antigosDepois`).
- Nenhum token em nenhuma saída (`grep -c APP_USR` no log do terminal = 0).
- Dossiê local (conta VALIDATION não tem os produtos da Avil): a validação visual ficou na T6 com dados injetados; aqui só números.

- [ ] **Step 4: Documentação (skill `docs-update-checklist`)**

Invocar a skill `docs-update-checklist` e seguir o mapeamento dela. No mínimo:
- `docs/reference/glossario.md`: **Despesa de Ads do período** (Σcost dos grupos do alcance, dias até ontem); **Lucro após Ads** (lucro atual − despesa, só com gasto exclusivo e período coberto; senão indisponível com o motivo, inclusive "gasto fora dos grupos listados"); **Grupo de anúncios (Ad Group)** (unidade de gasto do Product Ads: ITEM/FAMILY/CATALOG; soma sempre por grupo); **Atribuição em aberto** (dia relido há menos de 15 dias; vendas atribuídas ainda podem mudar); **Alcance de Ads** (sku/família/anúncio/indisponível).
- `docs/reference/modelo-de-dados.md`: as 4 tabelas (colunas, PK, RLS de leitura por org, escrita só service_role), as 5 RPCs de escrita e `vendas_sku_codigos_mlbs`.
- `docs/reference/edge-functions.md`: `coletar-ads-ml` (QStash, `verify_jwt = false`, schedule `17 14 * * *` UTC ainda **não registrado**, runbook `docs/runbooks/coletar-ads-ml.md`); nota de que `coletar-trafego-ml` precisa de redeploy por `_shared/trafego/fiacao.ts`.
- `docs/decisions/0172-vendas-sku-analise-por-variacao.md`: nota "Fatia 2c" — unidade `ad_group_id`, R2 (sem gasto por cor), alcance, estados, o que ficou fora (posição na busca por ToS 7.6; Ads em ranking/ABC/Financeiro/billing; conferência com a fatura `PADS`, bloqueada por 403 no billing).
- `docs/project-status.md`: entrada "Ads no dossiê, Fatia 2c — na branch, não mergeada nem em produção", com a evidência do Step 3 (sem valores em R$ de cliente: só %, contagens e "bate/não bate") e o que falta (`db push`, deploy das duas funções, schedule, revisão final, merge).
- Graphify: se a checklist pedir, atualizar conforme a skill `graphify-update-maintenance`.

Run: `pnpm preflight` (portão completo)
Expected: PASS.

- [ ] **Step 5: Commit**

`$JOB_TMP/commit-2c-t7.txt`:
```
docs(vendas-sku): Fatia 2c validada (Ads por grupo, só GET, Postgres local)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Run: `/usr/bin/git add scripts/validar-ads-ml.ts docs/reference/glossario.md docs/reference/modelo-de-dados.md docs/reference/edge-functions.md docs/decisions/0172-vendas-sku-analise-por-variacao.md docs/project-status.md` (+ os arquivos do `obsidian-vault/` que a checklist tiver pedido) · `/usr/bin/git commit -F $JOB_TMP/commit-2c-t7.txt`

**Sem push, sem `db push`, sem deploy, sem schedule, sem merge (R14).**
