# Vendas SKU — Fatia 2b (Tráfego e oferta: visitas, unidades por visita, preço observado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar, só com leitura no ML, as visitas diárias e o preço de oferta observado de cada anúncio da org, e mostrar no dossiê um painel "Tráfego e oferta" com visitas por dia, **unidades por visita** (do SKU quando o anúncio é exclusivo; do anúncio inteiro, rotulada, quando é compartilhado; indisponível quando o vínculo é incerto) e o preço observado.

> Revisão do plano: Grok 4.7 xhigh (via Cursor), 2026-09-27 — "pronto com ajustes"; achados 1-11 e lacunas incorporados abaixo.

**Architecture:** Worker QStash no padrão de `sincronizar-promocoes`: lib pura com `Deps` injetáveis (`supabase/functions/_shared/trafego/`), `deps.ts` com o IO real, `index.ts` fino (assinatura QStash → fan-out por org → leitura em lotes com cursor e orçamento de 90 s). Três tabelas org-scoped com RLS de leitura (`ml_item_visitas_dia`, `ml_item_preco_dia`, `ml_trafego_sync`). O front lê as séries pelos MLBs do dossiê e calcula a métrica na leitura (nada congelado no worker).

**Tech Stack:** Deno Edge Functions + QStash (`_shared/queue.ts`), `getValidAccessTokenConexao` (lock Redis), Postgres + RLS, React/TS + recharts, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-vendas-sku-design.md` (seção "Fatia 2b", revisada pelo GPT-6 Astra) · ADR-0172 D-6.

## Global Constraints

- **Só leitura no ML.** Nenhum PUT/POST para o Mercado Livre (o único POST do fluxo é o refresh de token já existente em `getValidAccessTokenConexao`). Proibido usar `mlGet` e `buscarVisitas30d` neste worker (engolem 429 / só dão total de 30 dias): fetch próprio que devolve status e `Retry-After`.
- Unidade da coleta: `org_id + ml_item_id + dia` (dia **como a fonte define**, decidido no spike da Task 1). Nunca ratear visitas entre cores.
- Métrica = "unidades por visita" = Σ unidades ÷ Σ visitas, nos mesmos MLBs e dias com estado `ok`; nunca média de taxas; rótulo sem "%" de conversão (pode passar de 100%). No SKU só com MLB exclusivo (mapa `vendas_sku_mlbs` com 1 código); compartilhado → métrica do anúncio inteiro, rotulada; incerto → indisponível. Vendas dentro de Kit Virtual fora do numerador.
- Estados do dia: `ok` (valor retornado, inclusive zero), `pendente` (dentro das 48 h ou ainda não reconsultado depois delas), `falha`. `falha` nunca sobrescreve um dia `ok`. Dia ausente ≠ zero. Intervalo com qualquer dia não-`ok` → barra de visitas `null` + cobertura mostrada; métrica indisponível.
- Vínculo MLB → código: o mapa atual (`vendas_sku_mlbs`), rotulado "vínculo atual" — vigência histórica do vínculo fica fora (Ruling). Família: um MLB conta para a família só se todos os seus códigos pertencem a ela.
- Janela: carga inicial até 150 dias; depois janela móvel de 7 dias por execução. Dia estabilizado = encerrado há ≥ 48 h e coletado depois disso.
- Preço = "preço de oferta observado às HH:mm" via `GET /items/{id}/sale_price?context=channel_marketplace`: **um GET por MLB por execução**, gravado só no dia de `agora` (calendário do spike), e só se ainda não há linha desse dia; continuação depois da meia-noite não preenche o dia anterior; nunca preenche os dias da carga de 150 dias. Separado do "preço vendido" da 2a.
- Worker (cadeia): fan-out com `deduplicationId` = org+dia; a primeira mensagem da org **reserva a posse** (`ml_trafego_sync.rodada`, `posse_ate` = agora + 10 min, renovada a cada lote); continuação com `deduplicationId` = org+rodada+cursor; o cursor avança por compare-and-swap (`update ... where org_id = $1 and rodada = $2 and cursor is not distinct from $3`) **depois** do upsert do lote; rodada que perdeu a posse devolve `obsoleta` com HTTP 200 (não reentrega); a execução do dia seguinte não abre 2ª cadeia enquanto a posse estiver viva e retoma o cursor de uma carga inicial interrompida. Lote 20, orçamento 90 s, concorrência ≤ 6. 429/5xx: espera `Retry-After` (fallback 1,5 s) **só se couber no resto do orçamento**; senão `continuar` no mesmo cursor, sem marcar `falha`; 403/404 de um MLB → `falha` daquele item e a org segue. Erro real → HTTP 500 no ramo QStash (ADR-0171). `verify_jwt = false` + `verificarAssinatura`.
- Tabelas: copiar o bloco inteiro de `20260924184220_central_promocoes.sql:57-70` (enable RLS, policy select por `current_org_id()`, `revoke all from anon`, `revoke insert, update, delete, truncate, references, trigger from authenticated`, `grant select to authenticated`). RPCs de gravação: `revoke all ... from public, anon, authenticated` e `grant execute` só a `service_role`. Retenção 13 meses: limpeza em lotes **depois** de publicar o fan-out; falha da limpeza não devolve 500.
- Sem `supabase db push`, sem deploy de função, sem registrar schedule e sem merge nesta fatia (Ruling 2 da Fatia 1): o runbook deixa tudo pronto para o Diego.
- UI: `frontend-design-fable5` (system work); tooltip com tokens; português com acentos.

## Review Focus

1. **MLB multi-cor** → dossiê da cor mostra "visitas do anúncio compartilhado" e a métrica do anúncio inteiro, nunca um valor por cor. Task 6.
2. **Dia dentro das 48 h** → `pendente`, fora da métrica; zero retornado pelo ML → `ok` com 0. Tasks 3 e 6.
3. **429 no meio de um lote** → item volta para reprocesso, a rodada não grava `ok` falso, e a mensagem responde 500 se a org terminou em erro. Task 4.
4. **Rodada antiga entregue depois da nova** → não sobrescreve visitas/preço mais recentes. Tasks 2 e 4.
5. **Anúncio externo (vendido sem publicação pelo PubliAI)** → entra no inventário a partir das vendas da org. Task 3.

---

### Task 1: Spike — contratos reais da API de visitas e de preço (só GET)

**Files:** Create `scripts/spike-trafego-ml.py` (fora de `src/`), `docs/spikes/NNN-visitas-e-preco-ml.md` (NNN = próximo número em `docs/spikes/`).

- [ ] Escolher, por consulta read-only na Management API, 4 MLBs da Avil: um legado multi-cor (`variacoes_externas` com 2+ códigos), um filho User Products (`anuncios_externos_itens.item_externo_id`), um anúncio simples e um **pausado ou encerrado**. Contar também quantos MLBs o inventário da Avil teria (as 7 fontes + vendidos em 180 dias) para estimar a carga.
- [ ] Obter o token de acesso da conexão ML da Avil de forma segura (RPC `get_connection_tokens` com a service key do `.env.local`, lida dentro do script; token só no header `Authorization`; nunca logar a linha da RPC, headers nem o token) e fazer apenas: `GET /items/{id}/visits/time_window?last=150&unit=day` (prova que 1 GET cobre a carga), a mesma com `last=10&ending=<data>`, e `GET /items/{id}/sale_price?context=channel_marketplace`.
- [ ] Registrar no spike (sem token, sem dados pessoais): formato exato das respostas; se as datas dos pontos são 00:00Z (dia UTC) ou 03:00Z (dia BRT); se `ending` é exclusivo; se o dia de hoje/ontem vem com valor parcial ou ausente; o objeto de `sale_price` (campos de preço, `regular_amount`, moeda, `metadata`); comportamento para item pausado/encerrado; latência observada.
- [ ] **Decisões registradas no spike:** `calendario_trafego = 'utc' | 'brt'`; `ending` exclusivo sim/não; 1 GET cobre 150 dias sim/não; estimativa `nº de MLBs × latência` por execução (cabe num dia? quantas continuações?).
- [ ] Commit `docs(vendas-sku): spike dos contratos de visitas e preço do ML`.

---

### Task 2: Tabelas de tráfego com RLS e upsert protegido

> Migration → Opus. SQL local via `docker exec -i -e PGPASSWORD=postgres supabase_db_txvncrgkoynoxwopfkbp psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < arquivo.sql`.

**Files:** `supabase migration new vendas_sku_trafego`; `supabase/tests/vendas_sku_trafego.sql`; `src/lib/database.types.ts`.

**Interfaces — Produces:**
- `ml_item_visitas_dia(org_id uuid, ml_item_id text, dia date, visitas int null, estado text check (estado in ('ok','pendente','falha')), coletado_em timestamptz not null, rodada timestamptz not null, primary key (org_id, ml_item_id, dia))`.
- `ml_item_preco_dia(org_id uuid, ml_item_id text, dia date, preco numeric(12,2) not null, preco_regular numeric(12,2) null, moeda text not null, observado_em timestamptz not null, origem text not null, primary key (org_id, ml_item_id, dia))`.
- `ml_trafego_sync(org_id uuid primary key, estado text check (estado in ('sincronizando','ok','sem_acesso','erro')), rodada timestamptz, posse_ate timestamptz, iniciado_em timestamptz, ultimo_ok_em timestamptz, ultimo_erro_em timestamptz, erro text, cursor text, carga_inicial_concluida_em timestamptz)`.
- `ml_trafego_item(org_id uuid, ml_item_id text, status text, status_desde timestamptz, ultimo_ok_em timestamptz, primary key (org_id, ml_item_id))` — status do anúncio (lido no multiget `GET /items?ids=…&attributes=id,status` a cada execução) para tirar da coleta o encerrado há mais de 30 dias.
- RPC `gravar_visitas_dia(p_org uuid, p_rodada timestamptz, p_pontos jsonb)` e `gravar_preco_dia(p_org uuid, p_pontos jsonb)` — `security definer`, `search_path=''`, `revoke all from public, anon, authenticated`, `grant execute to service_role`: visitas fazem upsert só quando `excluded.rodada >= alvo.rodada` **e** nunca trocam um `ok` por `falha`; preço faz `on conflict do nothing`.
- FKs `org_id → organizations(id) on delete cascade`; índice `(org_id, ml_item_id, dia desc)` coberto pela PK.

- [ ] Step 1: teste SQL RED (copiar cabeçalho de `supabase/tests/vendas_sku_dossie.sql`): usuário da org 1 lê só as linhas da org 1; `anon` e `authenticated` não inserem; `gravar_visitas_dia` com rodada antiga não sobrescreve a nova e com rodada nova sobrescreve; `falha` não sobrescreve `ok`; `gravar_preco_dia` não reescreve dia existente; `authenticated`, `anon` e `public` não executam as RPCs.
- [ ] Step 2-4: migration com o bloco RLS/revoke exato do padrão (Global Constraints) → GREEN; tipos em `database.types.ts`; `pnpm preflight:static`.
- [ ] Step 5: commit `feat(vendas-sku): tabelas de tráfego com RLS e upsert protegido`.

---

### Task 3: Lib pura — inventário, janelas e parsers

**Files:** Create `supabase/functions/_shared/trafego/{inventario,janelas,parsers}.ts` (sem imports `jsr:`); tests em `supabase/functions/_shared/trafego/__tests__/`.

**Interfaces — Produces:**
- `montarInventario(fontes: { familias: string[]; anunciosExternos: string[]; itensUp: string[]; kitsVirtuais: string[]; catalogoVariacoes: string[]; catalogoItensUp: string[]; pxvAnteriores: string[]; vendidos: string[] }, encerradosHaMaisDe30d: Set<string>): string[]` — as 7 fontes de `varrer-anuncios-orfaos` + vendidos, união deduplicada, só `MLB\d+`, sem os encerrados há mais de 30 dias, ordenada (code units).
- `diasAColetar(p: { hoje: string; cargaInicialConcluida: boolean; ultimoDiaOk: string | null }): { desde: string; ate: string }` — 150 dias na carga inicial; senão os últimos 7 dias (inclui os ainda pendentes).
- `parseVisitas(resp: unknown, calendario: 'utc' | 'brt', agora: Date): Array<{ dia: string; visitas: number | null; estado: 'ok' | 'pendente' }> | null` — dia conforme o spike; dia encerrado há < 48 h → `pendente`; resposta inválida → `null` (a orquestração decide `falha`).
- `diaDeHoje(agora: Date, calendario: 'utc' | 'brt'): string` — o dia em que o preço observado é gravado.
- `parseSalePrice(resp: unknown): { preco: number; precoRegular: number | null; moeda: string } | null` (campos conforme o spike; `amount`/`price` como em `_shared/ml/kit-virtual.ts:134-145`).
- [ ] TDD com as respostas reais anonimizadas do spike como fixtures (incluindo zero, dia parcial, item encerrado, resposta malformada → `null`/`falha`, nunca exceção).
- [ ] Commit `feat(vendas-sku): lib pura de inventário, janelas e parsers do tráfego`.

---

### Task 4: Orquestração pura do worker (fan-out, lotes, cursor, retries)

**Files:** Create `supabase/functions/_shared/trafego/sincronizar.ts` + `__tests__/sincronizar.test.ts` (fakes com `vi.fn()` no padrão de `_shared/promocoes/__tests__/sincronizar.test.ts`).

**Interfaces — Produces:** `DepsTrafego` (reservarPosse, renovarPosse, avancarCursor (CAS), lerInventario, lerEstadoSync, lerStatusItens, buscarVisitas → `{ status; retryAfterMs; corpo }`, buscarPreco, gravarVisitas, gravarPreco, gravarStatusItens, precoJaGravadoHoje, continuar, concluir, falhar, agora, esperar) e `sincronizarTrafegoOrg(deps, msg: { org_id; rodada; cursor?: string; primeira: boolean }, cfg = { limiteMs: 90_000, lote: 20, concorrencia: 6 }): Promise<{ resultado: 'ok' | 'continua' | 'obsoleta' | 'erro' | 'sem_acesso' }>`.
- Cadeia conforme Global Constraints: `primeira` reserva a posse (falha → `obsoleta` se outra cadeia viva); continuação só confere a posse; `renovarPosse` a cada lote; `avancarCursor` (CAS) depois do upsert; CAS falhou → `obsoleta`; orçamento → `continuar({ org_id, rodada, cursor, primeira: false })`.
- 429/5xx → espera `Retry-After` só se `agora + espera` couber no orçamento; senão `continuar` no mesmo cursor (sem `falha`); 403/404 → `falha` do item; erro de token/conexão → `sem_acesso`; exceção → `falhar(erro)` + `erro`.
- Preço: um `buscarPreco` por MLB por execução, só se `!precoJaGravadoHoje`, gravado no `diaDeHoje`.
- [ ] TDD: orçamento estourado continua do cursor certo; rodada antiga → `obsoleta` sem gravar; CAS perdido → `obsoleta`; 429 com `Retry-After` que cabe espera; que não cabe → `continua` no mesmo cursor sem `falha`; 403 num item → `falha` só dele; token inválido → `sem_acesso`; exceção → `erro`; preço não é buscado duas vezes no mesmo dia; carga inicial interrompida é retomada no dia seguinte.
- [ ] Commit `feat(vendas-sku): orquestração pura do worker de tráfego`.

---

### Task 5: Worker real (deps, index, config) + runbook

**Files:** Create `supabase/functions/coletar-trafego-ml/{index.ts,deps.ts}`; Modify `supabase/config.toml` (`[functions.coletar-trafego-ml] verify_jwt = false`); Create `docs/runbooks/coletar-trafego-ml.md` (modelo: `docs/runbooks/monitorar-moderados.md`).
- `index.ts`: `verificarAssinatura` obrigatória (QStash puro); sem `org_id` → publica o fan-out para todas as orgs com conexão ML ativa (uma mensagem por org, `retries: 1`, `deduplicationId` org+dia, `primeira: true`) e **só depois** limpa a retenção em lotes (falha da limpeza é logada, não vira 500); com `org_id` → `sincronizarTrafegoOrg`; `erro` → 500; `obsoleta` → 200.
- `deps.ts`: inventário pelas 7 fontes de `varrer-anuncios-orfaos/index.ts:35-70` (inclui `kits_virtuais.ml_item_id`) com `paginarTudo` + `ml_vendas_itens.ml_item_id` distintos com **join em `ml_vendas.date_closed`** dos últimos 180 dias da org (`ml_vendas_itens` não tem data); status por multiget `/items?ids=…&attributes=id,status` (20 por chamada) gravado em `ml_trafego_item`; `resolverConexao` + `getValidAccessTokenConexao`; fetch ML próprio com timeout 15 s que devolve status HTTP e `Retry-After`; gravações pelas RPCs da Task 2.
- Runbook: `supabase db push` (Task 2), `supabase functions deploy coletar-trafego-ml`, conferir `verify_jwt=false`, schedule QStash diário **`17 9 * * *` UTC** (06:17 BRT, fora da virada da hora e do `renovar-tokens-ml` `:40`), teste ponta a ponta, como ler `ml_trafego_sync`.
- [ ] Validação local sem produção: `deno check` do worker; teste de fumaça do `index.ts` com assinatura inválida → 401. Commit `feat(vendas-sku): worker coletar-trafego-ml e runbook`.

---

### Task 6: Leitura no front e cálculo da métrica

**Files:** Modify `src/lib/sku-dossie-dados.ts` (`buscarVisitasDia(mlbs, desde, ate)`, `buscarPrecoDia(mlbs, desde, ate)` com `emLotes`, colunas explícitas), `src/lib/calendario-brt.ts` (generalizar para `intervalos(desde, ate, passo, calendario: 'brt' | 'utc', agora?)`, mantendo `intervalosBRT` como atalho), `src/lib/sku-dossie.ts` (`montarTrafego`), `src/hooks/useSkuDossie.ts` (query separada `trafegoQ` que não derruba o dossiê se falhar; busca também as vendas de **todos os códigos** dos MLBs compartilhados via `buscarIdsDossie` + `buscarVendasPorIds`); tests.

**Interfaces — Produces:** `TrafegoDossie = { calendario: 'utc' | 'brt'; porMlb: Array<{ mlb; vinculo: Vinculo; codigos: string[] }>; serie: Array<{ intervalo: Intervalo; visitas: number | null; estados: { ok; pendente; falha; ausente }; unidadesPorVisita: number | null; precoObservado: { min; max } | null }>; exclusivo: boolean; coberturaDesde: string | null; estadoColeta: 'sem_coleta' | 'parcial' | 'ok' }`.
- Numerador (sem fórmula de dinheiro): Σ `it.quantity` dos itens `faturavel`, **sem `dentroDeKit`**, cujo `ml_item_id` está no conjunto de MLBs considerado, nas vendas do intervalo (recorte por `date_closed` no calendário do tráfego). Denominador: Σ visitas `ok` desses MLBs no intervalo; qualquer dia não-`ok` → `null`.
- Conjunto de MLBs: SKU → os MLBs exclusivos dele (métrica do SKU); se só houver compartilhados → a métrica do anúncio inteiro, rotulada, com as vendas de todos os códigos do anúncio; `nao_resolvido` → indisponível. Família → MLBs cujos códigos pertencem todos à família. `exclusivo` vira `porMlb[].vinculo` + um campo `alcance: 'sku' | 'anuncio' | 'familia' | 'indisponivel'`.
- Série no calendário do spike (`intervalos(..., calendario)`); se `utc`, o painel nunca reusa os intervalos BRT do faturamento.
- [ ] TDD com os casos do Review Focus 1 e 2, família mista (MLB exclusivo + compartilhado com código de fora), venda de outro MLB do mesmo código fora do numerador, kit fora do numerador; commit `feat(vendas-sku): leitura do tráfego no dossiê`.

---

### Task 7: Painel "Tráfego e oferta" no dossiê — UI premium

**Files:** Create `src/components/sku-dossie/trafego-dossie.tsx`; Modify `src/pages/SkuDossie.tsx`; tests.
- Painel alternável ao lado da série de vendas (não empilhar curvas): visitas por intervalo (barras), unidades por visita (linha), preço observado (faixa mín./máx. por ponto, como o "bigode" da 2a); calendário declarado no título se `utc`; selos "anúncio compartilhado · MLB…"; estados `sem_coleta` ("A coleta de tráfego começa após a ativação"), `parcial` (cobertura desde dd/mm), pendente (48 h), falha; tooltip com tokens; 1440/390; a11y como a série da 2a.
- `frontend-design-fable5` (system work) + `preflight.sh`; screenshots reais com dados injetados (`route` nas tabelas `ml_item_visitas_dia`/`ml_item_preco_dia`) → `ui2b7-*.png`. Commit `feat(vendas-sku): painel de tráfego e oferta`.

---

### Task 8: Validação e docs

- [ ] `pnpm test` + `pnpm preflight`; teste SQL da Task 2.
- [ ] Validação do worker contra o ML real **só leitura**, sem produção no banco: script que executa `sincronizarTrafegoOrg` com deps reais de ML (token da Avil) para 3 MLBs e grava no **Postgres local**; conferir que os números batem com o que o spike registrou e que um segundo run não duplica nem regride.
- [ ] Docs pela `docs-update-checklist`: glossário ("Unidades por visita", "Tráfego e oferta", estados do dia), `docs/reference/modelo-de-dados.md` (3 tabelas + 2 RPCs), `docs/reference/edge-functions.md` (worker), ADR-0172 (nota da 2b), `project-status`. Commit `docs(vendas-sku): Fatia 2b validada`.
