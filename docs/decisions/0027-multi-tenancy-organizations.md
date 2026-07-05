# ADR-0027: Multi-tenancy (organizations + org_id + marketplace_connections)

**Status:** Aceito (2026-07-05)
**Data:** 2026-06-13 (stub) · 2026-07-05 (detalhado e aceito no início do E7)
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E7); refina ADR-0007 (modelo de dados), ADR-0012 (credenciais ML) e ADR-0047 (operação compartilhada / RBAC de menu); [plano E7](../superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md)

## Contexto

O app está em produção como **single-operador com operação compartilhada** (ADR-0047): a RLS das 12
tabelas de domínio roteia por `public.is_membro_operacao()` (= qualquer usuário autenticado e ativo vê
tudo); `ml_credentials` é chaveada por `user_id`; os workers rodam com `service_role` (**bypassam RLS**)
e propagam `user_id` manualmente. Todos os dados atuais pertencem a uma única operação (a marca **Avil**).

Para virar SaaS comercial multi-empresa é preciso **isolar 100% dos dados por organização** — cada
empresa vê somente os próprios dados. O padrão recomendado (Supabase B2B, D6 do doc mestre) é **shared DB
+ shared schema + discriminador `org_id`** — não schema-por-tenant nem DB-por-tenant, que não escalam
dentro do alvo de custo.

O maior risco é estrutural: como os workers usam `service_role`, a RLS nova **não protege o backend por
si só**. A blindagem real é a propagação obrigatória de `org_id` em todo caminho de escrita, garantida por
`NOT NULL` que falha alto, auditoria função-por-função e uma suite executável de isolamento cross-tenant.

## Decisão

Migração **expand → migrate → contract** (aditiva, reversível fase a fase; ver plano E7), com as
seguintes decisões travadas — desvios conscientes do stub original, motivados pelo que o ADR-0047
(posterior ao stub) revelou sobre o modelo real da operação:

| # | Decisão | Racional |
|---|---------|----------|
| **D-E7.1** | **1 organização por usuário** (`profiles.org_id NOT NULL`), **sem** `organization_members`/`organization_invitations` | No SaaS-alvo cada empresa convida seus funcionários; ninguém atravessa orgs. RLS vira 1 subquery cacheável no initplan (`org_id = (select current_org_id())`) — mais simples, rápida e auditável que um `EXISTS` por linha. Se um dia precisar m2m, o corpo de `current_org_id()`/policies troca num único ponto (mesmo truque do ADR-0047). O backfill "1 org pessoal por user" do stub está **obsoleto**: o correto é **1 org Avil com todos os profiles atuais**. |
| **D-E7.2** | **Sem enum `org_role`** por ora; `profiles.is_admin` = "admin da sua org"; novo `profiles.is_super_admin` (só Diego) cria orgs | Papéis por org são YAGNI com 1 admin por empresa; `is_admin` já dirige menu/edge `usuarios`. Owner p/ billing entra no E8. |
| **D-E7.3** | Policies usam **`org_id = (select public.current_org_id())`** — helper SECURITY DEFINER STABLE, `search_path=''`, que checa `is_active` | Initplan cacheia 1× por statement; índice em `org_id` é usado; usuário desativado perde acesso a TUDO na hora (hoje só o `ProtectedRoute` bloqueia — ganho real de segurança). |
| **D-E7.4** | `ml_credentials` → **`marketplace_connections`** (por `org_id`+`canal`+conta), migrando os **mesmos** `secret_id` do Vault (zero re-criptografia) | Resolve a pendência do ADR-0047 ("membros não publicam"): a conexão é da org, não do chamador. |
| **D-E7.5** | Workers seguem `service_role`; a defesa é **propagação obrigatória de `org_id`** (claim `RETURNING org_id`, webhook via connections) + `NOT NULL` que **falha alto** se algum caminho esquecer | RLS não protege service_role por definição; a blindagem é estrutural + auditoria função-por-função (Task 16) + suite de isolamento (Task 9). |
| **D-E7.6** | Storage: **paths não mudam** (`{user_id}/...`); SELECT vira "dono do path pertence à minha org"; INSERT/UPDATE/DELETE continuam "own" | Zero movimentação de objetos; isolamento via join `profiles.org_id`. |
| **D-E7.7** | `MP_ACCESS_TOKEN` (Mercado Pago) vira segredo **por org** no Vault (`configuracoes.mp_access_token_secret_id`); org sem MP → enriquecimento **pula com log** (graceful) | Dado financeiro da Avil não pode vazar para outra org nem o contrário. |
| **D-E7.8** | Criação de org: **só super-admin** (Diego), via edge `usuarios` action `create_org`, com **página própria `/organizacoes`** (não uma seção na tela Usuários). Sem self-service até o E8 (billing) | Porta de entrada controlada; signup público continua removido; página dedicada dá espaço ao futuro painel de administração do SaaS (planos, uso, saúde por empresa) sem retrabalho. |

