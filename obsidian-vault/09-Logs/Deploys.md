---
tags: [logs, deploys]
atualizado: 2026-07-01
---

# Deploys

Processo real de deploy: `docs/how-to/deploy-e-migrations.md` (fonte de verdade). Ver
[[Backend]], [[Banco de Dados]].

## Regra de ouro

Deploy nunca fica defasado: sempre via CLI completa do Supabase (não MCP arquivo-a-arquivo).
Mudança em `_shared/*` exige redeploy de **todas** as funções que a usam.

## Edge Functions

```bash
supabase functions deploy <nome>       # uma função
supabase functions deploy              # todas
```

`verify_jwt` vem do `supabase/config.toml` — nunca sobrescrever na mão com `--no-verify-jwt`
(quebra a reprodutibilidade do deploy). Ver ⚠️ divergência conhecida em [[Bugs Conhecidos]].

## Migrations (schema) — canal único (ADR-0043)

**Toda** mudança de schema passa por `supabase migration new` + `supabase db push`. **Nunca**
`apply_migration` (MCP) nem editor SQL do painel para DDL.

```bash
supabase migration new <descricao>
# escrever SQL em supabase/migrations/
supabase db push            # local
pnpm db:check                # falha se local divergir do remoto
supabase db push --linked   # produção
```

## Deploys operacionais mais recentes (fonte: `docs/project-status.md`)

- `process-familia` v41 (refactor A1: resolver de categoria sem fallback hard-coded)
- `publish-familia-ml` v31
- `remover-publicado` v7

## Deploys pendentes conhecidos

- `notificar-liberacao` (migration + schedule QStash) — ver [[Bugs Conhecidos]] (Financeiro
  impecável)
- Correção de `verify_jwt` em `ml-webhook`, `sync-venda`, `reconciliar-faturamento`,
  `backfill-faturamento` — pendente de aprovação
