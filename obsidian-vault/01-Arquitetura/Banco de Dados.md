---
tags: [arquitetura, banco-de-dados]
atualizado: 2026-07-24
---

# Banco de Dados

Espelho resumido de `docs/reference/modelo-de-dados.md` (fonte de verdade). Schema Postgres via
Supabase, DDL canônico em `supabase/migrations/`. Ver [[Supabase]], [[Segurança]].

## Regras transversais

- **RLS por organização** — tabelas de domínio liberam leitura/escrita quando
  `org_id = current_org_id()`. Dentro da organização, a operação é compartilhada; `user_id`
  fica como auditoria.
- **Escritas sensíveis** (credenciais, faturamento) bloqueadas para `authenticated`; só via
  `service_role` (workers) ou RPC `security definer`.
- **Tokens nunca em coluna de texto** — ficam no Vault.

## Relações de domínio

```mermaid
erDiagram
    lotes ||--o{ familias : contem
    familias ||--o{ variacoes : contem
    familias ||--o{ anuncios_externos : espelha
    organizations ||--o{ marketplace_connections : "1 por canal"
    ml_vendas ||--o{ ml_vendas_itens : contem
    ml_vendas ||--o{ ml_devolucoes : "por order_id"
    variacoes }o--o{ ml_vendas_itens : "match GTIN/EAN"
```

## Tabelas principais

| Tabela | Papel |
|---|---|
| `lotes` | Um upload de planilha + imagens; inicia o pipeline |
| `familias` | Um PAI = um anúncio; identidade, resultado da IA, estado de publicação |
| `variacoes` | Um SKU/cor = uma variação do anúncio |
| `anuncios_externos` | Espelho multicanal, identidade `(org_id, canal, codigo_pai, particao)` |
| `marketplace_connections` | Credenciais OAuth por organização e canal (tokens no Vault) |
| `ml_vendas` / `ml_vendas_itens` | Pedidos do ML e seus itens |
| `ml_devolucoes` | Claims/devoluções |
| `ml_perguntas` | Perguntas de compradores |
| `ml_webhook_eventos` | Dedup de webhooks `(topic, resource)` |
| `ml_moderacao` | Anúncios moderados/pausados |
| `configuracoes` | Settings por organização (desconto, Telegram, Mercado Pago) |
| `profiles` | Espelho de `auth.users` — `is_admin`, `allowed_menus` (ver [[Usuários]]) |

## Funções SQL (`security definer`)

| Função | Papel |
|---|---|
| `update_lote_counters()` | Trigger: recalcula contadores de `lotes` + transição de status |
| `upsert_ml_credentials(...)` | Grava credenciais no Vault |
| `get_ml_tokens(user_id)` | Lê tokens descriptografados do Vault (só `service_role`) |
| `is_admin()` / `current_org_id()` | Helpers de RLS/RBAC — ver [[Segurança]] |
| `telegram_config_status()` | Retorna status sem expor o token |

## O que não existe (YAGNI consciente)

- Sem `catalogo_interno` — substituível por query em `familias`.
- Sem `jobs_log` — auditoria de fila vive no dashboard Upstash.
- `canal_externo` só tem `mercado_livre` até hoje.