### Plano de 7 fases (resumo)

- **Fase 0.5 — Ensaio geral:** toda a sequência de migrations+backfill (Fases 1→4) roda antes num banco descartável, com a suite de isolamento passando lá, antes de qualquer `db push` em produção.
- **Fase 1 — Fundação aditiva:** cria `organizations`, `profiles.org_id`, helpers `current_org_id()`/`is_super_admin()`; `org_id` nullable nas 12 tabelas + backfill para a org Avil. Zero mudança de comportamento (RLS antiga ainda vale).
- **Fase 2 — Código grava `org_id`:** `requireUserOrg` nas edges; workers gravam/propagam `org_id` em todo INSERT/UPSERT. RLS antiga ainda vale (zero risco). PONTO DE DEPLOY 1.
- **Fase 3 — Contração:** `org_id NOT NULL`; uniques por org (identidade do anúncio passa a ser da org). Checkpoint de backup obrigatório.
- **Fase 4 — Swap de RLS (o isolamento):** policies passam de `is_membro_operacao()` para `org_id = current_org_id()`; `is_membro_operacao()` dropada. Suite de isolamento roda antes (deve falhar contra a RLS antiga) e depois (deve passar). Checkpoint de backup.
- **Fase 5 — Credenciais por org:** `marketplace_connections` + RPCs Vault; cutover do token para `getValidAccessTokenConexao`.
- **Fase 6 — Config por org + frontend:** `configuracoes`/Telegram/marca/cache/MP por org; página `/organizacoes` (super-admin); `lotes.numero` por org.
- **Fase 7 — Gate final:** auditoria função-por-função + baseline completo + suite de isolamento como gate permanente.

## Alternativas rejeitadas

- **m2m (`organization_members`) agora** — adiado. Modelo real da operação é "todos do mesmo time" (ADR-0047); m2m tem ponto único de troca em `current_org_id()` se um dia for necessário. Evita EXISTS-por-linha na RLS.
- **enum `org_role` agora** — YAGNI com 1 admin por empresa; `is_admin` já basta. Papéis finos entram com billing (E8).
- **schema-por-tenant / DB-por-tenant** — não escala no Supabase dentro do alvo de custo (D6 do doc mestre).
- **Re-criptografar tokens ML no cutover** — desnecessário: `marketplace_connections` reusa os mesmos `secret_id` do Vault já existentes.
- **Espelhar `org_id`/role no JWT (`custom_access_token_hook`)** — só se medição mostrar gargalo; `current_org_id()` cacheado no initplan resolve por ora.

## Consequências

- Habilita multi-cliente com isolamento no Postgres **e** no Storage; a conexão ML da org destrava
  publicação por qualquer membro (fecha pendência do ADR-0047).
- `is_membro_operacao()` deixa de existir; RLS por org em 12 tabelas + storage.
- Migração delicada: backfill + blindagem das edge functions (service_role bypassa RLS). Validação
  obrigatória: `get_advisors` (security) após cada migration + suite de isolamento cross-tenant
  (`scripts/verificar-isolamento-tenant.ts`) como gate permanente.
- Usuário desativado passa a perder acesso a tudo imediatamente (via `is_active` no `current_org_id()`).

## Ordem E7 → E6 (desvio consciente do roadmap E5→E6→E7)

O roadmap do doc mestre previa E5 (Shopee) → E6 (orquestração) → E7 (multi-tenancy). Diego decidiu
(2026-07-02) inverter para **E7 primeiro**: o objetivo é SaaS multi-empresa com certeza de isolamento;
o E6 (orquestração multicanal) só tem validação real com o E5 (Shopee), que ainda não existe. Fazendo o
E7 antes, o E6 nasce tenant-aware (conexões por org desde o início) e não precisa ser retrabalhado.

## Questões em aberto (resolvidas no plano ou adiadas)

- `lotes.numero` global → sequência por org (Fase 6).
- Onboarding self-service e enum de papéis finos → adiados para o E8 (billing).
- `custom_access_token_hook` → só se medição mostrar gargalo.
- LGPD (`audit_log` por org, DPA, export/exclusão de titular) → E8.6, antes de comercializar.
