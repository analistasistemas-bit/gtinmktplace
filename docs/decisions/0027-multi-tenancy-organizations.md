# ADR-0027: Multi-tenancy (organizations + org_id + marketplace_connections)

**Status:** Proposto (stub — detalhar no início do épico E7)
**Data:** 2026-06-13
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E7); refina ADR-0007 (modelo de dados) e ADR-0012 (credenciais ML)

## Contexto

O app é single-operador: RLS por `user_id`→`auth.users`; `ml_credentials` chaveada por `user_id`. Para
virar SaaS comercial é preciso isolar dados por organização. O padrão recomendado (Supabase B2B) é
**shared DB + shared schema + discriminador `org_id`** — não schema-por-tenant nem DB-por-tenant (não
escalam dentro do alvo de custo).

## Decisão (direção)

- Camada de org: `organizations`, `organization_members`, `organization_invitations` + enum `org_role`;
  funções `is_member_of(uuid)`/`has_role_on_org(uuid, org_role)` (SECURITY DEFINER STABLE, `search_path=''`,
  REVOKE de anon) — evita recursão de RLS e o N+1 (usar `(select is_member_of(org_id))`).
- Migração **aditiva**: add `org_id` nullable → backfill (1 org pessoal por user_id existente) → set not
  null → índices → swap das policies (`user_id=auth.uid()` → `is_member_of(org_id)`; manter `user_id` como
  "criado_por"/auditoria).
- `ml_credentials` → `marketplace_connections` (PK própria, org_id+canal+conta, unique); helpers Vault
  recebem `connection_id` + label namespaced; rotação via `vault.update_secret` (mesmo secret_id).
- **Blindar edge functions** (rodam com `service_role`, *bypassam* RLS): resolver + validar `org_id` do JWT
  e ownership da connection **antes** de tocar segredos (`assert_member`). Sem isso a RLS nova não protege
  o backend — **maior risco da migração**.
- Onboarding: trigger `handle_new_user` (org pessoal + owner); `accept-invite` idempotente.
- LGPD: `audit_log` por org; DPA (isolamento lógico via RLS); export + exclusão de titular.

## Questões em aberto

- `lotes.numero` global → sequência por org.
- Espelhar `org_ids`/role no JWT (`custom_access_token_hook`) só se medição mostrar gargalo.
- Quando executar (YAGNI: só quando houver primeiro interessado externo).

## Consequências

- Habilita multi-cliente; migração delicada (backfill + blindagem das functions). Validar com
  `get_advisors` (security) + teste cross-tenant após cada passo.
