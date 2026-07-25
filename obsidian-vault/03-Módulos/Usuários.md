---
tags: [modulo, usuarios]
atualizado: 2026-07-24
---

# Usuários

Rota `/usuarios`, exclusiva de **admin** (`src/pages/Usuarios.tsx`). Ver [[Segurança]] (RBAC),
[[Login]] (fluxo de auth), [[Banco de Dados]] (tabela `profiles`).

## Contexto

Dentro de uma organização, os membros veem/operam os mesmos dados; organizações são isoladas por
`org_id`. Permissões de menu continuam definidas por usuário.

## Ações (edge function `usuarios`, `verify_jwt=true`, admin-only)

| Ação | O que faz |
|---|---|
| `invite` | Convida por e-mail (`auth.admin.inviteUserByEmail`) com `nome`/`allowed_menus` no metadata; redireciona para `/#/definir-senha` |
| `update_menus` | Atualiza `allowed_menus` de um usuário |
| `set_active` | Ativa/desativa um usuário |
| `set_admin` | Promove/remove admin |

## Tabela `profiles`

Espelho 1:1 de `auth.users`. `email`, `nome`, `is_admin`, `is_active`, `allowed_menus text[]`.
Criada no signup pelo trigger `handle_new_user` (semeia do metadata do convite).

## E-mail transacional

Sai do serviço interno do Supabase; usa SMTP próprio via Resend (`publiai@daludi.com.br`).
