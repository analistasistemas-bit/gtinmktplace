# 06 · Arquitetura Multi-Tenant

**Tipo Archify:** `architecture` · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** shared DB + shared schema com isolamento por `org_id`; o maior risco não é a RLS, é o `service_role` que a contorna.
- **Público:** novo desenvolvedor, arquiteto, segurança.
- **Elementos:** Organização A, Organização B (tenants), Edge Functions (service_role), Postgres compartilhado, marketplace_connections, Storage.
- **Relações:** cada org lê o Postgres diretamente (RLS) e também aciona Edge Functions (que escrevem com `org_id` explícito, resolvem credencial e path por org).
- **Direção de leitura:** esquerda (tenants) → centro (Edge Functions) → direita (dados compartilhados).
- **Omitido:** as 12 tabelas de domínio individualmente (ver [05](../05-simplified-data-model/)); detalhe de `current_org_id()`.
- **Fontes principais:** `docs/decisions/0027-multi-tenancy-organizations.md` (ADR completo); `docs/reference/modelo-de-dados.md` (regras transversais de RLS).

## O que mostra

Como duas organizações (empresas clientes) compartilham a mesma infraestrutura com isolamento lógico: cada uma só enxerga os próprios dados no Postgres (RLS via `current_org_id()`), mas as Edge Functions — que rodam com `service_role` e por definição **contornam RLS** — são o ponto onde o isolamento realmente é garantido, propagando `org_id` explicitamente em toda escrita.

## Como ler

Cada organização (caixa tracejada rosa) tem usuários que leem o Postgres diretamente (RLS aplicado) e acionam as Edge Functions para ações (upload, publicar). As Edge Functions escrevem no Postgres com `org_id` explícito, resolvem a credencial de marketplace da organização correta e leem/escrevem arquivos por path.

## Fontes

- `docs/decisions/0027-multi-tenancy-organizations.md` (decisão completa: D-E7.1 a D-E7.8)
- `docs/reference/modelo-de-dados.md` (seção "Regras transversais" — RLS, `org_id_default()`)
- `scripts/verificar-isolamento-tenant.ts` (suíte de isolamento cross-tenant, gate permanente — 39 asserções)

## Limitações

- **Isolamento não é "perfeito" por construção** — depende de toda Edge Function propagar `org_id` corretamente; a defesa é estrutural (`NOT NULL` falha alto) + auditada por suíte de teste, não uma garantia automática do banco.
- Sem `organization_members` (multi-usuário cruzando organizações) — 1 organização por usuário é decisão consciente (YAGNI), não limitação técnica; ver ADR-0027 D-E7.1.
- Só 1 organização real está em produção hoje (Avil) — o diagrama usa 2 organizações fictícias (A/B) para ilustrar o modelo.
- Não representa `is_super_admin` (só Diego, cria organizações) nem a página `/organizacoes`.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** `organization_members`/papéis finos forem implementados (E8); `custom_access_token_hook` for adotado; o modelo de isolamento mudar.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
