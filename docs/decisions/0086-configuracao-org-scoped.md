# ADR-0086 — Configuração org-scoped (fechar leitura por organização + imposto LOUD)

**Status:** Proposto (rascunho para revisão)
**Data:** 2026-07-21
**Refina:** ADR-0055 (imposto por origem) — no ponto do default silencioso das alíquotas.
**Relacionado:** ADR-0027 (multi-tenancy / E7), ADR-0074 (ai_model por org), ADR-0028 (billing), backlog "telegram_bot_token → Vault", `configuracoes`, `process-familia`, `_shared/ai/modelos.ts`, `_shared/mercadopago/financeiro.ts`, `_shared/notificacoes/config.ts`.

> Rascunho revisado após auditoria do código real (Codex gpt-5.6-sol, 2026-07-21). A 1ª versão
> superestimava o trabalho: **o write-path e a unicidade já estão org-scoped** (ver Contexto). O
> escopo real é bem menor e está descrito abaixo.

## Contexto

`configuracoes` guarda a configuração de **toda a organização**: alíquotas de imposto
(`aliquota_nacional_pct`/`aliquota_importado_pct`, ADR-0055), modelo de IA (`ai_model_texto/imagem`,
ADR-0074), token do Telegram (`telegram_bot_token`), segredo do Mercado Pago
(`mp_access_token_secret_id`), `desconto_pct`, `desconto_concorrencia_pct`, `reancora_lider_ativa`,
`mostrar_lucro_dashboard`.

**O que JÁ está org-scoped (verificado no código/prod):**
- Índice único `configuracoes_org_uniq (org_id)` criado pelo E7 (`20260705165755_e7_org_id_not_null.sql:33`) →
  **no máximo 1 linha por org** (não há duplicatas a resolver).
- Escrita: o frontend faz **todos** os upserts com `{ onConflict: 'org_id' }` (`src/lib/queries.ts`
  linhas 451–600). Toda gravação já vai para a linha única da org.
- RLS: `configuracoes: select org` (membro) / `insert|update admin org` (E7, `20260705165828_e7_rls_org.sql`).
- Leituras backend já corretas: `resolverModeloTexto` (`_shared/ai/modelos.ts:23`, `.eq('org_id')`) e
  telegram (`_shared/notificacoes/config.ts:11`, `.eq('org_id')`).

