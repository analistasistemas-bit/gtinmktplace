---
tags: [arquitetura, supabase]
atualizado: 2026-07-01
---

# Supabase

Plataforma que hospeda banco, autenticação, storage e as Edge Functions. Ver [[Backend]],
[[Banco de Dados]], [[Segurança]].

## Serviços usados

| Serviço | Uso no PubliAI |
|---|---|
| **Postgres** | Schema de domínio (`lotes`, `familias`, `variacoes`, `anuncios_externos`, faturamento…). RLS em todas as tabelas de domínio. |
| **Auth** | Login por e-mail/senha. Convite de usuário via `auth.admin.inviteUserByEmail` (edge `usuarios`). E-mail transacional via SMTP próprio (Resend), não o serviço interno do Supabase. |
| **Edge Functions** | ~35 funções Deno — ver [[Edge Functions]]. |
| **Storage** | Bucket privado `imagens`. Paths `{user_id}/{lote_id}/{arquivo}`. RLS: acesso só quando `auth.uid()` bate com o primeiro segmento do path. |
| **Vault** (`vault.secrets`) | Tokens OAuth do Mercado Livre, nunca em coluna de texto. Acesso só via RPC `security definer` (`upsert_ml_credentials`, `get_ml_tokens`, `delete_ml_credentials`). |
| **Realtime** | Habilitado em `lotes`/`familias` — acompanha progresso de processamento ao vivo (`useLoteRealtime`). |

## Config por função (`config.toml`)

`verify_jwt` é definido por função — ver tabela completa e o incidente conhecido de
divergência em [[Edge Functions]].

## Fora do Supabase (mas parte do backend)

- **QStash** (Upstash) — fila assíncrona com retry
- **Redis** (Upstash) — cache + locks distribuídos

Ambos documentados em [[Backend]] e [[Integrações]].