**O gap que resta (causa do achado #1 MÉDIA):**
1. A **PK ainda é `user_id`** (`configuracoes_pkey`), não `org_id`. A linha existe, mas é "propriedade"
   de um usuário.
2. **4 leituras de config no backend ainda filtram por `user_id`**, então só o usuário que criou a
   linha enxerga a config; qualquer outro membro da org lê **nada** e cai no default:
   - `process-familia/index.ts:292` → `.eq('user_id', userId)` — **alíquotas → 8/16 silencioso** (o #1).
   - `publicar-split-ml/index.ts:119`, `update-familia-ml/index.ts:94`,
     `_shared/anuncios/montar-canonico.ts:65` → `.eq('user_id', familia.user_id)` — `desconto_pct` → 15.
3. A RPC `telegram_config_status()` (`security definer`) ainda filtra por `user_id = auth.uid()`
   (`20260622121259_configuracoes_telegram.sql:10`) → retorna vazio para outro membro da mesma org.
4. Não há garantia de que uma org tenha linha de config (nasce só quando alguém salva na UI).

Em produção há **1 linha** de config (a da AVIL). Por isso o sintoma hoje é intermitente, mas o
vetor é real e piora com o 2º membro/2ª org.

## Decisão

Completar o org-scoping de `configuracoes` na **leitura** e na **chave**, e refinar o ADR-0055 para
que o imposto **nunca defaulte em silêncio**:

1. Trocar as 4 leituras backend de `user_id` → `org_id` (usar o `orgId` já disponível via
   `requireUserOrg`/`resolverOrgPorUserId`).
2. Alterar `telegram_config_status()` para filtrar `org_id = current_org_id()`.
3. Promover a chave para org: `org_id` vira a identidade da linha; `user_id` deixa de ser PK.
4. **Seed** de config default por org + **trigger** na criação de org (garante o invariante "toda org
   tem config").
5. **Imposto LOUD de verdade:** "linha existe" NÃO basta — seedar 8/16 só materializa o mesmo default.
   Introduzir `aliquotas_confirmadas_em timestamptz` (ou alíquotas nullable até confirmação). O
   `process-familia` **falha a publicação com mensagem acionável** ("confirme as alíquotas de imposto
   antes de publicar") se a org ainda não confirmou — em vez de aplicar 8/16 em silêncio. Isto
   **refina o ADR-0055**, que hoje define 8/16 como default; passa a exigir confirmação explícita por org.

A escrita permanece **admin-only por org** (RLS já garante). Membros não-admin leem, não editam.

## Plano faseado (expand → deploy → contract) — ordem corrigida

**Fase 0 — Preflight (obrigatório):** conferir no catálogo de produção que `configuracoes_org_uniq`
existe e que há ≤1 linha por org (não assumir; se houver drift, tratar antes). `npm run db:check`.

**Fase 1 — Seed + colunas (migration, sem quebra):** adicionar `aliquotas_confirmadas_em` (nullable);
converter `user_id` para o papel de auditoria (ver Q2); **seed** de 1 linha default por org sem
config. Ainda mantém `user_id` preenchido (compat com o código antigo).

**Fase 2 — Deploy da leitura (código):** trocar os 4 read-sites backend + a RPC `telegram_config_status`
para `org_id`; aplicar o LOUD no `process-familia` (checando `aliquotas_confirmadas_em`). Frontend já
está por org — nada a mudar lá além de expor "confirmar alíquotas".

**Fase 3 — Contract (migration, após drenar o código antigo):** trocar PK/nullability
(`user_id` → auditoria nullable, `org_id` como chave), e criar o **trigger** de seed em
`organizations`. Ordem importa: o trigger só funciona depois que `user_id` deixa de ser PK NOT NULL, e
a criação de org (`usuarios`/`create_org`) já insere o admin **após** a org — então o seed default
precisa rodar no fluxo de criação OU o trigger cria a linha com `user_id` null. Janela curta de lock
na troca de PK.

## Item SEPARADO (segurança, não faz parte da migration acima)

🔴 **CRÍTICA — fallback global do Mercado Pago é cross-tenant.** `resolverTokenMP`
(`_shared/mercadopago/financeiro.ts:26`) devolve `MP_ACCESS_TOKEN` (conta global/AVIL) quando a org
não tem `mp_access_token_secret_id`. Uma org nova (secret NULL) leria a conta MP da AVIL. Corrigir à
parte (remover o fallback global ou restringi-lo explicitamente à org AVIL) **antes** de considerar o
invariante multi-org seguro. Independe do épico de config; deve virar seu próprio fix/ADR.

## Consequências

**Positivas:** imposto e config consistentes por org; trava LOUD do ADR-0055 finalmente viável e
honesta (exige confirmação, não default mascarado); fonte única por org; base para o backlog
telegram→Vault.

**Riscos:** toca **código financeiro** (imposto/desconto) + **RPC de credencial** (telegram) +
**troca de PK** de tabela sensível. Mitigação: faseamento; a dedup NÃO é necessária (unique index já
existe) — só validar; arquivar qualquer linha se aparecer drift; contract só depois de drenar o
código antigo (rollback via coluna `user_id` mantida); validar que a AVIL não perde config.
Nunca rebaixar modelo/pular revisão (migration + RLS + financeiro).

## Questões abertas — RESOLVIDAS (recomendações do Codex, aceitas)

1. **Merge na dedup → N/A.** O unique index `configuracoes_org_uniq` já garante 1 linha/org: não há
   duplicata a resolver. Se o preflight achar drift, "mais recente vence" (`atualizado_em DESC, user_id`),
   **arquivar** as descartadas, e **abortar para revisão manual** se houver 2 secrets (MP/Telegram)
   não-nulos conflitantes (nunca escolher um segredo automaticamente).
2. **`user_id` → manter como `atualizado_por`** (nullable), com o FK trocado para **`ON DELETE SET NULL`**
   (o `ON DELETE CASCADE` atual apagaria a config da org se o último editor fosse excluído). Preencher
   `atualizado_por`/`atualizado_em` pelo banco (`auth.uid()`/`now()`), não pelo payload do navegador.
3. **Telegram → Vault: SEPARADO.** Nesta entrega só corrigir `telegram_config_status` para `org_id`; a
   migração do token plaintext para o Vault vira ADR/entrega posterior (mexe em runtime/rotação/rollback
   — juntar ampliaria demais o blast radius).
4. **Transição → corte seco por org, sem fallback a `user_id`.** Front e helpers já operam por org; um
   fallback `user_id` reintroduziria a ambiguidade e o silêncio que o ADR quer eliminar. Manter a coluna
   `user_id` apenas como rollback durante a janela.

## Inventário de mudança (para a implementação)

- Backend read → org_id: `process-familia/index.ts:292`, `publicar-split-ml/index.ts:119`,
  `update-familia-ml/index.ts:94`, `_shared/anuncios/montar-canonico.ts:65`.
- RPC: `telegram_config_status()` → `org_id = current_org_id()`.
- Migration: `aliquotas_confirmadas_em`; PK `user_id`→`org_id`, `user_id`→`atualizado_por` nullable
  `ON DELETE SET NULL`; seed default por org; trigger em `organizations`.
- Deploy: redeployar as edge functions que importam os `_shared/` afetados + as 4 diretas; conferir versão.
- Tipos gerados (`src/lib/database.types.ts`) e `scripts/verificar-isolamento-tenant.ts`.
- Item à parte: `resolverTokenMP` fallback MP (CRÍTICA).
